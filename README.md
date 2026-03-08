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
