import { type App, PluginSettingTab, Setting } from "obsidian";
import type LinkColorPlugin from "./main";
import { CollisionModal } from "./ui/collision-modal";

// --- 1. DEFINED PALETTES ---
// The palette should have distinctly different colors (that are different in hue instead of saturation or lightness). They should alternate between Warm and Cool colors, neighbors in your array should be >90° apart on the color wheel.
export const PALETTES: Record<string, { dark: string[]; light: string[] }> = {
	dusty_alternating: {
		// Red -> Slate -> Orange -> Purple -> Gold -> Blue -> Rose
		dark: [
			"#c25e5e",
			"#5e8e99",
			"#c2865e",
			"#845ec2",
			"#c2a85e",
			"#5e73c2",
			"#c25e94",
		],
		// Darker variants for high contrast on light backgrounds
		light: [
			"#9e4545",
			"#3f666e",
			"#96623f",
			"#5e3f91",
			"#917c3f",
			"#425391",
			"#913f6b",
		],
	},
	vibrant: {
		dark: [
			"#FF5252",
			"#448AFF",
			"#FFD740",
			"#E040FB",
			"#FFAB40",
			"#18FFFF",
			"#FF4081",
			"#69F0AE",
		],
		light: [
			"#D50000",
			"#2962FF",
			"#FFAB00",
			"#AA00FF",
			"#EF6C00",
			"#00B8D4",
			"#C51162",
			"#00C853",
		],
	},
	dracula: {
		dark: [
			"#FF5555",
			"#8BE9FD",
			"#FFB86C",
			"#BD93F9",
			"#F1FA8C",
			"#FF79C6",
			"#50FA7B",
		],
		light: [
			"#D92626",
			"#2692B8",
			"#CC7A00",
			"#7B53C9",
			"#B1BA5C",
			"#C04996",
			"#20AA4B",
		],
	},
	gruvbox: {
		dark: [
			"#cc241d",
			"#689d6a",
			"#d65d0e",
			"#458588",
			"#d79921",
			"#b16286",
			"#98971a",
		],
		light: [
			"#9d0006",
			"#427b58",
			"#af3a03",
			"#076678",
			"#b57614",
			"#8f3f71",
			"#79740e",
		],
	},
	tokyonight: {
		dark: [
			"#f7768e",
			"#7dcfff",
			"#ff9e64",
			"#7aa2f7",
			"#9ece6a",
			"#bb9af7",
			"#e0af68",
			"#1abc9c",
		],
		light: [
			"#8c4351",
			"#0f4b6e",
			"#965027",
			"#34548a",
			"#485e30",
			"#5a4a78",
			"#8f5e15",
			"#33635c",
		],
	},
	onedark: {
		dark: ["#e06c75", "#56b6c2", "#e5c07b", "#c678dd", "#98c379", "#61afef"],
		light: ["#e45649", "#0184bc", "#986801", "#a626a4", "#50a14f", "#4078f2"],
	},
	synthwave: {
		dark: ["#fe4450", "#36f9f6", "#ff7edb", "#72f1b8", "#f7f230", "#b893ce"],
		light: ["#d60010", "#00a19d", "#e4009e", "#199e63", "#bfba00", "#7d36a8"],
	},
	solarized: {
		dark: [
			"#dc322f",
			"#2aa198",
			"#cb4b16",
			"#268bd2",
			"#d33682",
			"#859900",
			"#b58900",
			"#6c71c4",
		],
		light: [
			"#dc322f",
			"#2aa198",
			"#cb4b16",
			"#268bd2",
			"#d33682",
			"#859900",
			"#b58900",
			"#6c71c4",
		],
	},
	nord: {
		dark: [
			"#BF616A",
			"#5E81AC",
			"#D08770",
			"#88C0D0",
			"#EBCB8B",
			"#81A1C1",
			"#A3BE8C",
			"#8FBCBB",
		],
		light: [
			"#BF616A",
			"#3B566E",
			"#C2664D",
			"#4C7899",
			"#B58900",
			"#5E81AC",
			"#7A9663",
			"#4C7A82",
		],
	},

	catppuccin: {
		dark: [
			"#ed8796",
			"#8aadf4",
			"#eed49f",
			"#c6a0f6",
			"#f5a97f",
			"#8bd5ca",
			"#f5bde6",
		],
		light: [
			"#D20F39",
			"#1E66F5",
			"#DF8E1D",
			"#8839EF",
			"#FE640B",
			"#179299",
			"#EA76CB",
		],
	},
	oceanic_next: {
		dark: [
			"#ec5f67",
			"#6699cc",
			"#f99157",
			"#62b3b2",
			"#fac863",
			"#c594c5",
			"#ab7967",
			"#99c794",
		],
		light: [
			"#C43C44",
			"#36608F",
			"#D66B2F",
			"#3C7877",
			"#B58900",
			"#875487",
			"#70483C",
			"#5F875A",
		],
	},
	kanagawa_dragon: {
		dark: [
			"#c4746e",
			"#7aa89f",
			"#e6c384",
			"#658594",
			"#dcd7ba",
			"#957fb8",
			"#98bb6c",
			"#938aa9",
		],
		light: [
			"#A6453D",
			"#4A756D",
			"#C98F28",
			"#3C5766",
			"#8A8567",
			"#6A5094",
			"#5A7D35",
			"#5C5370",
		],
	},
	iceberg: {
		dark: [
			"#e27878",
			"#84a0c6",
			"#e2a478",
			"#89b8c2",
			"#a093c7",
			"#b4be82",
			"#c6c8d1",
			"#d2d4de",
		],
		light: [
			"#9E3636",
			"#325480",
			"#9E6036",
			"#3B6873",
			"#5D4D87",
			"#5E6B2E",
			"#5E6273",
			"#454752",
		],
	},
	palenight: {
		dark: [
			"#f07178",
			"#82aaff",
			"#ffcb6b",
			"#c792ea",
			"#ff5370",
			"#c3e88d",
			"#89ddff",
			"#bfc7d5",
		],
		light: [
			"#A8383F",
			"#2C54AB",
			"#B37E19",
			"#703B94",
			"#AB223D",
			"#658A30",
			"#2B7A99",
			"#4D5663",
		],
	},
	ayu_mirage: {
		dark: [
			"#f28779",
			"#73d0ff",
			"#ffd580",
			"#d4bfff",
			"#bae67e",
			"#5ccfe6",
			"#95e6cb",
			"#cbccc6",
		],
		light: [
			"#A63D30",
			"#005F8F",
			"#B37A00",
			"#6B4EA8",
			"#5F8A24",
			"#00667A",
			"#2D7D62",
			"#5C5D57",
		],
	},

	// --- CIELAB-OPTIMIZED PALETTES ---
	// Mathematically designed for maximum perceptual distinctness using CIELAB color space
	// See docs/perceptual-palettes.md for detailed documentation

	perceptual_optimal: {
		// 8-color palette optimized for maximum Delta-E between all pairs
		// L*=70, C*=55, carefully distributed hues for uniform perceptual separation
		// Avoids muddy yellow-greens by strategic hue placement
		dark: [
			"#ff80ad",
			"#ff8774",
			"#e39c4c",
			"#8bb955",
			"#00c3a1",
			"#00c1f1",
			"#45b0ff",
			"#c497f8",
		],
		light: [
			"#d24a7e",
			"#cf5546",
			"#af6d15",
			"#598921",
			"#009372",
			"#0091c1",
			"#0082e0",
			"#9367c9",
		],
	},

	perceptual_no_neon: {
		// 8-color palette avoiding neon/electric greens (90-150° hue range)
		// Uses warm spectrum (reds, corals, golds) + cool teals/blues/purples
		// L*=70, C*=55, hues=[350,20,55,165,195,230,270,325]
		dark: [
			"#ff82be",
			"#ff828c",
			"#f4935a",
			"#00c290",
			"#00c4c3",
			"#00c0f7",
			"#45b0ff",
			"#e18de5",
		],
		light: [
			"#cd4c8f",
			"#d54d5d",
			"#bf6329",
			"#009261",
			"#009394",
			"#0090c7",
			"#0082e0",
			"#b05cb6",
		],
	},

	perceptual_vibrant: {
		// 7-color Ayu-balanced palette (no teal)
		// L*=68, C*=42 - Harmonizes with Ayu Mirage/Light themes
		// Min Delta-E ≈ 25 for good perceptual distinctness
		dark: [
			"#ec87a7",
			"#eb8c7c",
			"#d39b5f",
			"#8fb066",
			"#00b7da",
			"#6aaaf1",
			"#ba97e0",
		],
		light: [
			"#c94879",
			"#c55244",
			"#a76917",
			"#568322",
			"#008bb8",
			"#007cd5",
			"#8d63bf",
		],
	},

	perceptual_soft: {
		// 8-color soft palette - muted, Nord-like aesthetic
		// L*=68, C*=35 - Easy on the eyes for long sessions
		// Min Delta-E ≈ 21 - gentle color transitions
		dark: [
			"#e18da7",
			"#e19183",
			"#cd9c6b",
			"#94af71",
			"#53b69f",
			"#31b4d1",
			"#79a9e4",
			"#b79ad6",
		],
		light: [
			"#bf5179",
			"#bd594a",
			"#a36b27",
			"#5c8230",
			"#008a6f",
			"#0088b0",
			"#007bc9",
			"#8b66b6",
		],
	},
};

