# Supercharged Links & Obsidian Mobile Live Preview — Findings Report

Research date: 2026-10-18
Scope: why `link-colorer` Live Preview link colors work on desktop but not on mobile Obsidian; what Supercharged Links (SL) does differently; mobile-specific CM6 gotchas; mobile debugging; mobile CM6 throttling.

---

## 0. Headline answer

**The premise in the task brief is largely FALSE.** Supercharged Links does *not* reliably color links in mobile Live Preview:

- SL has an **OPEN bug report titled exactly that**: [#232 "Links aren't colored on mobile edit view"](https://github.com/mdelobelle/obsidian_supercharged_links/issues/232) (opened 2024-08-27 by NicoNoell, *still open*, last activity 2025-06-12). The reporter uses SL + Style Settings, works on desktop, fails on mobile iOS Live Preview ("I only see the default color").
- The **documented fix is a CSS variable, not CM6 code**: define `--link-color` on the link element. Verbatim from the issue comments:
  > `[data-link-path*="0 backlog" i] {color: #000 !important; }` — *this one doesn't work in live editor on mobile*
  > `[data-link-path*="0 backlog" i] {color: #000 !important; --link-color: #000 !important;}` — *this one does*
- Two more OPEN, closely-related issues: [#271 "No coloring of links in live preview mode"](https://github.com/mdelobelle/obsidian_supercharged_links/issues/271) (incl. an iOS reporter: *"It seems to work on my iPad… very hit or miss"*) and [#279 "Internal Link Color Not Working"](https://github.com/mdelobelle/obsidian_supercharged_links/issues/279).
- SL contains **zero mobile-specific code** (see §2).

**But the corollary is the important part for us:** the *decorations themselves do run on mobile*. The `--link-color` workaround in issue #232 is keyed on the `data-link-path` attribute that only the CM6 ViewPlugin can add — if decorations didn't run on mobile, that selector would match nothing and the workaround could not work. So **"mobile Obsidian doesn't run CM6 view-plugin decorations" is not the explanation** for our bug.

Two concrete, high-probability root causes remain, and **SL hits/is hit by both**:

| # | Cause | Evidence |
|---|---|---|
| **A** | Rebuild predicate never fires when the **background syntax-tree parse completes** (CM6 only parses ~3000 chars at view init). Links past the parse frontier stay undecorated. | SL issue [#289](https://github.com/mdelobelle/obsidian_supercharged_links/issues/289) (detailed write-up + analysis), PR [#290](https://github.com/mdelobelle/obsidian_supercharged_links/pull/290) (**still open / unmerged**) |
| **B** | **CSS**: in Live Preview the link *text* lives in a nested `<a class="cm-underline">` that carries its own color declaration. Coloring the wrapper `<span>` (even `color: … !important`) does not recolor the anchor's text; setting the **inherited custom property** `--link-color` on the wrapper does. | SL #232, #271, forum threads §3.2; SL ships `span.data-link-text > a.cm-underline { color: inherit; }` in [`styles.css`](https://raw.githubusercontent.com/mdelobelle/obsidian_supercharged_links/master/styles.css) to patch this on desktop |

Our plugin already sets `--link-color` inline (good), but does **not** neutralise the inner `a.cm-underline`, and does **not** rebuild on syntax-tree change. Both are actionable.

---

## 1. How Supercharged Links implements Live Preview decorations (Q1)

Primary sources — current `master` (manifest `0.14.0`, `isDesktopOnly: false`):

- Repo root: https://github.com/mdelobelle/obsidian_supercharged_links (note: the URL in the brief, `mdelobelle/supercharged-links`, 404s; the real repo is `mdelobelle/obsidian_supercharged_links`)
- Decoration code: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/src/linkAttributes/livePreview.ts
- Plugin lifecycle: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/main.ts
- DOM/reading-view code: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/src/linkAttributes/linkAttributes.ts

### 1.1 Extension type: ViewPlugin only (no StateField)

`livePreview.ts` exports `buildCMViewPlugin(app, _settings)` which returns `ViewPlugin.fromClass(class { … }, { decorations: v => v.decorations })`. A repo-wide grep for `StateField` in SL source returns **zero** hits. The code is explicitly derived from NothingIsLost's reference plugin:

```ts
// Implements the live preview supercharging
// Code structure based on https://github.com/nothingislost/obsidian-cm6-attributes/...
// Code help credits to @NothingIsLost!
```

### 1.2 Registration — wrapped in `Prec.lowest`

`main.ts`:

```ts
// Live preview
const ext = Prec.lowest(buildCMViewPlugin(this.app, this.settings));
this.registerEditorExtension(ext);
```

**`Prec.lowest` matters** — it pins SL's mark decorations below Obsidian's own decorations in the CM6 precedence ordering, which determines nesting order of the generated `<span>`s relative to Obsidian's token spans (`span.cm-hmd-internal-link`, `a.cm-underline`). Our plugin registers the raw extension with no `Prec`.

### 1.3 `update()` predicate — exactly two cases

```ts
update(update: ViewUpdate) {
    if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
            const minFrom = update.view.lineBlockAt(fromB).from;
            const maxTo   = update.view.lineBlockAt(toB).to;
            this.decorations = this.decorations.update({
                filter: (from, to) => to < minFrom || from > maxTo });
            this.decorations = RangeSet.join([this.decorations,
                this.buildDecorations(update.view, minFrom, maxTo)]);
        });
    }
    else if (update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
    }
}
```

So: **incremental** rebuild of only the changed line-blocks on `docChanged`; **full** rebuild on `viewportChanged`. There is **no** rebuild on syntax-tree change, focus, theme, or metadata change. (This is the bug in issue #289.)

### 1.4 `buildDecorations()` — viewport-scoped syntax-tree walk

```ts
buildDecorations(view, updateFrom = -1, updateTo = -1) {
  let builder = new RangeSetBuilder<Decoration>();
  const mdInfo = view.state.field(editorInfoField);
  for (let { from, to } of view.visibleRanges) {
      if (updateFrom !== -1 && (to < updateFrom || from > updateTo)) continue;
      syntaxTree(view.state).iterate({ from, to, enter: (node) => {
          const tokenProps = node.type.prop(tokenClassNodeProp);
          …
      }});
  }
  return builder.finish();
}
```

- Iterates `view.visibleRanges` (not the whole document).
- Walks `syntaxTree(view.state)` (the *current*, possibly still-parsing tree — see §3.1).
- Classifies nodes via `tokenClassNodeProp` (`hmd-internal-link`, `link-alias`, `link-alias-pipe`, `link`, `url`, `formatting-link`, `formatting-link-string`).
- Reads the owning file from **`editorInfoField`** (`view.state.field(editorInfoField)`), not from workspace events.
- Resolves targets with `app.metadataCache.getFirstLinkpathDest(linkText, mdInfo.file?.basename ?? "")` and `fetchTargetAttributesSync()` (sync, from metadataCache + dataview API).

### 1.5 Decorations emitted

```ts
let deco = Decoration.mark({ attributes, class: "data-link-text" });   // attributes = { "data-link-<prop>": value, … , "data-href": …, path: … }
let iconDecoBefore = Decoration.widget({ widget: new HeaderWidget(attributes, false) });
let iconDecoAfter  = Decoration.widget({ widget: new HeaderWidget(attributes, true) });
```

`HeaderWidget.toDOM()` creates a `<span>` with `data-*` attributes + CSS custom props (`--<key>`), classed `data-link-icon` / `data-link-icon-after`. `styles.css` reduces to:

```css
span.data-link-text > a.cm-underline { color: inherit; }
```

…which is exactly the child-anchor patch discussed in §3.2.

### 1.6 Refresh triggers for the CM6 extension

From `main.ts` `onload()`:

```ts
this.registerMarkdownPostProcessor((el, ctx) => updateElLinks(this.app, this, el, ctx));

const updateLinks = (_file: TFile) => { updateVisibleLinks(this.app, this); /* + DOM observers */ };

this.app.workspace.onLayoutReady(() => { this.initViewObservers(this); …; updateVisibleLinks(this.app, this); });
this.registerEvent(this.app.workspace.on("window-open", …));

// Update when [metadata changes] — Debounced to prevent lag when writing
this.registerEvent(this.app.metadataCache.on('changed', debounce(updateLinks, 500, true)));

// Update when layout changes
this.registerEvent(this.app.workspace.on("layout-change", debounce(updateLinks, 10, true)));
this.registerEvent(this.app.workspace.on("layout-change", () => this.initViewObservers(this)));
```

**Critically:** `updateLinks` / `updateVisibleLinks` only touch the **DOM** (tab headers, file explorer, backlinks, properties pane, and Reading-view `a.internal-link`s via `querySelectorAll`). They do **not** force the CM6 view plugin to rebuild. The CM6 decorations are therefore refreshed only when:

- a **new editor view is constructed** (i.e. opening/switching to a file → `ViewPlugin` `constructor()` → `buildDecorations()`), or
- `docChanged` / `viewportChanged` fire.

There is **no** `active-leaf-change` handler and **no** `file-open` handler for the CM path, and **no** `workspace.updateOptions()` call. Consequence: after a metadata change, live-preview link decorations can be stale until the file is reopened, edited, or scrolled — a known class of SL complaints (#284, #289, #280).

### 1.7 README claim

> "Live preview, source view, reading mode and the file browser are fully supported in core Obsidian."
> https://github.com/mdelobelle/obsidian_supercharged_links#readme

Note this claim is about *core Obsidian contexts*, not about *platforms* — it says nothing about mobile, and issue #232 contradicts it for mobile.

---

## 2. Does Supercharged Links have any mobile-specific code? (Q2)

**No.** I fetched and grepped **all 20** `.ts/.js/.css/.json` files on `master` (including the bundled `main.js` and `styles.css`) for:

`isMobile`, `Platform`, `is-phone`, `is-tablet`, `is-ios`, `is-android`, `is-mobile`, `mobile`, `Mobile`, `Deferred`, `isDeferred`

→ **zero matches anywhere.** `manifest.json` has `"isDesktopOnly": false`. `version: 0.14.0`, `minAppVersion: 1.11.0`.

**Historical note (worth knowing):** SL *used* to be desktop-gated. Commit [`97d61c8`](https://github.com/mdelobelle/obsidian_supercharged_links/commit/97d61c8861a274093ecd1f4f6fe5e7ff68f2194c) (2021-11-16, "fix: Disabled edit-mode supercharge on mobile to prevent bugs") added:

```ts
if (this.settings.enableEditor && markdownView.getMode() !== "preview" && Platform.isDesktop) { … }
```

That gate applied to the **old DOM-based** editor path (`updateEditorLinks`, CM5-era), which was replaced by the CM6 ViewPlugin in PR [#57](https://github.com/mdelobelle/obsidian_supercharged_links/pull/57) ("Proper implementation of Cm6 live preview supercharging"). The `Platform.isDesktop` gate did **not** carry over into the CM6 path. So the current implementation is *ungated* on mobile — and, per issue #232, *unfixed* on mobile too.

**Takeaway:** there is no SL trick we can copy for mobile. Our fix has to come from first principles (§6).

---

## 3. Known mobile-specific gotchas (Q3)

### 3.1 The syntax tree is only parsed for the first ~3000 characters at view init — and nothing rebuilds on parse completion ⭐ (highest-confidence)

SL issue [#289 "Live preview: links past the first ~3000 characters of a note are never decorated"](https://github.com/mdelobelle/obsidian_supercharged_links/issues/289) (open; analysis + two verified local patches; PR [#290](https://github.com/mdelobelle/obsidian_supercharged_links/pull/290) still open/unmerged as of this research). Quoting verbatim:

> **Cause:** When an editor opens, `@codemirror/language` parses only the first `Work.InitViewport` (3000) characters up front and finishes the rest in the background. `buildDecorations` walks `syntaxTree(view.state)`, the tree as it stands when the view plugin is constructed. `update()` rebuilds only on `docChanged` or `viewportChanged`. The background parse completing is neither, so decorations for the rest of the document are never built.

> **Fix:** Also rebuild when the syntax tree changes, the usual pattern for decorations driven by the syntax tree:
> ```js
> else if (update.viewportChanged || language.syntaxTree(update.startState) !== language.syntaxTree(update.state)) {
>     this.decorations = this.buildDecorations(update.view);
> }
> ```

I verified the constant in upstream CodeMirror source — [`@codemirror/language/src/parse.ts`](https://github.com/codemirror/language/blob/main/src/parse.ts):

```ts
// When initializing the state field (before viewport info is
// available), pretend the viewport goes from 0 to here.
InitViewport = 3000,
// Don't eagerly parse this far beyond the end of the viewport
MaxParseAhead = 1e5,
ChunkBudget = 3000,   // ms of parse work per ChunkTime window
ChunkTime   = 30000,  // ms
MaxPause    = 500,
ChangeBonus = 50,
```

Why this is **worse on mobile**: background parsing is scheduled in idle chunks with a 3000ms/30s budget; on a phone idle time and CPU are scarcer, so the parse frontier advances later. Any decoration pass that runs only on `docChanged`/`viewportChanged` will show *nothing* for the unparsed tail until the user scrolls or types. On a short note whose whole document fits inside the viewport, **scrolling never changes the viewport** → the tail is never decorated at all. That produces the classic "works on desktop, blank on mobile" report.

**Our plugin has exactly this hole.** `src/main.ts` (~line 1172):

```ts
const shouldRebuild = update.docChanged || update.viewportChanged || seedChanged || hashModeChanged || update.focusChanged;
```

No syntax-tree condition. → **Add the `syntaxTree(startState) !== syntaxTree(state)` term.**

### 3.2 CSS/DOM: LP link text lives in a nested `a.cm-underline` with its own color ⭐ (high-confidence for the *color* symptom)

Observed Live Preview DOM structure (reconstructed from multiple independent CSS recipes):

```html
<span class="cm-hmd-internal-link …">              <!-- Obsidian token span -->
  <span class="data-link-text …" data-link-… style="…">   <!-- plugin Decoration.mark -->
    <a class="internal-link cm-underline" href="…">Note</a> <!-- Obsidian's LP anchor: holds the text -->
  </span>
</span>
```

Evidence:

- SL `styles.css`: `span.data-link-text > a.cm-underline { color: inherit; }` — SL's marked span is the **parent** of `a.cm-underline`.
- SL docs snippet (quoted on the community page): `.cm-hmd-internal-link > [data-link-tags ="hide"] { … }` — the `data-link-*` element is a **child** of `span.cm-hmd-internal-link`.
- Forum recipe (Oct 2024): `span.cm-hmd-internal-link:not(:has(.is-unresolved)), span.cm-hmd-internal-link:not(:has(.is-unresolved)) .cm-underline { color: green; }` — you must style `span.cm-hmd-internal-link` **and its descendant `.cm-underline`**.
- Forum (v1.5.11): the bug *"my internal links have turned pink just like my external links"* coincides with Obsidian wrapping internal links in `a.cm-underline` in Live Preview, i.e. the anchor is new-ish.
  - https://forum.obsidian.md/t/setting-separate-internal-and-external-link-colors-in-1-5-11/78934
  - https://forum.obsidian.md/t/change-color-of-internal-links-in-v1-7-7/94870
  - https://forum.obsidian.md/t/styling-internal-links-with-a-different-color/71489

**Why `color: X !important` on the wrapper fails but `--link-color: X` works:** CSS inheritance is not an override — a descendant that *declares* its own `color` (e.g. Obsidian's `.cm-underline`/`.cm-hmd-internal-link` rule reading `var(--link-color)`) keeps it, regardless of `!important` on the ancestor. But a **custom property** set on the ancestor inherits *into* the descendant, so the descendant's own `color: var(--link-color)` resolves to your value. This exactly predicts the #232 observation.

**Decisive diagnostic from SL #271:** the reporter says the link color *does* show **when the link is selected**, and *does* work inside callouts. When the cursor is on a line, Live Preview reveals raw Markdown — the pretty `a.cm-underline` wrapper is gone and the plugin's decoration span carries the text directly, so `color` applies. That is a near-proof of the wrapper-vs-anchor mechanism.

Our plugin's `styles.css` has **no rule for `a.cm-underline`** (only `.cm-line .consistent-link-target`, `.cm-hmd-internal-link .consistent-link-target`, `background-color: transparent !important`, and `.is-mobile … will-change`). Our inline style sets `color`, `-webkit-text-fill-color`, `--link-color`, `--link-external-color` (all `!important`) on the mark span. That is *closer* to correct than SL's default, but it only helps if the anchor is a **descendant** of our span. If the anchor sits *outside* our span (sibling/ancestor nesting determined by precedence), neither the `color` nor the inherited var reaches the text → exactly the observed "no color on mobile".

Also see SL #271 comment: *"Also weirdly the color is applied properly if the link is within a callout"* — callouts render through a different element path.

### 3.3 `Prec` ordering determines whether your span wraps the anchor

SL uses `Prec.lowest(...)`. CM6 nesting of competing mark decorations follows extension precedence; getting it wrong can put your span on the wrong side of Obsidian's `span.cm-hmd-internal-link` / `a.cm-underline`, which decides whether inherited custom properties and `color: inherit` reach the text. Our plugin registers the extension bare. **Test both `Prec.lowest` and `Prec.highest`.**

### 3.4 Mobile "deferred views" — the editor may not exist yet

Official typings ([obsidian-api `obsidian.d.ts`](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts), `WorkspaceLeaf`, since 1.7.2):

```ts
/**
 * Returns `true` if this leaf is currently deferred because it is in the background.
 * A deferred leaf will have a DeferredView as its view, instead of the View that
 * it should normally have for its type (like MarkdownView for the `markdown` type).
 */
get isDeferred(): boolean;
/** If this view is currently deferred, load it and await that it has fully loaded. */
loadIfDeferred(): Promise<void>;
```

and on `Workspace.revealLeaf`:

> "`await` this function to ensure your view has been fully loaded and is not deferred."

Implications:
- Iterating leaves on mobile can hit `DeferredView`s with **no editor, no `EditorView`, no `visibleRanges`** — anything that crawls `leaf.view.editor.cm` (including our `src/debug-mobile.ts`) must skip `leaf.isDeferred` or `await leaf.loadIfDeferred()`.
- Background leaves never get their CM6 editor built, so any decoration work that presumes "view exists ⇒ plugin constructed" is wrong on mobile.
- When a deferred view is loaded, the editor may be constructed while the container is not yet measured → `visibleRanges` may be effectively empty at constructor time (see §3.5). Rebuilding on `viewportChanged` is supposed to heal this — but only if the viewport actually changes.

### 3.5 `visibleRanges` is empty/trivial while the view is hidden or unmeasured

CM6 reference (https://codemirror.net/docs/ref/#view.EditorView.visibleRanges):

> "…the subset of the viewport that is actually drawn."
> `inView: boolean` — "Returns false when the editor is entirely scrolled out of view **or otherwise hidden**."

If a `ViewPlugin` builds decorations from `visibleRanges` while the view is hidden/unmeasured, it emits nothing; recovery depends on a later `viewportChanged`. Our buildDecorations even *detects* this (`if (isMobile && visibleRanges.length === 0) console.warn(...)`) but does not act on it. Consider also rebuilding on `update.geometryChanged` and/or a deferred `requestAnimationFrame` rebuild after construction, and/or falling back to the full document (or `EditorView.viewport`) when `visibleRanges` is degenerate.

### 3.6 iOS editor CSS surface genuinely differs from desktop — confirmed

Forum thread *"CSS value for editing text in edit mode on mobile devices"* (Sep 2024), by long-time forum contributor `ariehen`:

> "Ah ha! You stumbled upon **one of the few snippets that does work on desktop and Android(?), but doesn't work on iOS/iPadOS**: `text-align: justify` in the editor (in Reading view it's fine). **It worked up until mobile version 1.4.4 (99), but hasn't worked from then on.** I asked the team about it a while ago on Discord and **it was speculated it was CodeMirror (the editor "engine") related**, but not sure why it stopped working."

https://forum.obsidian.md/t/css-value-for-editing-text-in-edit-mode-on-mobile-devices/87977

Same thread lists the mobile root classes: `.is-mobile`, `.is-tablet`, `.is-phone`, `.is-ios`, `.is-android` (`.is-android` "in the default app.css" — i.e. **`app.css` does contain mobile-scoped rules**, which is a plausible home for a mobile-specific `.cm-underline` / link-color rule that outranks a plugin's snippet).

This is the single best external confirmation that **the iOS Obsidian editor's CSS cascade is not the desktop cascade** — exactly the shape of the bug we have.

### 3.7 Android WebView / keyboard variance

*"Links are not consistently active in live preview – mobile (Android phone) app"* — https://forum.obsidian.md/t/links-are-not-consistently-active-in-live-preview-mobile-android-phone-app/87384

Symptom: a freshly typed `[[link]]` in Live Preview doesn't "become" a rendered link until you type a space / move lines; one user fixed it by switching keyboard (Gboard → FUTO). Root cause is timing/interaction, not decorations — but it shows mobile Obsidian behaviour varies by **OS WebView version + IME**, so "works on my device" is weak evidence on mobile.

### 3.8 `registerEditorExtension` reconfigure semantics

Official API docs (https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorExtension):

> "Registers a CodeMirror 6 extension. **To reconfigure cm6 extensions for a plugin on the fly, an array should be passed in, and modified dynamically. Once this array is modified, calling `Workspace.updateOptions()` will apply the changes.**"

and https://docs.obsidian.md/Reference/TypeScript+API/Workspace/updateOptions:

> "Calling this function will update/reconfigure the options of all Markdown views. It is fairly expensive, so it should not be called frequently."

Both SL and our plugin pass a single extension, so neither can hot-swap behaviour (e.g. a mobile branch) at runtime. If we want to try different extensions per platform, register an **array** and call `app.workspace.updateOptions()` after mutating it. (Also useful for forcing a rebuild after settings changes instead of relying on a captured settings object.)

### 3.9 Metadata-cache timing on mobile (hypothesis — flagged as lower confidence)

On mobile cold start the metadata index may not be ready when the first editor opens. SL guards with `if (!cache) return new_props;` and, per [#85c41d1](https://github.com/mdelobelle/obsidian_supercharged_links/commit/85c41d1), a dataview-late-load crash fix. Our plugin derives colors purely from settings + link text (no `metadataCache`), so we are *less* exposed — but if we ever resolve targets, this is a mobile hazard. Also note SL [#289]'s second bug: their "after" widget needed an explicit flush at the end of the walk; a reminder that incremental decoration building has off-by-one/flush hazards.

---

## 4. How to debug mobile Obsidian plugins (Q4)

### 4.1 Official documentation (primary source)

https://docs.obsidian.md/Plugins/Getting+started/Mobile+development (source: https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Getting%20started/Mobile%20development.md)

- **Emulate mobile on desktop** — in DevTools console:
  ```ts
  this.app.emulateMobile(true);   // enable
  this.app.emulateMobile(false);  // disable
  this.app.emulateMobile(!this.app.isMobile); // toggle
  ```
  This sets the `.is-mobile` class and `Platform.isMobile*` flags, so it exercises the CSS path (very useful for §3.2/§3.6), **but it cannot reproduce mobile WebKit/WebView quirks or mobile parse timing** — a green run under emulation does *not* exonerate a mobile-only bug.
- **Android**: enable USB debugging → connect via USB → open a Chromium browser on the desktop → `chrome://inspect/` → inspect the WebView (full devtools).
  - More: https://developer.chrome.com/docs/devtools/remote-debugging
  - Community guide (quoted by Obsidian dev `joethei` on the forum): enable ADB on the phone, connect USB, `chrome://inspect` — https://forum.obsidian.md/t/getting-my-plugin-working-on-mobile-devices/29816
- **iOS**: requires **iOS/iPadOS 16.4+** and a **macOS** machine; use Safari's **Web Inspector**.
  - https://webkit.org/web-inspector/enabling-web-inspector/
- Also documented mobile JS gotchas: no Node/Electron APIs; **regex lookbehind only on iOS 16.4+**.

### 4.2 On-device console without a host machine

- **vConsole plugin** (community, `Desktop, Mobile`, MIT, ~5k downloads, `minAppVersion 1.5.3`) — "Integrate vConsole for developers to facilitate the debugging of mobile plugins… debugging mobile plugins is usually quite troublesome, requiring specific work for both Android and iOS."
  https://community.obsidian.md/plugins/vconsole
  **This is the recommended no-Mac option for iOS** (works on iPhone/iPad with no cable).
- **eruda** ("Console for mobile browsers", 21k★) — https://github.com/liriliri/eruda — can be injected into a plugin for an in-app console; also has iOS/Android wrapper apps. Same idea as vConsole.
- Obsidian's own **"Show debug info"** (Settings → General) — environment dump only.
- The Obsidian Hub guide *"How to update your plugins and CSS for live preview"* (published by an Obsidian dev) is useful background on the CM5→CM6 API shift:
  https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/How+to+update+your+plugins+and+CSS+for+live+preview

### 4.3 Recommended combination for our bug

1. Desktop: `this.app.emulateMobile(true)` → check whether the colors still render (isolates CSS-path issues).
2. Android (if available): `chrome://inspect` → inspect a link in LP and **read the actual DOM** — this settles §3.2 definitively (where does `.consistent-link-target` sit relative to `a.cm-underline`? whose `color` wins in the Computed panel?).
3. iOS (no Mac): install **vConsole**, then run our existing `src/debug-mobile.ts` diagnostics (`runDiagnostics(plugin)`) to compare `visibleRanges`, link-node counts, and `document.querySelectorAll('.consistent-link-target').length`.
4. Add a temporary `console.log` on every `update()` reporting `{docChanged, viewportChanged, geometryChanged, focusChanged, syntaxTreeChanged}` to see whether the plugin simply is not being asked to rebuild (supports §3.1).

Caveat for the existing debug helper: `src/debug-mobile.ts` uses `leaf.view.editor.cm` and `require("@codemirror/language")` inside a page context (no `require` in Obsidian) — both will break; use the leaf's public `editMode`/`EditorView` reference and top-level imports, and skip `leaf.isDeferred` leaves.

---

## 5. Mobile + CodeMirror throttling; does Obsidian gate extensions on mobile? (Q5)

**No official statement exists that Obsidian mobile disables, reorders, or delays plugin editor extensions, and I found no evidence that it does.** What I can state with sources:

- **Obsidian uses CM6 on every platform.** Obsidian dev *joethei* on the CM6.0 HN thread (Jun 2022):
  > "This is correct, **Obsidian uses CM6 on all platforms**. A CM5 based editor is still available as 'Legacy Editor' in the settings on desktop, to support older plugins. **Mobile was always using a CM6 editor**, while desktop only got CM6 some time after that."
  https://news.ycombinator.com/item?id=31666186
  And the CM6 team's rationale: *"it's also one of the only code editors that work decently on mobile."* (same thread)
- The Obsidian dev docs on [Editor extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions), [View plugins](https://docs.obsidian.md/Plugins/Editor/View+plugins), [State fields](https://docs.obsidian.md/Plugins/Editor/State+fields), [Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations) contain **no mobile caveats whatsoever**; the only mobile-specific developer page is the debugging/`Platform`/`isDesktopOnly` page.
- `registerEditorExtension` is documented with no platform caveat: https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorExtension
- The real throttles are **inside CodeMirror**, not Obsidian: `Work.InitViewport = 3000`, `ChunkBudget = 3000`/`ChunkTime = 30000`, `MaxParseAhead = 1e5`, `MaxPause = 500`, `ChangeBonus = 50`, and the idle-thread scheduler in `@codemirror/language` (see §3.1). Plus the documented `inView`/`isDeferred` view-lifecycle realities (§3.4/§3.5).
- Platform gating that *does* exist: `isDesktopOnly` in `manifest.json` (install-time), and `Command.mobileOnly` (API). Neither throttles extensions.

**Practical conclusion:** the correct mental model is *"CM6 extensions always run on mobile, but the view lifecycle and the CSS cascade differ (deferred views, unmeasured viewports, slower background parsing, iOS app.css overrides)."*

---

## 6. Likely differences vs our plugin — checklist

Our plugin facts confirmed from this repo (`link-colorer` v2.0.8, `isDesktopOnly:false`):
`src/main.ts` `createLinkColorExtension()` (~L1142–1324), `generateStyleString()` (~L1460), `styles.css` §"Link Color Override Rules"/"Mobile-Specific Styles", `src/debug-mobile.ts`.

| # | Aspect | Supercharged Links | Our plugin | Verdict / action |
|---|---|---|---|---|
| 1 | **Rebuild predicate** | `docChanged` (incremental) ▸ else `viewportChanged` (full) | `docChanged` (full) ‖ `viewportChanged` ‖ `focusChanged` ‖ seed/hash change | **Neither** rebuilds when the background syntax-tree parse completes. Add `language.syntaxTree(update.startState) !== language.syntaxTree(update.state)` (SL #289 / PR #290). Highest-value fix. |
| 2 | **Coloring channel** | CSS classes (`data-link-text`/`data-link-icon*`) + `data-link-*` attrs; color applied by a **generated CSS snippet** with `color: … !important`; **plus** `span.data-link-text > a.cm-underline { color: inherit; }` in `styles.css`; also exposes `--data-link-*` custom props | Inline `style` on the mark span: `color`, `-webkit-text-fill-color`, `--link-color`, `--link-external-color`, all `!important` | Ours lacks any rule for the inner **`a.cm-underline`**. Add: `.consistent-link-target, .consistent-link-alias { }` + a child-anchor neutraliser, e.g. `.cm-hmd-internal-link a.cm-underline, .cm-line a.cm-underline { color: inherit !important; -webkit-text-fill-color: inherit !important; }` (or make the anchor inherit). Then `color`/`-webkit-text-fill-color` on our span reaches the text. |
| 3 | **Where the text node actually lives** | documented as parent of `a.cm-underline` | unknown — `styles.css` uses `.cm-hmd-internal-link .consistent-link-target` (descendant), implying our span is *inside* Obsidian's token span | **Verify in a real mobile DOM** (chrome://inspect / Web Inspector / vConsole). If the anchor is a **sibling/ancestor** of our span, the inline `--link-color` cannot reach it — set the variable on a broader ancestor instead (e.g. `.cm-content`, or a per-line `Decoration.line` carrying the var). |
| 4 | **CM6 precedence** | `Prec.lowest(buildCMViewPlugin(...))` | bare extension, no `Prec` | Precedence decides whether our span wraps or is wrapped by Obsidian's `span.cm-hmd-internal-link` / `a.cm-underline`. Test `Prec.lowest` **and** `Prec.highest`. |
| 5 | **`visibleRanges` degeneracy** | same weakness (builds from `visibleRanges`) | same, plus a `console.warn` when empty but **no recovery** | Add recovery: rebuild on `geometryChanged`, and/or a post-construction deferred rebuild, and/or fall back to the whole doc / `view.viewport` when `visibleRanges` is empty/degenerate. |
| 6 | **Deferred leaves** | n/a (DOM walker) | `debug-mobile.ts` walks `leaf.view.editor.cm` unguarded | Skip `leaf.isDeferred` or `await leaf.loadIfDeferred()` (official API, 1.7.2+). |
| 7 | **File context** | `view.state.field(editorInfoField)` (correct, per-view) | derives color from settings + link text only | Lower risk on mobile; keep it that way if possible. |
| 8 | **Reading-view/other-surface refresh** | `layout-change` + `metadataCache 'changed'` + `onLayoutReady` + per-view `MutationObserver`s | `markdownPostProcessor` + `layout-change` + `active-leaf-change` + `css-change`, mobile `resize` + debounce | Fine; not the LP bug. But note neither plugin forces a **CM6** rebuild on metadata change — consider calling `app.workspace.updateOptions()` or a dedicated `StateEffect` to invalidate decorations after theme/metadata changes instead of relying on the next keystroke. |
| 9 | **Platform detection** | none | `(this.app as any).isMobile ?? false` and `document.body.classList.contains("is-mobile")` in `debug-mobile.ts:52` | Prefer the documented `Platform.isMobileApp` / `Platform.isIosApp` (https://docs.obsidian.md/Plugins/Getting+started/Mobile+development, https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts). Note `app.emulateMobile()` flips these, which is handy for testing. |
| 10 | **Guessed mobile CSS** | none | `styles.css` has `.is-mobile … { transition / will-change: color }` "mobile WebKit repaint" hacks | These are speculative and unlikely to matter. Replace them with a verified fix from §6.2/§6.4 rather than accumulating cargo-cult CSS. |
| 11 | **Registration form** | single extension | single extension | If you want a mobile branch, pass an **array** and mutate it + `app.workspace.updateOptions()` (documented). |

### Suggested experiment order

1. Add the syntax-tree-change rebuild term (cheap, definitively correct, fixes #289-class symptoms). Retest on mobile.
2. In LP on a mobile device, inspect a colored link's DOM. Decide between: (a) add `a.cm-underline { color: inherit !important }`, (b) move the inline custom-property assignment to a broader ancestor, (c) both.
3. Flip `Prec.lowest` ↔ `Prec.highest` to see if nesting changes the outcome.
4. Add `geometryChanged` rebuild + empty-`visibleRanges` fallback.
5. Only if all of the above fails, suspect a genuinely mobile-only extension/timing issue and instrument with vConsole/Web Inspector to see whether `update()` is even called.

---

## 7. Source list

Primary (code / official docs / typings)
- Supercharged Links repo: https://github.com/mdelobelle/obsidian_supercharged_links
- `src/linkAttributes/livePreview.ts`: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/src/linkAttributes/livePreview.ts
- `main.ts`: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/main.ts
- `src/linkAttributes/linkAttributes.ts`: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/src/linkAttributes/linkAttributes.ts
- `styles.css`: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/styles.css
- `src/cssBuilder/cssBuilder.ts` (generates `supercharged-links-gen.css` with `color: var(--…-color) !important` + Style Settings block): https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/src/cssBuilder/cssBuilder.ts
- manifest: https://github.com/mdelobelle/obsidian_supercharged_links/blob/master/manifest.json
- SL issue #232 (mobile edit view not colored): https://github.com/mdelobelle/obsidian_supercharged_links/issues/232
- SL issue #271 (no coloring in LP; "shows when selected"; iPad works/iPhone hit-or-miss): https://github.com/mdelobelle/obsidian_supercharged_links/issues/271
- SL issue #279 (internal link color not working): https://github.com/mdelobelle/obsidian_supercharged_links/issues/279
- SL issue #289 (links past ~3000 chars never decorated; InitViewport analysis + fix): https://github.com/mdelobelle/obsidian_supercharged_links/issues/289
- SL PR #290 (fix, open/unmerged): https://github.com/mdelobelle/obsidian_supercharged_links/pull/290 / diff: https://github.com/mdelobelle/obsidian_supercharged_links/pull/290.diff
- SL issue #270 (mobile/Bases, mixed results; HEmile: "I tried on mobile and it works for me"): https://github.com/mdelobelle/obsidian_supercharged_links/issues/270
- SL issue #140 (unable to load on mobile; version mismatch): https://github.com/mdelobelle/obsidian_supercharged_links/issues/140
- SL PR #57 (original CM6 live-preview implementation): https://github.com/mdelobelle/obsidian_supercharged_links/pull/57
- SL commit 97d61c8 "Disabled edit-mode supercharge on mobile to prevent bugs" (historical `Platform.isDesktop` gate): https://github.com/mdelobelle/obsidian_supercharged_links/commit/97d61c8861a274093ecd1f4f6fe5e7ff68f2194c
- Obsidian dev docs — Mobile development (emulateMobile, chrome://inspect, Web Inspector, Platform): https://docs.obsidian.md/Plugins/Getting+started/Mobile+development
- Obsidian dev docs — Editor extensions / View plugins / State fields / Decorations: https://docs.obsidian.md/Plugins/Editor/Editor+extensions · https://docs.obsidian.md/Plugins/Editor/View+plugins · https://docs.obsidian.md/Plugins/Editor/Decorations
- `Plugin.registerEditorExtension` (array + `updateOptions()` semantics): https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerEditorExtension
- `Workspace.updateOptions`: https://docs.obsidian.md/Reference/TypeScript+API/Workspace/updateOptions
- obsidian-api typings (`isDeferred`, `loadIfDeferred`, `revealLeaf`, `Platform`, `MarkdownEditView`): https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
- CodeMirror 6 reference — `visibleRanges`, `inView`: https://codemirror.net/docs/ref/#view.EditorView.visibleRanges
- `@codemirror/language` parse scheduler (`InitViewport = 3000`, `ChunkBudget`, `MaxParseAhead`): https://github.com/codemirror/language/blob/main/src/parse.ts
- Obsidian dev comment that CM6 is used on all platforms: https://news.ycombinator.com/item?id=31666186

Secondary (community threads — used only to corroborate DOM/CSS/behaviour)
- Separate internal/external link colors after 1.5.11 (`a.cm-underline` introduced): https://forum.obsidian.md/t/setting-separate-internal-and-external-link-colors-in-1-5-11/78934
- Change color of internal links in v1.7.7 (`span.cm-hmd-internal-link … .cm-underline`): https://forum.obsidian.md/t/change-color-of-internal-links-in-v1-7-7/94870
- How to change internal/external link color in LP & reading view: https://forum.obsidian.md/t/how-to-change-internal-and-external-link-color-in-the-live-preview-reading-view/89421
- Styling internal links with a different color (`:has([data-link-path…])`): https://forum.obsidian.md/t/styling-internal-links-with-a-different-color/71489
- iOS editor CSS diverges (text-align: justify broken since mobile 1.4.4, "CodeMirror related"); mobile classes `.is-mobile/.is-phone/.is-ios/.is-android`: https://forum.obsidian.md/t/css-value-for-editing-text-in-edit-mode-on-mobile-devices/87977
- Android: link activation/timing variance, keyboard-dependent: https://forum.obsidian.md/t/links-are-not-consistently-active-in-live-preview-mobile-android-phone-app/87384
- Android devtools via ADB + chrome://inspect (guide quoted by Obsidian dev joethei): https://forum.obsidian.md/t/getting-my-plugin-working-on-mobile-devices/29816
- vConsole community plugin (mobile in-app console): https://community.obsidian.md/plugins/vconsole
- eruda mobile console: https://github.com/liriliri/eruda
- `this.app.emulateMobile(true)` for theming/mobile-class work: https://forum.obsidian.md/t/obsidian-css-inspector-workflow/58178
- SL docs (community mirror, shows the `data-link-*` selectors and the `.cm-hmd-internal-link > [data-link-*]` nesting): https://www.obsidianstats.com/plugins/supercharged-links-obsidian
- Hub guide "How to update your plugins and CSS for live preview": https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/How+to+update+your+plugins+and+CSS+for+live+preview

---

## 8. Confidence / uncertainty ledger

- **High confidence:** SL has no mobile-specific code; SL #232/#271/#279 are open and describe exactly our symptom; CM6 view-plugin decorations *do* run on mobile; `InitViewport = 3000` + "no rebuild on syntax-tree change" is a real, documented SL bug with a verified fix; official mobile debugging methods; no official mobile gating of editor extensions.
- **Medium-high confidence:** the nested-`a.cm-underline` CSS mechanism (multiple independent CSS recipes agree on the DOM shape; #232's `--link-color` observation and #271's "visible when selected / inside callouts" both fit it precisely; the only gap is that I could not read Obsidian's shipped `app.css` for mobile to see the exact competing rule).
- **Uncertain / needs on-device verification:** exactly where our `.consistent-link-target` span sits relative to `a.cm-underline` in a *mobile* DOM; whether our inline `--link-color` therefore reaches the text; whether `Prec` ordering changes this; whether mobile parse timing alone explains the total absence of color (vs. only the tail of long notes).
- **Not found (negative result):** any official Obsidian statement or issue indicating mobile disables, reorders, or defers plugin editor extensions; any SL mobile workaround in code; any documented `visibleRanges`-empty-on-mobile bug specific to Obsidian.
