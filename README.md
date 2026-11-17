# Link Colorer

This plugin automatically colors your internal links based on what they say. `[[Apple]]` will always appear in the same color every time you type it, helping you visually tell different things apart.

<img width="1256" height="628" alt="14405" src="https://github.com/user-attachments/assets/5f30f169-3a4e-44a7-8896-c9c935e53b2c" />

I use this for fiction writing since each character is a different link (I use various complements together with this)

## Features

- **Consistent colors:** `[[Obsidian]]` will always be the same specific shade of purple, no matter where it appears.
- **Live preview:** Colors show up instantly as you type.
- **Smart links:** In `[[Apple|Fruit]]`, the word "Fruit" gets colored based on "Apple" so the concept looks the same.
- **Ignore prefixes:** Option to ignore organizing bits. If enabled, `[[Char - Charlus Potter]]` gets the same color as `[[Charlus Potter]]`.
- **Color themes:** Pick from Dracula, Solarized, Nord, Gruvbox, Synthwave, One Dark, and more.
- **Works with light and dark mode:** Colors automatically adjust so they're easy to read.

## Setup

Go to **Settings > Consistent Link Colors**.

### Pick a color theme

Choose from different color schemes:

- **Vibrant:** Bright colors that really stand out.
- **Pastel:** Softer, easier on the eyes.
- **Theme colors:** Matches popular editor themes like Dracula and Nord.

The settings menu shows you what the colors look like.

### Ignore prefixes

- **Default:** On
- **How it works:** If your notes use a structure like `[[Category - Note Name]]`, the plugin ignores the first part.
    - `[[Char - Charlus]]` → Colors based on "Charlus"
    - `[[Loc - Hogwarts]]` → Colors based on "Hogwarts"

## Public API for other plugins

Other plugins can ask Link Colorer for the color of a link. The result is exact for links Link Colorer has already colored; otherwise it is computed deterministically from the text hash (matching what Live Preview will paint first). API calls never mutate the color cache, usage stats, or collision statistics. Consumers should refresh on the `link-colorer:recolor` workspace event.

```js
// Poll-safe: the plugin may be lazy-loaded, so check before calling.
const plugin = app.plugins.plugins['link-colorer'];
const api = plugin?.getApi?.();
if (api?.isReady?.()) {
  const color = api.getColorForLink('Char - B'); // e.g. "#a1b2c3"
}
```

You can also read `window.linkColorerApi` once the plugin has loaded. The same object is assigned there and removed when the plugin unloads, so consumers can poll without holding a plugin reference.

```js
const api = window.linkColorerApi;
if (api?.isReady?.()) {
  api.getColorForLink('Char - B');
}
```

### API surface

```ts
interface LinkColorerApi {
  version: 1;
  isReady(): boolean;
  getColorForLink(text: string): string | null;          // hex like #a1b2c3
  getColorsForLinks(texts: string[]): Record<string, string | null>;
  onRecolor(cb: () => void | Promise<void>): () => void;
}
```

- `getColorForLink` returns `null` for empty/whitespace input, missing settings, or any unexpected failure. It never throws.
- `getColorsForLinks` is a batch convenience that calls `getColorForLink` for each entry.
- `onRecolor` registers a callback that runs when colors are recalculated. It returns an unsubscribe function that removes just that callback — call it before re-registering (e.g. on every refresh) so handlers don't stack up. The plugin still cleans up any surviving handler on unload, so ignoring the return value keeps working:

  ```js
  const unsubscribe = api.onRecolor(() => refreshColors());
  // Later (e.g. on your own unload):
  unsubscribe();
  ```

### Recolor events

The plugin fires `link-colorer:recolor` on the workspace with a stable payload:

```js
app.workspace.on('link-colorer:recolor', ({ reason }) => {
  // reason is 'settings' | 'reroll' | 'auto-reroll'
});
```

Events are emitted from settings updates (reason `settings`), the **Reroll Colors** command, the auto-reroll path (reason `auto-reroll`), **Shuffle all colors**, **Reset color cache**, and folder-based rerolls (reason `reroll`).

Theme switches recompute all colors silently without emitting an event: the plugin listens to Obsidian's own `css-change` internally. Consumers should either re-poll `getColorForLink` when they see Obsidian's `css-change`, or register their own listener:

```js
app.workspace.on('css-change', () => refreshColors());
```

## Notes

It ignores embeds (the `![[link]]` format).

## Installation

1.  Download the latest release from the Releases tab.
2.  Extract the files (`main.js`, `manifest.json`, `styles.css`) into your vault: `.obsidian/plugins/consistent-link-colors/`.
3.  Reload the app.
4.  Go to **Settings > Community plugins** and enable **Consistent Link Colors**.

## Contributing

Have a favorite color palette you'd like added? Feel free to open a pull request or an issue.

## Support

If you find this useful and want to support me, I'd really appreciate a coffee on [Ko-fi](https://ko-fi.com/pamelawang_mwahacookie). Even more, I'd love if you contributed color palettes to the project.

Thanks, and happy writing!

## License

[MIT](LICENSE)
