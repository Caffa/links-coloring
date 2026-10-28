# Bug investigation: "Link collision statistics modal shows no data"

Date: 2026-10-28
Scope: read-only investigation of `links-coloring` (manifest id `link-colorer`, v2.0.8, HEAD `209abd4`).
Method: full source read + git history + a headless harness that bundles `src/main.ts` with stubbed
`obsidian` / CodeMirror modules and drives the real code paths (no source files modified).

Harness lives outside the repo:
`/private/var/folders/_f/yl55mbxj0pb74hvxpsptw31w0000gn/T/opencode/collrepro/`
(`build2.cjs`, `build3.cjs`, `harness.cjs`, `harness2.cjs`, `harness3.cjs`, `stubs/`).

---

## TL;DR

The modal's *display* logic is correct — when the in-memory maps contain entries it renders counts,
percentages, variants and table columns properly (verified). The bug is in the **data lifecycle**:
the statistics are a snapshot of two module-level caches that are repeatedly wiped by routine
plugin behaviour, and several render paths deliberately colour links **without** recording them.

Three credible root causes, in order of confidence:

1. **`resetColorState()` + the CodeMirror "hash mode changed" cache clear wipe the colour map after
   every reroll/folder switch, and `precomputedFiles` prevents it from ever being repopulated for the
   same file** (`main.ts:1042-1055`, `main.ts:1175-1178`, `main.ts:396-398`).
2. **Live Preview never records statistics at all** — every CM6 decoration call passes
   `shouldCache: false` (`main.ts:1323-1328`, `main.ts:1337-1342`), so stats depend entirely on
   precompute-on-file-open and reading-view DOM passes.
3. **Eviction asymmetry between the two caches** (`LRUCache.has()` does not promote, `lru-cache.ts:66-68`),
   so with a 14k-note vault (tier `very-large`, cache 8000, 45 s precompute cooldown) the palette-index
   map silently degrades to FIFO and desyncs from the colour map (`main.ts:1420-1425`).

Reproduced (harness2 output):

```
[1 after onload/precompute]                 colors=3 paletteIdx=3
[2 after live-preview render (decorations=2)] colors=3 paletteIdx=3   <- render added nothing
[3 after reroll + CM update + LP re-render]  colors=0 paletteIdx=0    <- empty while links coloured
[5 after opening NEW file B]                 colors=4 paletteIdx=4
[6 after next CM view update]                colors=0 paletteIdx=4    <- textColorMap wiped, index stale
[7 after re-opening file B]                  colors=0 paletteIdx=4    <- cannot recover (precomputedFiles)
```

---

## Q1. What the modal displays, and when it says "No links have been colored yet"

`src/ui/collision-modal.ts`

- `onOpen()` (148-151) → `calculateStats()` → `render()`.
- Header stats bar: `Total links: N` and `Unique colors: K` where K counts palette entries with
  `count > 0` (233-239).
- Chart view (289-344): one row per palette colour (all palette colours are pre-seeded to 0 at
  169-171), each with swatch, proportional bar scaled to `maxCount` (311-312), per-colour link count
  (317-320), `N variants` when applicable (323-328), and percentage (331-334).
- Table view (346-413): one column per *base* palette colour that actually has links, with swatch,
  `(count)`, shade count (387-392) and each link name coloured with its exact variant hex (397-405).
- Empty states:
  - chart: `if (this.totalLinks === 0)` → "No links have been colored yet. Open files with wiki-links
    to see statistics." (338-343) — note the zero-count rows are still drawn above it.
  - table: same message, but returns before drawing columns (351-357).
- `totalLinks` is incremented **only** inside the `if (paletteIndex !== undefined && paletteIndex <
  colorList.length)` branch (181-185). So `totalLinks === 0` means "no entry of `textColorMap` had a
  matching, in-range entry in `linkPaletteIndexMap`" — not "no links were coloured".
- `Refresh data` / "Recalculate statistics from current link colors" (257-267) only re-reads the same
  two in-memory maps; it does **not** re-derive anything from the DOM or recompute colours. It is
  therefore unable to fix an empty cache (misleading label — see Q4).

## Q2. Data flow for palette indices

