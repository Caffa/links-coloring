import { App, PluginSettingTab, Setting } from 'obsidian';
import LinkColorPlugin from './main';

// --- 1. DEFINED PALETTES ---
export const PALETTES: Record<string, { dark: string[], light: string[] }> = {
    vibrant: {
        // Order: Red -> Blue -> Orange -> Cyan -> Yellow -> Purple -> Pink -> Green
        dark: ["#FF5252", "#448AFF", "#FFAB40", "#18FFFF", "#FFD740", "#E040FB", "#FF4081", "#69F0AE"],
        light: ["#D50000", "#2962FF", "#EF6C00", "#00B8D4", "#FFAB00", "#AA00FF", "#C51162", "#00C853"]
    },
    dracula: {
        // Order: Red -> Cyan -> Orange -> Purple -> Yellow -> Green -> Pink
        dark: ["#FF5555", "#8BE9FD", "#FFB86C", "#BD93F9", "#F1FA8C", "#50FA7B", "#FF79C6"],
        light: ["#D92626", "#2692B8", "#CC7A00", "#7B53C9", "#B1BA5C", "#20AA4B", "#C04996"]
    },
    gruvbox: {
        // Order: Red -> Aqua -> Orange -> Blue -> Yellow -> Purple -> Green
        dark: ["#cc241d", "#689d6a", "#d65d0e", "#458588", "#d79921", "#b16286", "#98971a"],
        light: ["#9d0006", "#427b58", "#af3a03", "#076678", "#b57614", "#8f3f71", "#79740e"]
    },
    tokyonight: {
        // Order: Red -> Blue -> Orange -> Teal -> Pink(Orange) -> Cyan -> Purple -> Green
        dark: ["#f7768e", "#7aa2f7", "#ff9e64", "#1abc9c", "#e0af68", "#7dcfff", "#bb9af7", "#9ece6a"],
        light: ["#8c4351", "#34548a", "#965027", "#33635c", "#8f5e15", "#0f4b6e", "#5a4a78", "#485e30"]
    },
    onedark: {
        // Order: Red -> Blue -> Yellow -> Purple -> Green -> Cyan
        dark: ["#e06c75", "#61afef", "#e5c07b", "#c678dd", "#98c379", "#56b6c2"],
        light: ["#e45649", "#4078f2", "#986801", "#a626a4", "#50a14f", "#0184bc"]
    },
    synthwave: {
        // Order: Red -> Cyan -> Yellow -> Purple -> Pink -> Green
        dark: ["#fe4450", "#36f9f6", "#f7f230", "#b893ce", "#ff7edb", "#72f1b8"],
        light: ["#d60010", "#00a19d", "#bfba00", "#7d36a8", "#e4009e", "#199e63"]
    },
    solarized: {
        // Order: Red -> Blue -> Orange -> Cyan -> Magenta -> Green -> Yellow -> Violet
        dark: ["#dc322f", "#268bd2", "#cb4b16", "#2aa198", "#d33682", "#859900", "#b58900", "#6c71c4"],
        light: ["#dc322f", "#268bd2", "#cb4b16", "#2aa198", "#d33682", "#859900", "#b58900", "#6c71c4"]
    },
    nord: {
        // Order: Red -> Dark Blue -> Orange -> Cyan -> Yellow -> Glacial Blue -> Green -> Teal
        dark: ["#BF616A", "#5E81AC", "#D08770", "#88C0D0", "#EBCB8B", "#81A1C1", "#A3BE8C", "#8FBCBB"],
        light: ["#BF616A", "#3B566E", "#C2664D", "#4C7899", "#B58900", "#5E81AC", "#7A9663", "#4C7A82"]
    },
    extended: {
        // Shuffled heavily to ensure Red/Blue/Orange/Green alternation
        dark: [
            "#FF5252", "#40C4FF", "#FFD740", "#69F0AE", "#FF4081", "#7C4DFF", "#FF9E80", "#18FFFF",
            "#EA80FC", "#A7FFEB", "#FF8A80", "#82B1FF", "#FFE57F", "#CCFF90", "#E040FB", "#64FFDA",
            "#FFD180", "#80D8FF", "#FFFF8D", "#B388FF", "#FF80AB", "#F4FF81", "#EEFF41", "#CFD8DC"
        ],
        light: [
            "#C62828", "#0091EA", "#FF6D00", "#00C853", "#C51162", "#6200EA", "#BF360C", "#00B8D4",
            "#AA00FF", "#004D40", "#B71C1C", "#0D47A1", "#FF6F00", "#33691E", "#4A148C", "#00BFA5",
            "#E65100", "#01579B", "#F57F17", "#311B92", "#880E4F", "#827717", "#AEEA00", "#455A64"
        ]
    },
    catppuccin: {
        // Order: Red -> Blue -> Peach -> Teal -> Yellow -> Mauve -> Pink -> Green
        dark: ["#ed8796", "#8aadf4", "#f5a97f", "#8bd5ca", "#eed49f", "#c6a0f6", "#f5bde6", "#a6da95"],
        light: ["#D20F39", "#1E66F5", "#FE640B", "#179299", "#DF8E1D", "#8839EF", "#EA76CB", "#40A02B"]
    },
    oceanic_next: {
        // Order: Red -> Blue -> Orange -> Cyan -> Yellow -> Purple -> Brown -> Green
        dark: ["#ec5f67", "#6699cc", "#f99157", "#62b3b2", "#fac863", "#c594c5", "#ab7967", "#99c794"],
        light: ["#C43C44", "#36608F", "#D66B2F", "#3C7877", "#B58900", "#875487", "#70483C", "#5F875A"]
    },
    kanagawa_dragon: {
        // Order: Red -> Aqua -> Orange -> Blue -> Beige -> Violet -> Green -> Purple
        dark: ["#c4746e", "#7aa89f", "#e6c384", "#658594", "#dcd7ba", "#957fb8", "#98bb6c", "#938aa9"],
        light: ["#A6453D", "#4A756D", "#C98F28", "#3C5766", "#8A8567", "#6A5094", "#5A7D35", "#5C5370"]
    },
    iceberg: {
        // Order: Red -> Blue -> Orange -> Cyan -> Purple -> Green -> Silver -> White
        dark: ["#e27878", "#84a0c6", "#e2a478", "#89b8c2", "#a093c7", "#b4be82", "#c6c8d1", "#d2d4de"],
        light: ["#9E3636", "#325480", "#9E6036", "#3B6873", "#5D4D87", "#5E6B2E", "#5E6273", "#454752"]
    },
    palenight: {
        // Order: Red -> Blue -> Yellow -> Purple -> Pink -> Cyan -> Green -> Grey
        dark: ["#f07178", "#82aaff", "#ffcb6b", "#c792ea", "#ff5370", "#89ddff", "#c3e88d", "#bfc7d5"],
        light: ["#A8383F", "#2C54AB", "#B37E19", "#703B94", "#AB223D", "#2B7A99", "#658A30", "#4D5663"]
    },
    ayu_mirage: {
        // Order: Coral -> Blue -> Orange -> Purple -> Green -> Sky -> Teal -> Ash
        dark: ["#f28779", "#73d0ff", "#ffd580", "#d4bfff", "#bae67e", "#5ccfe6", "#95e6cb", "#cbccc6"],
        light: ["#A63D30", "#005F8F", "#B37A00", "#6B4EA8", "#5F8A24", "#00667A", "#2D7D62", "#5C5D57"]
    }
};

