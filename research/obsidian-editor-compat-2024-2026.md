# Obsidian editor compatibility research — Link Colorer plugin

**Researched:** 2026-08-26
**Plugin under analysis:** `/Users/caffae/Notes/TestPlugin/.obsidian/plugins/links-coloring`
- Uses `registerEditorExtension` + CM6 `ViewPlugin.fromClass` + `RangeSetBuilder` + `Decoration.mark` for Live Preview
- Uses `registerMarkdownPostProcessor` for Reading View
- `manifest.json` declares `minAppVersion: 0.15.0`
- Pins `@codemirror/state 6.5.4`, `@codemirror/view 6.39.11`, `@codemirror/language 6.12.1` in `package.json`
- All `@codemirror/*` + `@lezer/*` packages are `external` in `esbuild.config.mjs` (not bundled)

---

## 1. Recent editor changes community plugins have had to adapt to (2024–2026)

The most plugin-relevant editor changes come from **CodeMirror 6 (CM6) bundle upgrades** and a **deferred/lazy view-loading** change. Timeline of confirmed, official changelog entries:

- **1.7.2 / 1.7.4 (Sep–Oct 2024):** "Views now load only when visible, improving startup performance and memory usage. **This might cause issues with some plugins**" — Obsidian published a dev guide "Understanding deferred views". Reading views are now created lazily, which changes when `onload`/rendering code runs.
- **1.8.0 (Dec 2024) & 1.8.3 (Jan 2025):** "Upgraded CodeMirror to the latest version" (stated in both releases' Third-party Libraries sections).
- **1.9.x (May–Oct 2025):** In-app checks for plugins known to break with 1.9 (Commander v0.5.3, "Image Toolkit"); several Live Preview / CodeMirror rendering fixes.
- **1.10.0 (Oct 2025):** "Fixed CodeMirror tooltip position issues for plugins by defaulting to absolute position."
- **1.12.x (Feb–Mar 2026):** Editor regressions fixed in 1.12.6; Electron updates.
- **1.13.0 (May 2026) & 1.13.4 (Jul 2026):** "Upgraded CodeMirror to the latest version" (again), plus "Base colors migrated to OKLCH colorspace" and a **breaking change**: `--callout-color` now expects a valid CSS color instead of an RGB triplet. Not directly link-coloring but a theming breaking change.
- **1.13.x settings revamp (1.13.0/1.13.4):** new settings window, `SettingGroup`, `SettingDefinitionBase#disabled`, `ConfirmationModal`. Optional for this plugin.

**Key takeaway:** The recurring, community-relevant change is that **Obsidian bumps its bundled CM6 ("upgraded to the latest version") several times per year** (confirmed at least 1.8.0, 1.8.3, 1.13.0, 1.13.1, 1.13.4). Because plugins mark CM packages as `external`, plugin code resolves against whatever CM6 build Obsidian ships at runtime — the same public APIs (`ViewPlugin`, `Decoration`, `RangeSetBuilder`, `syntaxTree`) have been stable, but the runtime minor/patch versions move under the plugin.

---

## 2. `registerEditorExtension`, `ViewPlugin.fromClass`, `Decoration.mark`, `RangeSetBuilder` — still the recommended API?

**Yes — all of these remain the current, officially recommended APIs.** The official dev docs (live, current) use exactly these:

- **Editor extensions:** docs.obsidian.md/Plugins/Editor/Editor+extensions — "Obsidian uses CodeMirror 6 (CM6)… An Obsidian *editor extension* is the same thing as a *CodeMirror 6 extension*." Register via `registerEditorExtension()` in `onload`.
- **Decorations:** docs.obsidian.md/Plugins/Editor/Decorations — recommends `RangeSetBuilder` + `Decoration.replace` (and mark/line/widget). It explicitly endorses the **view-plugin** pattern for viewport-based decorations and shows `ViewPlugin.fromClass(...)` with a `decorations` PluginSpec property returning `value.decorations`.
- **View plugins:** docs.obsidian.md/Plugins/Editor/View+plugins — `ViewPlugin.fromClass()` with `constructor`/`update`/`destroy` is the documented pattern.

The exact pattern this plugin uses (a `ViewPlugin.fromClass` whose `update()` calls a `buildDecorations()` using `view.visibleRanges` + `RangeSetBuilder` + `Decoration.mark`) is precisely the pattern the official Decorations guide teaches. No deprecation is signalled anywhere. The plugin's `Decorations` doc also notes: "If you can implement your extension using either approach, then the **view plugin generally results in better performance**" — matching this plugin's choice.

**One nuance:** if a view plugin's decorations ever need to change the *viewport geometry* (e.g. wrap/replace), you'd need a StateField instead. For pure link *coloring* via `Decoration.mark`, a view plugin is correct.

---

## 3. `registerMarkdownPostProcessor` timing / DOM behavior in Reading View, hover, embeds

- The official doc (docs.obsidian.md/Plugins/Editor/Markdown+post+processing) confirms post-processors run **after** Markdown → HTML and mutate the rendered DOM (`el`). That contract is unchanged.
- **The big timing change is "deferred views" (1.7.x).** Since 1.7, Markdown reading views / preview panes are created only when they become visible, which changes *when* a post-processor first runs and when workspace `layout-change` fires. Community plugins that naively assumed views exist at load had to adapt. This plugin already reacts to `layout-change` and re-observes reading views (`setupReadingViewObservers`), which is the recommended defensive pattern.
- Changelog fixes related to hover/page-preview + reading view rendering that plugin authors should be aware of:
  - 1.9.10/1.11.4: "Fixed display of bolded links in reading mode (e.g. `**[[link]]**`)" — directly relevant to link styling in reading view.
  - 1.13.1/1.13.4: "Live Preview: Code blocks now re-render correctly when a plugin's post processor changes."
  - 1.10.3: The app now opens the last editor while the rest loads in background.
- `registerMarkdownPostProcessor` itself has **not changed** in signature or core DOM contract through 2024–2026. It runs on every rendering pass, including page previews / embedded Markdown (embeds render via the same post-process pipeline).

---

## 4. Recommended `minAppVersion` baseline & accuracy policy

- **Official policy** (docs.obsidian.md/community-directory/submission-requirements-for-plugins, section "Set an appropriate minAppVersion"): `minAppVersion` should be **the minimum required version your plugin is compatible with**. If unsure, "use the latest stable build number."
- Manifest reference (docs.obsidian.md/Reference/Manifest): `minAppVersion` is **required**; it is "The minimum required Obsidian version."
- The plugin validation workflow in `obsidian-releases` only checks that `minAppVersion` is present/valid, not that it's maximally recent — but reviewers expect accuracy.
- **For this plugin:** declaring `0.15.0` while shipping code that relies on CM6 editor extensions and Reading-View post-processors is the *correct* floor (0.15.0 introduced Live Preview/CM6 editor extensions), and it will not hurt compat since CM6 APIs are stable. However, the plugin now also uses:
  - `FileManager.generateMarkdownLink` behavior changes (1.10: no longer prepends "!" on attachment links) — not used here.
  - OKLCH / `--callout-color` breaking change (1.13.4) — **this plugin's palette styles could be affected if it sets link colors via callout-derived variables**, worth checking `styles.css`. If the plugin targets users on 1.13+ and uses OKLCH-compatible colors, no action; if it hardcodes RGB-triplet CSS anywhere it should be reviewed.
- **Pragmatic recommendation:** Keep `minAppVersion` at a version where the code's APIs actually exist. 0.15.0 is the natural floor for CM6 editor extensions. If you want CM6 / reading-view fixes from 2024–2026, you can raise it to 1.7+ / 1.8+, but there's no API the plugin uses that *requires* that — so **no change is strictly required**, just verify against current stable (1.13.x) and update `minAppVersion` only if you bump the required floor intentionally.

---

## 5. Known compatibility issues / breaking changes around Obsidian 1.7/1.8/1.9 affecting CM6 decorations & reading-view link rendering

- **CM6 upgrades** in 1.8.0, 1.8.3, 1.13.0, 1.13.1, 1.13.4 ("upgraded to latest"). Obsidian generally keeps the extension API stable, so `Decoration.mark`/`RangeSetBuilder` keep working. The main class of breakage is when a plugin **bundles** its own older CM6 copy instead of marking it external — it then fights Obsidian's newer CM. This plugin correctly marks CM6 as external, so it's on the safe path.
- **1.9.0/1.10.0:** deprecated plugins known to break with 1.9; 1.10 added an `open-link` event and changed `generateMarkdownLink` (not used).
- **1.13.4:** base colors migrated to OKLCH; `--callout-color` now requires a valid CSS color (breaking for themes/plugins that used `255,0,0`-style triplets).
- No official record of `Decoration.mark` or reading-view link rendering being broken by 1.7–1.9. Community reports of plugin breakage in 1.9 centered on: Commander's toolbar, Image Toolkit menus, and CM tooltip positioning — not mark decorations.

---

## 6. Import `@codemirror/*` directly, or use Obsidian's re-exports?

**Best practice: import the `@codemirror/*` packages directly and mark them `external` in the bundle — do not bundle your own copy, and do not rely on Obsidian "re-exports."**

Evidence:
- The **official `obsidian-sample-plugin`** `esbuild.config.mjs` marks these `external`: `@codemirror/autocomplete`, `collab`, `commands`, `language`, `lint`, `search`, `state`, `view`, plus `@lezer/*` and `obsidian`. This plugin's config already matches this exactly.
- The `obsidian` npm API package declares **peerDependencies** on `@codemirror/state` (currently **6.7.0**) and `@codemirror/view` (currently **6.43.5**). These tell you the CM versions the bundled `obsidian.d.ts` types assume.
- **Version drift risk is real:** Obsidian ships its own CM6 build at runtime; because the plugin's CM6 is `external`, whatever version you list in `package.json` is essentially for **type-checking only** — the runtime comes from Obsidian. If your pinned versions (this plugin: state 6.5.4 / view 6.39.11) are **older** than the peer-dependency baseline (state 6.7.0 / view 6.43.5), TypeScript may show type mismatches and you may miss newer APIs, but runtime still works because Obsidian resolves the modules. Conversely, don't rely on properties only present in your locally-bundled version.

**Actionable recommendation:** bump the plugin's `@codemirror/state` to `6.7.x` and `@codemirror/view` to `6.43.x` (matching the current `obsidian` peerDependencies) so types align with Obsidian's bundled runtime; keep them in `devDependencies` or as `dependencies` that remain `external` at build time. Do **not** switch to removing them (Obsidian does not expose a documented re-export namespace to import from; the documented CM import path is `@codemirror/state`, `@codemirror/view`, `@codemirror/language` directly).

---

## Sources / links

Official docs (Obsidian Developer Documentation):
- Editor extensions: https://docs.obsidian.md/Plugins/Editor/Editor+extensions
- Decorations (RangeSetBuilder + ViewPlugin + Decoration.mark): https://docs.obsidian.md/Plugins/Editor/Decorations
- View plugins: https://docs.obsidian.md/Plugins/Editor/View+plugins
- Markdown post processing: https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing
- Manifest / minAppVersion: https://docs.obsidian.md/Reference/Manifest
- Submission requirements (minAppVersion policy): https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- Developer policies: https://docs.obsidian.md/community-directory/developer-policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

Changelog (primary source for dates/versions):
- https://obsidian.md/changelog/ (1.13.x)
- https://obsidian.md/changelog/page/2/ (1.12.x, 1.13.0)
- https://obsidian.md/changelog/page/3/ (1.11.x, 1.12.0)
- https://obsidian.md/changelog/page/4/ (1.9.x–1.11.0)
- https://obsidian.md/changelog/page/5/ (1.9.x)
- https://obsidian.md/changelog/page/6/ (1.9.x)
- https://obsidian.md/changelog/page/7/ (1.8.x, 1.9.0)
- https://obsidian.md/changelog/page/8/ (1.7.x, 1.8.x)

Code & config (repos):
- obsidian-api package.json (peerDependencies CM versions): https://github.com/obsidianmd/obsidian-api/blob/master/package.json
- obsidian-sample-plugin esbuild config (external CM): https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs
- obsidian-releases (plugin validation): https://github.com/obsidianmd/obsidian-releases

Note: Obsidian docs site is JS-rendered; page bodies were retrieved via the underlying Obsidian Publish access endpoint (`publish-01.obsidian.md/access/...`), so the above doc URLs correspond to the same content.