1. Two module-level LRU caches in `src/main.ts`:
   - `textColorMap: LRUCache<string, string>` — cacheKey → final hex (163)
   - `linkPaletteIndexMap: LRUCache<string, number>` — cacheKey → palette index 0..n-1 (165)
   Both re-created at startup with the tier's `maxCacheSize` (`detectAndApplyVaultSizeSettings`,
   633-634). Same key space, same insertion points.
2. Key = `textKey`, built by `buildCacheKey()` (`src/color-utils.ts:509-517`):
   `` `${palette}-${isDark?'dark':'light'}-r${darkModeRevision}-${seed}-${rangeKey}-${modeKey}-${cleanedText}` ``.
   `cleanedText` is the prefix-stripped, trimmed, lower-cased link target (main.ts:1412-1413, 493).
3. Writes happen in exactly two places, always index-then-colour:
   - non-random modes: `linkPaletteIndexMap.set(textKey, bestIndex)` at 1462-1463, then
     `textColorMap.set(textKey, finalColor)` at 1477.
   - random mode: 540-541 then 544.
4. Reads: cache-hit guard requires **both** maps (`cachedColor !== undefined && linkPaletteIndexMap.has(textKey)`,
   503 and 1423). If the index entry is missing, the colour is silently recomputed (and the usage
   counters incremented again → colour drift).
5. Modal access: `this.plugin.getLinkColorMap()` (`main.ts:603-605`, returns a *copy* of
   `textColorMap`) and the module-level `getLinkPaletteIndexMap()` (`main.ts:584-586`,
   `new Map(linkPaletteIndexMap.entries())`), consumed at `collision-modal.ts:155-156`, iterated at
   177-206. `getLinkPaletteIndexMap` is imported directly from `../main` (`collision-modal.ts:12`) —
   works fine in the bundled CJS build (verified in `main.js`, `function ie()` hoisted).

## Q3. Persistence and lifetime

**In-memory only.** Nothing about colours/statistics is persisted: `data.json` holds settings only
(see Q7). Populated by:
- `precomputeFileLinkColors()` / `...ByFrequency()` on load and on `active-leaf-change`
  (main.ts:380-420, 431-472, 837, 817, 1103-1104) — `getColor()` with default `shouldCache = true`.
- Reading-view / Dataview DOM passes: `colorLinksInElement()` → `getColor(decodedTarget, settings, isDarkMode)`
  (main.ts:81), invoked from the markdown post-processor (695-697), MutationObservers (98-159, 922-970)
  and `recolorAllReadingViews()` (987-1014).

Cleared / reset:
- `resetColorState()` clears both + `precomputedFiles` + `lastPrecomputeTime` and sets
  `lastKnownSeed = -1`, `lastKnownHashMode = null` (1040-1059). Callers: hotkey/command reroll (687),
  folder-based reroll (792), auto-reroll (884), settings "Shuffle all colors" (settings.ts:567-572)
  and "Reset color cache" (580-584).
- `css-change` (theme toggle): `darkModeRevision++`, `textColorMap.clear()`,
  `precomputedFiles.clear()`, then re-precomputes only the active file (750-767). `linkPaletteIndexMap`
  is *not* cleared → stale revision keys accumulate.
- CM6 `ViewPlugin.update()` when `hashModeChanged`: `textColorMap.clear(); colorUsageMap.clear();`
  — again `linkPaletteIndexMap` untouched (1175-1178).
- `onunload()` (903-905).

## Q4. What "recalculation" can and cannot do

`collision-modal.ts:257-267` → `calculateStats()` (153-223) → `render()`. It reads the two caches and
nothing else. So recalculation yields zero whenever `textColorMap` is empty (or every key lacks an
index), regardless of what is on screen.

The "Skip if too few links" check the brief refers to is **not** in the stats path — it is
`checkAndAutoReroll()`: `if (totalLinks < config.autoRerollMinLinks) return false;`
(`main.ts:852-855`), using `autoRerollMinLinks` = 5/8/10/15 by vault tier
(`performance-config.ts:89,103,117,131`). It only gates *auto-reroll*, and it counts
`textColorMap.size` — i.e. it silently stops auto-rerolling once the cache has been emptied, which is
how the empty state becomes invisible.