export type PaletteType = keyof typeof PALETTES;
export type HashMode = 'strict-full' | 'strict-acronym' | 'similarity';

export interface LinkColorSettings {
    palette: PaletteType;
    ignorePrefix: boolean;
    hashMode: HashMode;
    underlineVariants: boolean;
}

export const DEFAULT_SETTINGS: LinkColorSettings = {
    palette: 'vibrant',
    ignorePrefix: true,
    hashMode: 'strict-full',
    underlineVariants: false,
}

export const HASH_MODE_DESCRIPTIONS: Record<HashMode, { name: string; description: string }> = {
    'strict-full': {
        name: 'Strict (Acronym + Length)',
        description: 'Maximum uniqueness using acronyms, full text, and length. Different words get different colors.'
    },
    'strict-acronym': {
        name: 'Strict (Acronym Only)',
        description: 'Uses only first letters of words. Similar structure words may share colors.'
    },
    'similarity': {
        name: 'Similarity-Based',
        description: 'Similar words get similar colors using Levenshtein distance. Great for related terms.'
    }
}

export class LinkColorSettingTab extends PluginSettingTab {
    plugin: LinkColorPlugin;
    previewEl: HTMLElement;

    constructor(app: App, plugin: LinkColorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // --- GROUP 1: VISUAL STYLE ---
        containerEl.createEl('h3', { text: 'Visual Style' });

        new Setting(containerEl)
            .setName('Color palette')
            .setDesc('Choose a predefined color scheme.')
            .addDropdown(dropdown => {
                Object.keys(PALETTES).forEach((key) => {
                    const name = key.charAt(0).toUpperCase() + key.slice(1);
                    dropdown.addOption(key, name);
                });
                dropdown
                    .setValue(this.plugin.settings.palette)
                    .onChange(async (value) => {
                        this.plugin.settings.palette = value as PaletteType;
                        await this.plugin.saveSettings();
                        this.updatePreview();
                    });
            });

        new Setting(containerEl)
            .setName('Underline variation')
            .setDesc('Adds subtle underline style variations to increase distinctness.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.underlineVariants)
                .onChange(async (value) => {
                    this.plugin.settings.underlineVariants = value;
                    await this.plugin.saveSettings();
                }));

        // Preview Area (Grouped with Visual Style)
        this.previewEl = containerEl.createDiv({ cls: 'link-color-preview-container' });
        this.updatePreview();

        // --- GROUP 2: MATCHING LOGIC ---
        containerEl.createEl('h3', { text: 'Matching Logic', cls: 'link-color-section-header' });

        // Placehold for the description element so we can update it dynamically
        let descEl: HTMLElement;

        new Setting(containerEl)
            .setName('Hash mode')
            .setDesc('Choose how words are converted into colors.')
            .addDropdown(dropdown => {
                const modes: HashMode[] = ['strict-full', 'strict-acronym', 'similarity'];
                modes.forEach((mode) => {
                    dropdown.addOption(mode, HASH_MODE_DESCRIPTIONS[mode].name);
                });
                dropdown
                    .setValue(this.plugin.settings.hashMode)
                    .onChange(async (value) => {
                        this.plugin.settings.hashMode = value as HashMode;
                        // Update description text immediately
                        if (descEl) descEl.textContent = HASH_MODE_DESCRIPTIONS[this.plugin.settings.hashMode].description;
                        await this.plugin.saveSettings();
                    });
            });

        // The Description Text (Placed immediately after Hash Mode)
        descEl = containerEl.createDiv({
            text: HASH_MODE_DESCRIPTIONS[this.plugin.settings.hashMode].description,
            cls: 'link-color-mode-description'
        });

        new Setting(containerEl)
            .setName('Ignore prefixes')
            .setDesc('If enabled, "Char - Pamela" is colored based on "Pamela" only.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ignorePrefix)
                .onChange(async (value) => {
                    this.plugin.settings.ignorePrefix = value;
                    await this.plugin.saveSettings();
                }));
    }

    updatePreview() {
        this.previewEl.empty();
        const currentPalette = this.plugin.settings.palette;

        // Check for dark mode via body class
        const isDarkMode = document.body.classList.contains('theme-dark');

        const palette = PALETTES[currentPalette] || PALETTES['vibrant'];
        if (!palette) return;

        const colors = isDarkMode ? palette.dark : palette.light;

        colors.forEach(color => {
            const box = this.previewEl.createDiv({ cls: 'link-color-preview-box' });
            // Background color is dynamic, so it stays inline
            box.style.backgroundColor = color;
            box.title = color;
        });
    }
}

