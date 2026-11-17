import { type App, PluginSettingTab, Setting } from "obsidian";
import type LinkColorPlugin from "./main";
import { CollisionModal } from "./ui/collision-modal";
import { emitRecolorEvent } from "./public-api";


import {
	PALETTES,
	type HashMode,
} from "./settings-data";

export {
	PALETTES,
	DEFAULT_SETTINGS,
	type PaletteType,
	type HashMode,
	type LinkColorSettings,
} from "./settings-data";


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
						await this.plugin.saveSettings('reroll');
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
						emitRecolorEvent(this.plugin, 'reroll');
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