Things that make recalculation return zero even with coloured links:
- `textColorMap` emptied by any wipe above, with `precomputedFiles` still holding the file so
  `precomputeFileLinkColors()` early-returns (396-398) — **sticky** empty state.
- Cooldown guard (`main.ts:387-393`): with a 14,435-note vault the tier is `very-large` →
  `precomputeCooldownMs = 45 000` (`performance-config.ts:135`), so re-precompute is refused for 45 s
  even after `lastPrecomputeTime` is cleared indirectly.
- Palette shrinking: `paletteIndex < colorList.length` (collision-modal.ts:182) drops out-of-range
  indices (e.g. indices 6-7 after switching 8-colour → 6-colour palette, `onedark`/`synthwave`, see
  settings.ts PALETTES). Partial only, never 0.
- Colours produced by the non-caching paths (Q5) exist in the DOM but never in the cache.

## Q5. What `textKey` is, and paths that colour without recording

`textKey = buildCacheKey(palette, isDarkMode, darkModeRevision, seed, rangeKey, hashMode, cleanedText)`
(`color-utils.ts:509-517`; call sites `main.ts:500` and `main.ts:1420`). `rangeKey` is the 4-tuple of
saturation/lightness bounds for the current theme; `darkModeRevision` increments on `css-change`.

Paths that colour links **without** touching either map (`shouldCache = false`):
- Live Preview (CM6) — every decorated link: `getColor(..., false)` at `main.ts:1337-1342`
  (link text) and `main.ts:1323-1328` (alias via `|`). Both fall through to
  `computeColorWithoutCaching()` / `computeRandomColorWithoutCaching()` (`main.ts:1485-1517`,
  `553-570`), which compute `Math.abs(hash) % paletteSize` and never `set()` anything. The comments
  say this is to avoid caching *partial* links while typing, but the flag is passed for complete
  links too. Verified: harness renders 2 decorations with `textColorMap.size` unchanged.
- Consequence: in Live Preview the statistics can only come from `precomputeFileLinkColors` and from
  `colorLinksInElement` reading-view passes.

Other caveats on the recording path:
- `colorLinksInElement` documents `<span class="cm-hmd-internal-link">` support (main.ts:45-48) but the
  selector list is anchors only (`a.internal-link, a[data-href], a.is-unresolved, a.internal-link-link`,
  main.ts:60-62). If a view mode renders spans, that pass colours nothing and records nothing.
  (Unverified against a live Obsidian build — flagged as uncertainty.)
- Mobile: same `getColor` path; `isMobile` only changes observers/debounce (922-970, 716-729), not recording.
- Cached-but-not-re-rendered links: because hits require *both* maps (1423), a link whose colour is in
  cache but whose index was evicted is recomputed on next render — colour may shift, index reappears.
- Eviction asymmetry: `LRUCache.get()` promotes (lru-cache.ts:31-42) but `LRUCache.has()` does not
  (66-68). `textColorMap` is hit via `get()` on every render (LRU); `linkPaletteIndexMap` is only
  probed via `has()` (FIFO). Proven with a 3-entry cache: after `has("a"); has("b")` the oldest key
  `a` is still the one evicted → `{b,c,d}` survives, i.e. pure insertion order. On a 14k-note vault
  with `maxCacheSize = 8000` (`performance-config.ts:124-136`) hot-but-old links lose their index first.

## Q6. Git history

```
209abd4 2026-10-19 FIX: color links on mobile Live Preview (cm-underline inherit + parse retry)
fdc8603 2026-10-19 REFACTOR: add LRU cache and vault-size performance tiers for color computation
b168ee7 2026-08-26 CHORE: bump CM6 types and plugin version
1e72676 2026-06-18 FEAT: add hotkey command to reroll colors
df93e0f 2026-06-12 FIX: prevent cell overlap in collision table
350c5ec 2026-06-11 FIX: extract actual link text from cache key in collision table
```

- `src/ui/collision-modal.ts` last touched 2026-06-18 (`1e72676`); the counting logic
  (`calculateStats`) has not changed since 2026-06-11 (`350c5ec` added `extractLinkTextFromCacheKey`).
  So the *modal* is not a recent regression.
