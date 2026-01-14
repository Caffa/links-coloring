# Link Colorer for Obsidian

This is an Obsidian plugin that automatically colors your internal links based on their text content. It uses deterministic hashing to ensure that `[[Apple]]` appears in the exact same color every time you type it, helping you visually distinguish between different concepts, characters, or topics in your vault.

<img width="1256" height="628" alt="14405" src="https://github.com/user-attachments/assets/5f30f169-3a4e-44a7-8896-c9c935e53b2c" />

I use this for fiction writing since each character is a different link (I use various complements together with this)

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

## Theory 🎨 How Colors are Calculated

We use a custom deterministic algorithm to assign colors to links. This ensures that the same link text always gets the same color, but similar-looking texts remain visually distinct.

### 1. The Seed Strategy
Instead of hashing the raw text, we generate a **Weighted Seed** to ensure high uniqueness. The seed is constructed from:
1.  **Acronyms:** The first letter of every word (e.g., "Machine Learning" → `ml`).
2.  **Full Text:** The full cleaned string to preserve uniqueness.
3.  **Length:** The character count appended to the end.

This structure implies that even a single character difference (like a plural 's') changes the length, which radically changes the seed.

### 2. The Hash Function (DJB2)
We use a modified **DJB2** hash function. It is a widely used non-cryptographic hash function known for its excellent distribution and speed.

*   **The Magic Number:** It initializes with `5381`.
*   **The Shift:** For every character in the seed, it multiplies the current hash by 33 (bitshifted as `(hash << 5) + hash`) and adds the character code.
*   **The Avalanche Effect:** Because the length is appended to the seed, the hash creates a "snowball effect." A tiny change in input results in a completely different hash output.

### 3. Collision Calculation Example

Here is how the algorithm differentiates between two nearly identical inputs: **"Design System"** vs **"Design Systems"**.

#### Case A: "Design System"
*   **Input:** `design system`
*   **Acronym:** `ds`
*   **Length:** `13`
*   **Generated Seed:** `dsdesign system13`
*   **DJB2 Hash:** `385621945`
*   **Modulo (Extended Palette):** `385621945 % 24` = **Index 17**
*   **Result:** <span style="color: #7C4DFF">■ Deep Purple Accent</span>

#### Case B: "Design Systems" (Plural)
*   **Input:** `design systems`
*   **Acronym:** `ds`
*   **Length:** `14` (Length changed!)
*   **Generated Seed:** `dsdesign systems14`
*   **DJB2 Hash:** `921874632` (Drastically different due to avalanche effect)
*   **Modulo (Extended Palette):** `921874632 % 24` = **Index 8**
*   **Result:** <span style="color: #80D8FF">■ Light Blue</span>

*Even though the strings share 99% of the same characters, the **Length-Weighted Seed** ensures they land on opposite sides of the color palette.*

## 📄 License

[MIT](LICENSE)