export type PaletteType = keyof typeof PALETTES;
// Updated to include all hash modes
export type HashMode =
	| "random"
	| "strict-full"
	| "strict-acronym"
	| "phonetic-ipa";

export interface LinkColorSettings {
	palette: PaletteType;
	ignorePrefix: boolean;
	hashMode: HashMode;
	customSeed: number; // New setting for the hash seed
	rerollOnFileChange: boolean; // Automatically re-roll colors when switching files
	priorityFilePrefix: string; // Process files matching this prefix first on re-roll
	// Auto-reroll when too many links share same color
	autoRerollThreshold: number; // Percentage threshold (0-100) - when % of links share colors, auto-reroll
	// --- Color variant settings ---
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
	palette: "vibrant",
	ignorePrefix: true,
	hashMode: "strict-full",
	customSeed: 5381, // Default DJB2 seed
	rerollOnFileChange: false,
	priorityFilePrefix: "",
	autoRerollThreshold: 30, // Auto-reroll when 30%+ links share colors
	// Color variant settings
	darkSaturationMin: 70,
	darkSaturationMax: 90,
	darkLightnessMin: 60,
	darkLightnessMax: 75,
	lightSaturationMin: 70,
	lightSaturationMax: 90,
	lightLightnessMin: 35,
	lightLightnessMax: 45,
};