- `fdc8603` (2026-10-19) is the last change to the statistics **storage**: `Map` → `LRUCache`, and the
  getters now return copies. Semantics were preserved (diff reviewed: the hit test
  `textColorMap.has && linkPaletteIndexMap.has` was rewritten as `get()` + `has()`, which is
  equivalent and actually fixes truthiness for falsy values). What it *did* introduce is the
  FIFO/LRU asymmetry (Q5) and the fact that `clear()`/`has()` semantics changed under eviction.
- No commit in this window touches the wipes described in Q3, so the empty-stats symptom likely
  became *reachable* (not introduced) with the 2026-10-19 perf work: bigger caches + 45 s cooldown on a
  14k vault make a wipe harder to recover from.
- Working tree is clean; `main.js`, `link-colorer/` copies and the copies deployed to
  `~/Notes/Novel-Writing` and `~/Notes/ZettelPublish …` are all the same Oct-19 build (37955 bytes).

## Q7. Settings / environment dependencies

There is **no** toggle that disables statistics collection, and no mobile/debug gate on it
(`settings.ts` has no `logging*` or `debug*` settings; `src/logger.ts` and `src/debug-mobile.ts` exist
but are never imported by `main.ts` — dead code).

Settings that *indirectly* cause the empty modal:

| Setting | User's value (Novel-Writing `data.json`) | Effect |
|---|---|---|
| `rerollOnFileChange` | `true` | every new file opened from a different folder calls `resetColorState()` (main.ts:787-799) → both maps wiped, `lastKnownHashMode = null` |
| `autoRerollThreshold` | `20` | aggressive auto-reroll → `resetColorState()` again (main.ts:879-887) |
| `hashMode` | `"random"` | random path (main.ts:480-547); also any hash-mode change triggers the CM clear |
| `priorityFilePrefix` | `"Chapter - "` | enables `priorityPrecompute()` (batched, `maxConcurrentPrecomputes: 4`) |
| `palette` | `perceptual_optimal` | 8 dark + 8 light entries (settings.ts:302-327) — index range fine |
| vault size | 14,435 notes → `very-large` | cache 8000, `precomputeCooldownMs` 45 s, `autoRerollCheckFrequency` 8 |

