import { App, PluginSettingTab, Setting } from 'obsidian';
import LinkColorPlugin from './main';

// --- 1. DEFINED PALETTES ---
// The palette should have distinctly different colors (that are different in hue instead of saturation or lightness). They should alternate between Warm and Cool colors, neighbors in your array should be >90° apart on the color wheel.
export const PALETTES: Record<string, { dark: string[], light: string[] }> = {

    dusty_alternating: {
        // Red -> Slate -> Orange -> Purple -> Gold -> Blue -> Rose
        dark: ["#c25e5e", "#5e8e99", "#c2865e", "#845ec2", "#c2a85e", "#5e73c2", "#c25e94"],
        // Darker variants for high contrast on light backgrounds
        light: ["#9e4545", "#3f666e", "#96623f", "#5e3f91", "#917c3f", "#425391", "#913f6b"]
    },
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

    catppuccin: {
        dark: ["#ed8796", "#8aadf4", "#eed49f", "#c6a0f6", "#f5a97f", "#8bd5ca", "#f5bde6"],
        light: ["#D20F39", "#1E66F5", "#DF8E1D", "#8839EF", "#FE640B", "#179299", "#EA76CB"]
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
// Updated to include all hash modes
export type HashMode = 'strict-full' | 'strict-acronym' | 'strict-first-last' | 'strict-first-two-last-two' | 'vowel-consonant' | 'position-weighted' | 'word-boundary-ngrams' | 'length-middle' | 'similarity' | 'phonetic-ipa';

export interface LinkColorSettings {
    palette: PaletteType;
    ignorePrefix: boolean;
    hashMode: HashMode;
    customSeed: number; // New setting for the hash seed
    darkSaturationMin: number;
    darkSaturationMax: number;
    darkLightnessMin: number;
    darkLightnessMax: number;
    lightSaturationMin: number;
    lightSaturationMax: number;
    lightLightnessMin: number;
    lightLightnessMax: number;
}

export const DEFAULT_SETTINGS: LinkColorSettings = {
    palette: 'vibrant',
    ignorePrefix: true,
    hashMode: 'strict-full',
    customSeed: 5381, // Default DJB2 seed
    darkSaturationMin: 30,
    darkSaturationMax: 65,
    darkLightnessMin: 50,
    darkLightnessMax: 75,
    lightSaturationMin: 50,
    lightSaturationMax: 95,
    lightLightnessMin: 20,
    lightLightnessMax: 50,
}

export const HASH_MODE_DESCRIPTIONS: Record<HashMode, { name: string; description: string }> = {
    'strict-full': {
        name: 'Strict (acronym + length)',
        description: 'Maximum uniqueness using acronyms, full text, and length. Different words get different colors.'
    },
    'strict-acronym': {
        name: 'Strict (acronym only)',
        description: 'Uses only first letters of words. Similar structure words may share colors.'
    },
    'strict-first-last': {
        name: 'Strict (first & last letters)',
        description: 'Uses the first and last letters of every word (e.g. "Data Science" -> "DaSe").'
    },
    'strict-first-two-last-two': {
        name: 'Strict (first 2 + last 2)',
        description: 'Uses first 2 and last 2 characters of each word. Better discrimination than first-last alone (e.g. "Data Science" -> "DataScce").'
    },
    'vowel-consonant': {
        name: 'Vowel-consonant pattern',
        description: 'Creates a pattern based on vowel/consonant positions. Each character becomes V or C, creating unique patterns.'
    },
    'position-weighted': {
        name: 'Position-weighted',
        description: 'Characters weighted by position (edges weighted more). Better discrimination for words with similar starts/ends but different middles.'
    },
    'word-boundary-ngrams': {
        name: 'Word boundary n-grams',
        description: 'Uses trigrams (3-char sequences) within words only, respecting word boundaries. Maintains word identity while providing good discrimination.'
    },
    'length-middle': {
        name: 'Length + middle chars',
        description: 'Combines word length with first, middle, and last characters. Excellent discrimination while being compact.'
    },
    'similarity': {
        name: 'Similarity-based',
        description: 'Similar words get similar colors using Levenshtein distance. Great for related terms.'
    },
    'phonetic-ipa': {
        name: 'Phonetic (IPA-inspired)',
        description: 'Words are mapped to an IPA-inspired phonetic form. Similar-sounding words (e.g. "see"/"sea", "cat"/"kat") get similar colors. Conlang-friendly.'
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
                    const name = key.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
                    dropdown.addOption(key, name);
                });
                dropdown
                    .setValue(this.plugin.settings.palette)
                    .onChange(async (value) => {
                        this.plugin.settings.palette = value;
                        await this.plugin.saveSettings();
                        this.updatePreview();
                    });
            });


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
                // Add all modes including the new ones
                const modes: HashMode[] = [
                    'strict-full',
                    'strict-acronym',
                    'strict-first-last',
                    'strict-first-two-last-two',
                    'vowel-consonant',
                    'position-weighted',
                    'word-boundary-ngrams',
                    'length-middle',
                    'similarity',
                    'phonetic-ipa'
                ];
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

        // --- GROUP 4: COLOR ADJUSTMENT ---
        new Setting(containerEl).setName("Color adjustment").setHeading();

        // Dark mode saturation
        new Setting(containerEl)
            .setName('Dark mode saturation')
            .setDesc('Saturation range for dark mode (lower = less vibrant, higher = more vibrant)')
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.darkSaturationMin)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.darkSaturationMin = value;
                    await this.plugin.saveSettings();
                }))
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.darkSaturationMax)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (value >= this.plugin.settings.darkSaturationMin) {
                        this.plugin.settings.darkSaturationMax = value;
                        await this.plugin.saveSettings();
                    }
                }));

        // Dark mode lightness
        new Setting(containerEl)
            .setName('Dark mode lightness')
            .setDesc('Lightness range for dark mode (lower = darker, higher = brighter)')
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.darkLightnessMin)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.darkLightnessMin = value;
                    await this.plugin.saveSettings();
                }))
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.darkLightnessMax)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (value >= this.plugin.settings.darkLightnessMin) {
                        this.plugin.settings.darkLightnessMax = value;
                        await this.plugin.saveSettings();
                    }
                }));

        // Light mode saturation
        new Setting(containerEl)
            .setName('Light mode saturation')
            .setDesc('Saturation range for light mode')
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.lightSaturationMin)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.lightSaturationMin = value;
                    await this.plugin.saveSettings();
                }))
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.lightSaturationMax)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (value >= this.plugin.settings.lightSaturationMin) {
                        this.plugin.settings.lightSaturationMax = value;
                        await this.plugin.saveSettings();
                    }
                }));

        // Light mode lightness
        new Setting(containerEl)
            .setName('Light mode lightness')
            .setDesc('Lightness range for light mode')
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.lightLightnessMin)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.lightLightnessMin = value;
                    await this.plugin.saveSettings();
                }))
            .addSlider(slider => slider
                .setLimits(0, 100, 1)
                .setValue(this.plugin.settings.lightLightnessMax)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    if (value >= this.plugin.settings.lightLightnessMin) {
                        this.plugin.settings.lightLightnessMax = value;
                        await this.plugin.saveSettings();
                    }
                }));
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

