import { App, PluginSettingTab, Setting } from 'obsidian';
import LinkColorPlugin from './main';

// --- 1. DEFINED PALETTES ---
export const PALETTES: Record<string, { dark: string[], light: string[] }> = {
    vibrant: {
        dark: ["#FF5252", "#448AFF", "#FFD740", "#E040FB", "#FFAB40", "#18FFFF", "#FF4081", "#69F0AE"],
        light: ["#D50000", "#2962FF", "#FFAB00", "#AA00FF", "#EF6C00", "#00B8D4", "#C51162", "#00C853"]
    },
    dracula: {
        dark: ["#FF5555", "#8BE9FD", "#FFB86C", "#BD93F9", "#F1FA8C", "#FF79C6", "#50FA7B"],
        light: ["#D92626", "#2692B8", "#CC7A00", "#7B53C9", "#B1BA5C", "#C04996", "#20AA4B"]
    },
    gruvbox: {
        dark: ["#cc241d", "#689d6a", "#d65d0e", "#458588", "#d79921", "#b16286", "#98971a"],
        light: ["#9d0006", "#427b58", "#af3a03", "#076678", "#b57614", "#8f3f71", "#79740e"]
    },
    tokyonight: {
        dark: ["#f7768e", "#7dcfff", "#ff9e64", "#7aa2f7", "#9ece6a", "#bb9af7", "#e0af68", "#1abc9c"],
        light: ["#8c4351", "#0f4b6e", "#965027", "#34548a", "#485e30", "#5a4a78", "#8f5e15", "#33635c"]
    },
    onedark: {
        dark: ["#e06c75", "#56b6c2", "#e5c07b", "#c678dd", "#98c379", "#61afef"],
        light: ["#e45649", "#0184bc", "#986801", "#a626a4", "#50a14f", "#4078f2"]
    },
    synthwave: {
        dark: ["#fe4450", "#36f9f6", "#ff7edb", "#72f1b8", "#f7f230", "#b893ce"],
        light: ["#d60010", "#00a19d", "#e4009e", "#199e63", "#bfba00", "#7d36a8"]
    },
    solarized: {
        dark: ["#dc322f", "#2aa198", "#cb4b16", "#268bd2", "#d33682", "#859900", "#b58900", "#6c71c4"],
        light: ["#dc322f", "#2aa198", "#cb4b16", "#268bd2", "#d33682", "#859900", "#b58900", "#6c71c4"]
    },
    nord: {
        dark: ["#BF616A", "#5E81AC", "#D08770", "#88C0D0", "#EBCB8B", "#81A1C1", "#A3BE8C", "#8FBCBB"],
        light: ["#BF616A", "#3B566E", "#C2664D", "#4C7899", "#B58900", "#5E81AC", "#7A9663", "#4C7A82"]
    },
    extended: {
        dark: [
            "#FF5252", "#18FFFF", "#FFD740", "#7C4DFF", "#FFAB40", "#69F0AE", "#FF4081", "#40C4FF",
            "#FF8A80", "#64FFDA", "#FFE57F", "#B388FF", "#FF9E80", "#CCFF90", "#EA80FC", "#80D8FF",
            "#FFD180", "#A7FFEB", "#FFFF8D", "#E040FB", "#FF80AB", "#EEFF41", "#F4FF81", "#CFD8DC"
        ],
        light: [
            "#C62828", "#00B8D4", "#FFAB00", "#6200EA", "#EF6C00", "#00C853", "#C51162", "#0091EA",
            "#B71C1C", "#00BFA5", "#FF6F00", "#AA00FF", "#BF360C", "#33691E", "#880E4F", "#01579B",
            "#E65100", "#004D40", "#F57F17", "#4A148C", "#D81B60", "#AEEA00", "#827717", "#455A64"
        ]
    },
    catppuccin: {
        dark: ["#ed8796", "#8aadf4", "#eed49f", "#c6a0f6", "#f5a97f", "#8bd5ca", "#f5bde6", "#a6da95"],
        light: ["#D20F39", "#1E66F5", "#DF8E1D", "#8839EF", "#FE640B", "#179299", "#EA76CB", "#40A02B"]
    },
    oceanic_next: {
        dark: ["#ec5f67", "#6699cc", "#f99157", "#62b3b2", "#fac863", "#c594c5", "#ab7967", "#99c794"],
        light: ["#C43C44", "#36608F", "#D66B2F", "#3C7877", "#B58900", "#875487", "#70483C", "#5F875A"]
    },
    kanagawa_dragon: {
        dark: ["#c4746e", "#7aa89f", "#e6c384", "#658594", "#dcd7ba", "#957fb8", "#98bb6c", "#938aa9"],
        light: ["#A6453D", "#4A756D", "#C98F28", "#3C5766", "#8A8567", "#6A5094", "#5A7D35", "#5C5370"]
    },
    iceberg: {
        dark: ["#e27878", "#84a0c6", "#e2a478", "#89b8c2", "#a093c7", "#b4be82", "#c6c8d1", "#d2d4de"],
        light: ["#9E3636", "#325480", "#9E6036", "#3B6873", "#5D4D87", "#5E6B2E", "#5E6273", "#454752"]
    },
    palenight: {
        dark: ["#f07178", "#82aaff", "#ffcb6b", "#c792ea", "#ff5370", "#c3e88d", "#89ddff", "#bfc7d5"],
        light: ["#A8383F", "#2C54AB", "#B37E19", "#703B94", "#AB223D", "#658A30", "#2B7A99", "#4D5663"]
    },
    ayu_mirage: {
        dark: ["#f28779", "#73d0ff", "#ffd580", "#d4bfff", "#bae67e", "#5ccfe6", "#95e6cb", "#cbccc6"],
        light: ["#A63D30", "#005F8F", "#B37A00", "#6B4EA8", "#5F8A24", "#00667A", "#2D7D62", "#5C5D57"]
    }
};

