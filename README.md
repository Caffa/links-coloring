# Link Colorer for Obsidian

This is an Obsidian plugin that automatically colors your internal links based on their text content. It uses deterministic hashing to ensure that `[[Apple]]` appears in the exact same color every time you type it, helping you visually distinguish between different concepts, characters, or topics in your vault.

## ✨ Features

*   **Deterministic Coloring:** The color is derived mathematically from the link text. `[[Obsidian]]` will always be the same specific shade of purple, no matter where it appears.
*   **Live Preview Support:** Colors are applied instantly in the editor as you type.
*   **Smart Aliasing:** In a link like `[[Apple|Fruit]]`, the word "Fruit" is colored based on the link target ("Apple"), ensuring visual consistency for the underlying concept.
*   **Prefix Ignoring:** Option to ignore organizational prefixes. If enabled, `[[Char - Charlus Potter]]` generates the same color as `[[Charlus Potter]]`.
*   **High-Contrast Palettes:** Includes professionally curated color schemes including:
    *   🧛🏻‍♂️ **Dracula**
    *   ☀️ **Solarized**
    *   🌲 **Nord**
    *   📦 **Gruvbox**
    *   👾 **Synthwave** (Neon)
    *   🌑 **One Dark**
*   **Theme Aware:** Automatically adjusts colors for **Light Mode** and **Dark Mode** to ensure readability.

## 📸 Screenshots



## ⚙️ Configuration

Go to **Settings > Consistent Link Colors**.

### Color Palette
Choose from a variety of color schemes.
*   **Vibrant:** Maximum contrast (Red, Blue, Green, Yellow).
*   **Pastel:** Softer colors, easier on the eyes.
*   **Dracula/Nord/etc:** Matches popular VSCode/Obsidian themes.

The settings menu includes a **visual preview** of the colors in the selected palette.

### Ignore Prefixes
*   **Default:** `On`
*   **How it works:** If you use a folder-like structure in your filenames, such as `[[Category - Note Name]]`, the plugin will ignore everything before the last ` - ` separator.
    *   `[[Char - Charlus]]` → Colors based on "Charlus".
    *   `[[Loc - Hogwarts]]` → Colors based on "Hogwarts".

## 📦 Installation

### Manually
1.  Download the latest release from the Releases tab (once hosted on GitHub).
2.  Extract the files (`main.js`, `manifest.json`, `styles.css`) into your vault folder: `.obsidian/plugins/consistent-link-colors/`.
3.  Reload Obsidian.
4.  Go to **Settings > Community Plugins** and enable **Consistent Link Colors**.

### Development
If you want to modify this plugin:

1.  Clone this repository.
2.  Run `npm install` to install dependencies.
3.  Run `npm run build` to compile the TypeScript code.
4.  Reload the plugin in Obsidian to see changes.

## 🤝 Contributing

Contributions are welcome! If you have a favorite color palette you'd like added, feel free to open a Pull Request or Issue.

## 📄 License

[MIT](LICENSE)