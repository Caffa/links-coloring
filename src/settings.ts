import { App, PluginSettingTab, Setting } from 'obsidian';
import LinkColorPlugin from './main';

// --- 1. DEFINED PALETTES ---
export const PALETTES: Record<string, { dark: string[], light: string[] }> = {
    vibrant: {
        dark: ["#FF5252", "#69F0AE", "#448AFF", "#FFD740", "#E040FB", "#18FFFF", "#FFAB40", "#FF4081"],
        light: ["#D50000", "#00C853", "#2962FF", "#FFAB00", "#AA00FF", "#00B8D4", "#EF6C00", "#C51162"]
    },
    dracula: {
        dark: ["#8BE9FD", "#50FA7B", "#FFB86C", "#FF79C6", "#BD93F9", "#FF5555", "#F1FA8C"],
        light: ["#2692B8", "#20AA4B", "#CC7A00", "#C04996", "#7B53C9", "#D92626", "#B1BA5C"]
    },
    gruvbox: {
        dark: ["#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#d65d0e"],
        light: ["#9d0006", "#79740e", "#b57614", "#076678", "#8f3f71", "#427b58", "#af3a03"]
    },
    tokyonight: {
        dark: ["#f7768e", "#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#1abc9c", "#ff9e64"],
        light: ["#8c4351", "#34548a", "#5a4a78", "#0f4b6e", "#485e30", "#8f5e15", "#33635c", "#965027"]
    },
    onedark: {
        dark: ["#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2"],
        light: ["#e45649", "#50a14f", "#986801", "#4078f2", "#a626a4", "#0184bc"]
    },
    synthwave: {
        dark: ["#ff7edb", "#36f9f6", "#f7f230", "#72f1b8", "#fe4450", "#b893ce"],
        light: ["#e4009e", "#00a19d", "#bfba00", "#199e63", "#d60010", "#7d36a8"]
    },
    solarized: {
        dark: ["#dc322f", "#2aa198", "#268bd2", "#d33682", "#859900", "#cb4b16", "#6c71c4", "#b58900"],
        light: ["#dc322f", "#2aa198", "#268bd2", "#d33682", "#859900", "#cb4b16", "#6c71c4", "#b58900"]
    },
    nord: {
        dark: ["#BF616A", "#8FBCBB", "#B48EAD", "#EBCB8B", "#A3BE8C", "#88C0D0", "#D08770", "#5E81AC"],
        light: ["#BF616A", "#5E81AC", "#B48EAD", "#D08770", "#A3BE8C", "#88C0D0", "#CBA040", "#81A1C1"]
    },
    extended: {
        dark: [
            "#FF8A80", "#FF5252", "#FF9E80", "#FFD180", "#FFE57F", "#FFFF8D", "#CCFF90", "#A7FFEB",
            "#80D8FF", "#82B1FF", "#B388FF", "#EA80FC", "#FF80AB", "#CFD8DC", "#FFD740", "#69F0AE",
            "#40C4FF", "#7C4DFF", "#FF4081", "#E040FB", "#18FFFF", "#64FFDA", "#EEFF41", "#F4FF81"
        ],
        light: [
            "#B71C1C", "#C62828", "#BF360C", "#E65100", "#FF6F00", "#F57F17", "#33691E", "#004D40",
            "#01579B", "#0D47A1", "#311B92", "#4A148C", "#880E4F", "#455A64", "#FF6D00", "#00C853",
            "#0091EA", "#6200EA", "#C51162", "#AA00FF", "#00B8D4", "#00BFA5", "#AEEA00", "#827717"
        ]
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