export const HASH_MODE_DESCRIPTIONS: Record<
	HashMode,
	{ name: string; description: string }
> = {
	random: {
		name: "Random",
		description:
			"Assigns colors randomly. Re-roll button gives you new random colors.",
	},
	"strict-full": {
		name: "Character-based (Full)",
		description:
			"Uses all characters, acronym, and length for maximum uniqueness. Different words get different colors.",
	},
	"strict-acronym": {
		name: "First Letters Only",
		description:
			'Uses only first letters of words. Similar structure words may share colors (e.g., "Design System" ≈ "Data Science").',
	},
	"phonetic-ipa": {
		name: "Sound-Based",
		description:
			'Similar-sounding words get similar colors (e.g., "see"/"sea", "cat"/"kat"). Great for conlangs.',
	},
};

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
			.setName("Color palette")
			.setDesc("Choose a predefined color scheme.")
			.addDropdown((dropdown) => {
				Object.keys(PALETTES).forEach((key) => {
					const name = key
						.replace(/_/g, " ")
						.toLowerCase()
						.replace(/^\w/, (c) => c.toUpperCase());
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
		this.previewEl = containerEl.createDiv({
			cls: "link-color-preview-container",
		});
		this.updatePreview();

		// --- GROUP 2: HOW LINKS GET COLORS ---
		new Setting(containerEl).setName("How links get colors").setHeading();

		// Hash mode with examples
		const hashModeSetting = new Setting(containerEl)
			.setName("Color assignment method")
			.setDesc("Choose how link text is converted into colors.");

		const hashModeDesc = containerEl.createDiv({
			cls: "link-color-mode-description",
		});
		this.updateHashModeDescription(hashModeDesc);

		hashModeSetting.addDropdown((dropdown) => {
			(Object.keys(HASH_MODE_DESCRIPTIONS) as HashMode[]).forEach((mode) => {
				dropdown.addOption(mode, HASH_MODE_DESCRIPTIONS[mode].name);
			});
			dropdown
				.setValue(this.plugin.settings.hashMode)
				.onChange(async (value) => {
					this.plugin.settings.hashMode = value as HashMode;
					this.updateHashModeDescription(hashModeDesc);
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl)
			.setName("Ignore prefixes")
			.setDesc('Treat "char - pamela" the same as "pamela" for coloring. Useful for structured link names.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignorePrefix)
					.onChange(async (value) => {
						this.plugin.settings.ignorePrefix = value;
						await this.plugin.saveSettings();
					}),
			);

		// --- GROUP 3: COLOR MANAGEMENT ---
		new Setting(containerEl).setName("Color management").setHeading();

		// Seed as read-only info + shuffle button
		new Setting(containerEl)
			.setName("Shuffle colors")
			.setDesc(`Current seed: ${this.plugin.settings.customSeed}`)
			.addButton((btn) =>
				btn
					.setButtonText("Shuffle all colors")
					.setTooltip("Pick a random seed to assign new colors to all links")
					.onClick(async () => {
						const newSeed = Math.floor(Math.random() * 100000) + 1;
						this.plugin.settings.customSeed = newSeed;
						this.plugin.resetColorState();
						this.display();
						await this.plugin.saveSettings();
						await this.plugin.forceViewUpdate();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Reset color cache")
					.setTooltip("Clear all cached colors and regenerate")
					.setWarning()
					.onClick(async () => {
						this.plugin.resetColorState();
						this.display();
						await this.plugin.forceViewUpdate();
					}),
			);

		// Collision status inline
		const collisionStatusEl = containerEl.createDiv({
			cls: "link-color-collision-status",
		});
		this.updateCollisionStatus(collisionStatusEl);

		new Setting(containerEl)
			.setName("Auto-reroll threshold")
			.setDesc(
				`Automatically shuffle colors when too many links share the same color. Set to 0 to disable.`,
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 5)
					.setValue(this.plugin.settings.autoRerollThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoRerollThreshold = value;
						await this.plugin.saveSettings();
						this.updateCollisionStatus(collisionStatusEl);
					}),
			);

		new Setting(containerEl)
			.setName("Folder-based color consistency")
			.setDesc(
				"Keep consistent colors when switching between files in the same folder. Enable for project-based or chapter-based organization.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rerollOnFileChange)
					.onChange(async (value) => {
						this.plugin.settings.rerollOnFileChange = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Priority file prefix")
			.setDesc(
				"Files starting with this prefix (e.g., 'Chapter - ') get first pick of colors. Useful for index pages that link to many topics.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Chapter - ")
					.setValue(this.plugin.settings.priorityFilePrefix)
					.onChange(async (value) => {
						this.plugin.settings.priorityFilePrefix = value;
						await this.plugin.saveSettings();
					}),
			);

		// --- GROUP 4: STATISTICS ---
		new Setting(containerEl).setName("Statistics").setHeading();

		new Setting(containerEl)
			.setName("Detailed collision statistics")
			.setDesc(
				"View detailed statistics about which links share colors.",
			)
			.addButton((btn) =>
				btn
					.setButtonText("View statistics")
					.setTooltip("Open the link collision statistics modal")
					.onClick(() => {
						new CollisionModal(this.app, this.plugin).open();
					}),
			);
	}

	private updateHashModeDescription(container: HTMLElement): void {
		const mode = this.plugin.settings.hashMode;
		const info = HASH_MODE_DESCRIPTIONS[mode];

		container.empty();

		// Main description
		container.createEl("div", {
			text: info.description,
			cls: "link-color-mode-main-desc",
		});

		// Examples based on mode
		const examplesContainer = container.createDiv({
			cls: "link-color-mode-examples",
		});

		const examples = this.getHashModeExamples(mode);
		examplesContainer.createEl("div", {
			text: "How similar links are colored:",
			cls: "link-color-examples-label",
		});

		for (const example of examples) {
			const row = examplesContainer.createDiv({ cls: "link-color-example-row" });
			row.createEl("span", { text: example.input, cls: "link-color-example-input" });
			row.createEl("span", { text: "→", cls: "link-color-example-arrow" });
			row.createEl("span", { text: example.output, cls: "link-color-example-output" });
		}
	}

	private getHashModeExamples(mode: HashMode): Array<{ input: string; output: string }> {
		switch (mode) {
			case "random":
				return [
					{ input: '"Design"', output: "random color, changes each session" },
					{ input: '"Design"', output: "different color on re-roll" },
				];
			case "strict-full":
				return [
					{ input: '"Design System"', output: "unique color (all chars)" },
					{ input: '"Design Patterns"', output: "different color" },
					{ input: '"Design System"', output: "same color always" },
				];
			case "strict-acronym":
				return [
					{ input: '"Design System"', output: "color from 'DS'" },
					{ input: '"Data Science"', output: "same color (also 'DS')" },
					{ input: '"Design Patterns"', output: "different color ('DP')" },
				];
			case "phonetic-ipa":
				return [
					{ input: '"see"', output: "color A" },
					{ input: '"sea"', output: "similar color (sounds same)" },
					{ input: '"Design"', output: "color B" },
				];
			default:
				return [{ input: '"Link"', output: "unique color" }];
		}
	}

	private updateCollisionStatus(container: HTMLElement): void {
		const colorMap = this.plugin.getLinkColorMap();
		const totalLinks = colorMap.size;

		if (totalLinks === 0) {
			container.empty();
			container.addClass("link-color-status-empty");
			container.createEl("span", {
				text: "No links colored yet. Open files with wiki-links to see status.",
				cls: "link-color-status-empty-text",
			});
			return;
		}

		// Count color distribution
		const colorCounts = new Map<string, number>();
		for (const color of colorMap.values()) {
			colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
		}

		// Find max collision
		let maxCount = 0;
		for (const count of colorCounts.values()) {
			if (count > maxCount) maxCount = count;
		}

		const maxPercentage = (maxCount / totalLinks) * 100;
		const threshold = this.plugin.settings.autoRerollThreshold;
		const isGood = threshold === 0 || maxPercentage < threshold;

		container.empty();
		container.removeClass("link-color-status-empty");
		container.addClass("link-color-status-bar");

		// Status indicator
		const statusIcon = container.createEl("span", {
			cls: isGood ? "link-color-status-good" : "link-color-status-warning",
		});
		statusIcon.setText(isGood ? "✓" : "⚠");

		// Stats text
		const statsText = container.createEl("span", { cls: "link-color-status-text" });
		const uniqueColors = colorCounts.size;
		statsText.setText(
			`${totalLinks} links, ${uniqueColors} colors, max ${maxCount} links share one color (${maxPercentage.toFixed(0)}%)`,
		);
	}

	updatePreview() {
		this.previewEl.empty();
		const currentPalette = this.plugin.settings.palette;
		const isDarkMode = document.body.classList.contains("theme-dark");

		const palette = PALETTES[currentPalette] || PALETTES["vibrant"];
		if (!palette) return;

		const colors = isDarkMode ? palette.dark : palette.light;

		colors.forEach((color) => {
			const box = this.previewEl.createDiv({ cls: "link-color-preview-box" });
			box.style.backgroundColor = color;
			box.title = color;
		});
	}
}