export type PaletteType = keyof typeof PALETTES;
// Updated to include strict-first-last
export type HashMode = 'strict-full' | 'strict-acronym' | 'strict-first-last' | 'similarity';

export interface LinkColorSettings {
    palette: PaletteType;
    ignorePrefix: boolean;
    hashMode: HashMode;
    underlineVariants: boolean;
    customSeed: number; // New setting for the hash seed
}

export const DEFAULT_SETTINGS: LinkColorSettings = {
    palette: 'vibrant',
    ignorePrefix: true,
    hashMode: 'strict-full',
    underlineVariants: false,
    customSeed: 5381, // Default DJB2 seed
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
    'strict-first-last': {
        name: 'Strict (First & Last Letters)',
        description: 'Uses the first and last letters of every word (e.g. "Data Science" -> "DaSe").'
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
        new Setting(containerEl).setName("Visual style").setHeading();

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

        // Preview Area
        this.previewEl = containerEl.createDiv({ cls: 'link-color-preview-container' });
        this.updatePreview();

        // --- GROUP 2: MATCHING LOGIC ---
        new Setting(containerEl).setName("Matching logic").setHeading();

        // Placehold for the description element
        let descEl: HTMLElement;

        new Setting(containerEl)
            .setName('Hash mode')
            .setDesc('Choose how words are converted into colors.')
            .addDropdown(dropdown => {
                // Add all modes including the new one
                const modes: HashMode[] = ['strict-full', 'strict-acronym', 'strict-first-last', 'similarity'];
                modes.forEach((mode) => {
                    dropdown.addOption(mode, HASH_MODE_DESCRIPTIONS[mode].name);
                });
                dropdown
                    .setValue(this.plugin.settings.hashMode)
                    .onChange(async (value) => {
                        this.plugin.settings.hashMode = value as HashMode;
                        if (descEl) descEl.textContent = HASH_MODE_DESCRIPTIONS[this.plugin.settings.hashMode].description;
                        await this.plugin.saveSettings();
                    });
            });

        // The Description Text
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

        // --- GROUP 3: RANDOMIZATION ---
        new Setting(containerEl).setName("Color randomization").setHeading();

        new Setting(containerEl)
            .setName('Color seed')
            .setDesc('The starting number for color generation. Change this to "shuffle" all link colors.')
            .addText(text => text
                .setPlaceholder('5381')
                .setValue(String(this.plugin.settings.customSeed))
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed)) {
                        this.plugin.settings.customSeed = parsed;
                        await this.plugin.saveSettings();
                    }
                })
            )
            .addButton(btn => btn
                .setButtonText('Re-roll colors')
                .setTooltip('Pick a random seed to shuffle colors')
                .onClick(async () => {
                    // Generate random seed between 1 and 100000
                    const newSeed = Math.floor(Math.random() * 100000) + 1;
                    this.plugin.settings.customSeed = newSeed;

                    // Force refresh of the setting UI
                    this.display();

                    await this.plugin.saveSettings();
                })
            );
    }

    updatePreview() {
        this.previewEl.empty();
        const currentPalette = this.plugin.settings.palette;
        const isDarkMode = document.body.classList.contains('theme-dark');

        const palette = PALETTES[currentPalette] || PALETTES['vibrant'];
        if (!palette) return;

        const colors = isDarkMode ? palette.dark : palette.light;

        colors.forEach(color => {
            const box = this.previewEl.createDiv({ cls: 'link-color-preview-box' });
            box.style.backgroundColor = color;
            box.title = color;
        });
    }
}

