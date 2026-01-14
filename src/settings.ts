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
            "#FF8A80", // Red
            "#FF5252", // Red Accent
            "#FF9E80", // Deep Orange
            "#FFD180", // Orange
            "#FFE57F", // Amber
            "#FFFF8D", // Yellow
            "#CCFF90", // Light Green
            "#A7FFEB", // Teal Accent
            "#80D8FF", // Light Blue
            "#82B1FF", // Blue
            "#B388FF", // Deep Purple
            "#EA80FC", // Purple Accent
            "#FF80AB", // Pink
            "#CFD8DC", // Blue Grey
            "#FFD740", // Amber Accent
            "#69F0AE", // Green Accent
            "#40C4FF", // Light Blue Accent
            "#7C4DFF", // Deep Purple Accent
            "#FF4081", // Pink Accent
            "#E040FB", // Purple
            "#18FFFF", // Cyan
            "#64FFDA", // Teal
            "#EEFF41", // Lime
            "#F4FF81"  // Light Lime
        ],
        light: [
            "#B71C1C", // Red
            "#C62828", // Red Dark
            "#BF360C", // Deep Orange
            "#E65100", // Orange
            "#FF6F00", // Amber
            "#F57F17", // Yellow (Darkened)
            "#33691E", // Light Green (Darkened)
            "#004D40", // Teal
            "#01579B", // Light Blue
            "#0D47A1", // Blue
            "#311B92", // Deep Purple
            "#4A148C", // Purple
            "#880E4F", // Pink
            "#455A64", // Blue Grey
            "#FF6D00", // Amber Accent
            "#00C853", // Green
            "#0091EA", // Light Blue
            "#6200EA", // Deep Purple
            "#C51162", // Pink
            "#AA00FF", // Purple Accent
            "#00B8D4", // Cyan
            "#00BFA5", // Teal Accent
            "#AEEA00", // Lime
            "#827717"  // Lime Dark
        ]
    }
};

export type PaletteType = keyof typeof PALETTES;
export type HashMode = 'strict-full' | 'strict-acronym' | 'similarity';

export interface LinkColorSettings {
    palette: PaletteType;
    ignorePrefix: boolean;
    hashMode: HashMode;
    underlineVariants: boolean; // optional visual differentiator
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

        new Setting(containerEl)
            .setName('Color Palette')
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
            .setName('Ignore Prefixes')
            .setDesc('When enabled, "Char - Charlus" will be colored based on "Charlus" only.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ignorePrefix)
                .onChange(async (value) => {
                    this.plugin.settings.ignorePrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Hash Mode')
            .setDesc('Choose how words are hashed to colors.')
            .addDropdown(dropdown => {
                const modes: HashMode[] = ['strict-full', 'strict-acronym', 'similarity'];
                modes.forEach((mode) => {
                    const desc = HASH_MODE_DESCRIPTIONS[mode];
                    dropdown.addOption(mode, desc.name);
                });
                dropdown
                    .setValue(this.plugin.settings.hashMode)
                    .onChange(async (value) => {
                        this.plugin.settings.hashMode = value as HashMode;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Underline variation')
            .setDesc('Adds subtle underline style variations to increase distinctness (optional).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.underlineVariants)
                .onChange(async (value) => {
                    this.plugin.settings.underlineVariants = value;
                    await this.plugin.saveSettings();
                }));

        const modeDesc = HASH_MODE_DESCRIPTIONS[this.plugin.settings.hashMode];
        const descEl = containerEl.createEl('p', { text: modeDesc.description });
        descEl.style.fontSize = '0.9em';
        descEl.style.color = 'var(--text-muted)';
        descEl.style.marginTop = '-10px';
        descEl.style.marginBottom = '20px';

        containerEl.createEl('h3', { text: 'Preview' });
        this.previewEl = containerEl.createDiv();
        this.previewEl.style.display = 'flex';
        this.previewEl.style.flexWrap = 'wrap';
        this.previewEl.style.gap = '10px';
        this.previewEl.style.marginTop = '10px';
        this.previewEl.style.padding = '15px';
        this.previewEl.style.borderRadius = '8px';
        this.previewEl.style.backgroundColor = 'var(--background-secondary)';

        this.updatePreview();
    }

    updatePreview() {
        this.previewEl.empty();
        const currentPalette = this.plugin.settings.palette;
        const isDarkMode = document.body.classList.contains('theme-dark');

        const palette = PALETTES[currentPalette] || PALETTES['vibrant'];
        if (!palette) return;

        const colors = isDarkMode ? palette.dark : palette.light;

        colors.forEach(color => {
            const box = this.previewEl.createDiv();
            box.style.width = '35px';
            box.style.height = '35px';
            box.style.backgroundColor = color;
            box.style.borderRadius = '50%';
            box.style.border = '2px solid var(--background-modifier-border)';
            box.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            box.title = color;
        });
    }
}