`data.json` in this repo (`palette: nord`, stale `saturation`/`lightness`) is irrelevant — it is the
dev copy and the stale keys are deleted in `loadSettings` (main.ts:1018-1024). The Novel-Writing
`data.json` (modified 2026-10-27) contains `loggingEnabled` / `logLevel` / `logCategories` /
`underlineVariants`, which this build does not define — evidence that a *different* build ran against
that vault recently (version drift worth confirming with the user before trusting any "fixed in my
build" claim).

## Q8. Logging / diagnostics available

No logging exists in the statistics path itself (opening the modal is silent). Existing tags
(`src/main.ts`, all `console.*`):

- `[Link Colorer] Vault detected: N notes, tier: …, cache: …, debounce: …ms` — 638-641
- `[Link Colorer] Failed to detect vault size, using defaults` — 644
- `[Link Colorer] Running on mobile platform` — 664
- `Color state reset` — 1058 (fires on every reroll/reset — a good timestamp for "cache just emptied")
- `Link Colorer: Auto-reroll triggered - <hex> used for m/n links (x%, threshold: y%)` — 880
- `[Link Colorer] ViewPlugin constructor - Initial decorations created` — 1161 (mobile only)
- `[Link Colorer] ViewPlugin update - Rebuilt decorations due to: {…}` — 1200 (mobile, docChanged)
- `[Link Colorer] Syntax tree incomplete - retry #n in 200ms` — 1239 (mobile, `console.debug`)
- `[Link Colorer] No visible ranges detected …` — 1273 (mobile)
- `[Link Colorer] Built N link decorations` — 1380 (mobile)
- `Failed to precompute link colors:` / `… by frequency:` — 418, 470

Best in-app diagnostic (no console needed): the settings tab's collision status line
(`settings.ts:721-733`) reads the same `getLinkColorMap()`; if it also says
"No links colored yet. Open files with wiki-links to see status." while links are coloured, the cache
is empty and the fault is collection, not the modal.

---

## Root causes, ranked

### RC1 — Cache wiped by routine rerolls, then locked empty by `precomputedFiles` (high confidence)
- `resetColorState()` clears `textColorMap`, `linkPaletteIndexMap`, `precomputedFiles`,
  `lastPrecomputeTime` and sets `lastKnownHashMode = null` (main.ts:1042-1055).
- The next CM6 `update()` sees `hashModeChanged === true` and runs `textColorMap.clear()` (1175-1178) —
  *after* `recolorAllReadingViews()`/precompute had repopulated it (forceViewUpdate order: 1118-1147).
  `linkPaletteIndexMap` is left stale, so the two maps no longer agree.
- `precomputeFileLinkColors()` early-returns for an already-precomputed file (396-398) and for 45 s by
  cooldown (387-393, tier `very-large`), so the wiped entry is not re-created. Live Preview adds
  nothing (Q5). Empty forever for that file/session.
- Reproduced in harness2 steps 3, 6, 7. This also explains the related symptom "colours look wrong /
  shift after a reroll", since recomputation re-runs load balancing on already-incremented counters.

### RC2 — Live Preview never records statistics (high confidence, design-level)
- `main.ts:1323-1328` and `1337-1342` pass `shouldCache: false` for *every* link in Live Preview, so
  `computeColorWithoutCaching()` (1485-1517) / `computeRandomColorWithoutCaching()` (553-570) never
  write either map. Verified: rendering decorations leaves `textColorMap` untouched.
- Therefore "coloured links" ≠ "recorded links". Any user who works in Live Preview and whose
  precompute passes are skipped/cooldowned/wiped sees an empty modal. The modal's empty-state copy
  ("Open files with wiki-links to see statistics") points at the wrong remedy.

### RC3 — Two-cache desync under eviction (medium confidence, worsens over time)
- `LRUCache.has()` does not promote (lru-cache.ts:66-68) → `linkPaletteIndexMap` is FIFO while
  `textColorMap` is LRU; on an 8000-entry cache in a 14k-note vault they diverge.
- Because the hit test requires both (503, 1423), a missing index forces a recompute that re-increments
  `colorUsageMap` (520-527 / 1453-1458) → colour drift plus churn in the statistics; entries can also
  drop out of the count entirely while the DOM keeps the old colour.

### Secondary observations
- `css-change` clears only `textColorMap` and re-precomputes only the active file (750-767) — theme
  toggles can empty stats if the active note has no `[[links]]`.
- The modal shows lower-cased, prefix-stripped link text (`extractLinkTextFromCacheKey`,
  collision-modal.ts:20-73) — cosmetic, e.g. `Alice` displays as `alice`.
- `Refresh` cannot rebuild data; there is no "rebuild from vault" entry point anywhere.

## Suggested fixes (for the main agent to implement)

1. Record stats on the render path: add a lightweight `recordPaletteIndex(textKey, index)` (or pass
   `shouldCache` but a separate "record stats" flag) so Live Preview decorations register the index
   even when the colour is computed uncached (main.ts:1323-1342).
2. Stop wiping on `hashModeChanged` in `ViewPlugin.update()` (1175-1178) — or wipe both maps and
   `precomputedFiles` together, and trigger a re-precompute of the active file afterwards.
3. Make `resetColorState()` not set `lastKnownHashMode = null` (use the current mode) so the CM clear
   does not fire spuriously; or gate the CM clear on an explicit settings-change event.
4. Add a real "Rebuild statistics" action in the modal that iterates `app.vault.getMarkdownFiles()`
   (or the open views) and calls `getColor()` with caching enabled, bypassing `precomputedFiles`
   (add a `force` parameter to `precomputeFileLinkColors`).
5. Use `get()` instead of `has()` for `linkPaletteIndexMap` (or make `has()` promote) so both caches
   share LRU policy; alternatively store `{color, paletteIndex}` in one cache entry to remove the
   possibility of desync entirely.
6. Add a one-line diagnostic log when the modal opens (`[Link Colorer] stats: colors=N indices=M
   matched=K`) so this class of bug is self-diagnosing.
