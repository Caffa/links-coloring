/**
 * Link Collision Statistics Modal
 *
 * Displays link collision statistics in two modes:
 * 1. Bar Chart - shows percentage distribution of colors
 * 2. Table View - shows all links organized by color
 */

import { App, Modal, Setting } from "obsidian";
import type LinkColorPlugin from "../main";
import { PALETTES } from "../settings";
import { getLinkPaletteIndexMap } from "../main";
import { stripPrefix } from "../color-utils";

export interface ColorStats {
	color: string;
	count: number;
	percentage: number;
	paletteIndex: number;
	uniqueVariants: number;
}

export interface LinkColorData {
	linkText: string;
	color: string;
	paletteIndex: number;
}

export type ViewMode = "chart" | "table";

export class CollisionModal extends Modal {
	private plugin: LinkColorPlugin;
	private mode: ViewMode = "chart";
	private contentContainer: HTMLElement;
	private stats: ColorStats[] = [];
	private linksByColor: Map<string, LinkColorData[]> = new Map();
	private totalLinks: number = 0;

	constructor(app: App, plugin: LinkColorPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		this.calculateStats();
		this.render();
	}

	private calculateStats() {
		// Get the link-to-color mapping and palette index mapping from the plugin
		const linkColorMap = this.plugin.getLinkColorMap();
		const linkPaletteIndexMap = getLinkPaletteIndexMap();
		const paletteKey = this.plugin.settings.palette;
		const palette = PALETTES[paletteKey] ?? PALETTES.vibrant!;
		const isDarkMode = document.body.classList.contains("theme-dark");
		const colorList = isDarkMode ? palette.dark : palette.light;

		// Reset stats
		this.stats = [];
		this.linksByColor.clear();
		this.totalLinks = 0;

		// Initialize counters for all palette colors
		const colorCounts = new Map<number, number>();
		for (let i = 0; i < colorList.length; i++) {
			colorCounts.set(i, 0);
		}

		// Track unique variants per palette color
		const variantsPerColor = new Map<number, Set<string>>();

		// Count links per palette index
		linkColorMap.forEach((color, linkText) => {
			const paletteIndex = linkPaletteIndexMap.get(linkText);
			if (paletteIndex !== undefined && paletteIndex < colorList.length) {
				const currentCount = colorCounts.get(paletteIndex) ?? 0;
				colorCounts.set(paletteIndex, currentCount + 1);
				this.totalLinks++;

				// Track variants
				if (!variantsPerColor.has(paletteIndex)) {
					variantsPerColor.set(paletteIndex, new Set());
				}
				variantsPerColor.get(paletteIndex)?.add(color.toLowerCase());

				// Track link data for table view
				const baseColor = colorList[paletteIndex];
				if (baseColor && !this.linksByColor.has(baseColor)) {
					this.linksByColor.set(baseColor, []);
				}
				if (baseColor) {
					this.linksByColor.get(baseColor)?.push({
						linkText,
						color,
						paletteIndex,
					});
				}
			}
		});

		// Convert to stats array sorted by count descending
		this.stats = Array.from(colorCounts.entries())
			.map(([index, count]) => ({
				color: colorList[index]!,
				count,
				percentage: this.totalLinks > 0 ? (count / this.totalLinks) * 100 : 0,
				paletteIndex: index,
				uniqueVariants: variantsPerColor.get(index)?.size ?? 0,
			}))
			.sort((a, b) => b.count - a.count);

		// Sort links alphabetically within each color
		this.linksByColor.forEach((links) => {
			links.sort((a, b) => a.linkText.localeCompare(b.linkText));
		});
	}

	private render() {
		this.contentEl.empty();
		this.contentEl.addClass("link-collision-modal");

		// Title
		this.contentEl.createEl("h2", { text: "Link Collision Statistics" });

		// Stats bar
		const statsBar = this.contentEl.createDiv({ cls: "collision-stats-bar" });
		statsBar.createEl("span", {
			text: `Total links: ${this.totalLinks}`,
		});
		statsBar.createEl("span", {
			text: `Unique colors: ${this.stats.filter((s) => s.count > 0).length}`,
		});

		// Mode toggle
		const toggleContainer = this.contentEl.createDiv({ cls: "collision-mode-toggle" });
		new Setting(toggleContainer)
			.setName("View mode")
			.setDesc("Switch between bar chart and table view")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("chart", "Bar Chart")
					.addOption("table", "Table View")
					.setValue(this.mode)
					.onChange((value) => {
						this.mode = value as ViewMode;
						this.render();
					});
			});

		// Refresh button
		new Setting(this.contentEl)
			.setName("Refresh data")
			.setDesc("Recalculate statistics from current link colors")
			.addButton((btn) => {
				btn.setButtonText("Refresh");
				btn.onClick(() => {
					this.calculateStats();
					this.render();
				});
			});

		// Content container
		this.contentContainer = this.contentEl.createDiv({
			cls: "collision-content-container",
		});

		if (this.mode === "chart") {
			this.renderChartView();
		} else {
			this.renderTableView();
		}

		// Close button
		new Setting(this.contentEl).addButton((btn) => {
			btn.setButtonText("Close");
			btn.onClick(() => {
				this.close();
			});
		});
	}

	private renderChartView() {
		const chartContainer = this.contentContainer.createDiv({
			cls: "collision-chart-container",
		});

		// Find max count for scaling
		const maxCount = Math.max(...this.stats.map((s) => s.count), 1);

		// Create bar for each color
		this.stats.forEach((stat) => {
			const row = chartContainer.createDiv({ cls: "collision-chart-row" });

			// Color swatch
			const swatch = row.createDiv({ cls: "collision-color-swatch" });
			swatch.style.backgroundColor = stat.color;
			swatch.title = stat.color;

			// Bar container
			const barContainer = row.createDiv({ cls: "collision-bar-container" });

			// Bar fill
			const barFill = barContainer.createDiv({ cls: "collision-bar-fill" });
			const width = maxCount > 0 ? (stat.count / maxCount) * 100 : 0;
			barFill.style.width = `${Math.max(width, stat.count > 0 ? 4 : 0)}%`;
			barFill.style.backgroundColor = stat.color;
			barFill.style.opacity = "0.6";

			// Count (prominent)
			barContainer.createDiv({
				cls: "collision-count-display",
				text: `${stat.count} link${stat.count !== 1 ? "s" : ""}`,
			});

			// Variant info
			if (stat.count > 0 && stat.uniqueVariants > 0) {
				barContainer.createDiv({
					cls: "collision-variants",
					text: `${stat.uniqueVariants} variant${stat.uniqueVariants !== 1 ? "s" : ""}`,
				});
			}

			// Percentage label
			barContainer.createDiv({
				cls: "collision-percentage",
				text: `(${stat.percentage.toFixed(1)}%)`,
			});
		});

		// Add note if no links
		if (this.totalLinks === 0) {
			chartContainer.createDiv({
				cls: "collision-empty",
				text: "No links have been colored yet. Open files with wiki-links to see statistics.",
			});
		}
	}

	private renderTableView() {
		const tableContainer = this.contentContainer.createDiv({
			cls: "collision-table-container",
		});

		if (this.totalLinks === 0) {
			tableContainer.createDiv({
				cls: "collision-empty",
				text: "No links have been colored yet. Open files with wiki-links to see statistics.",
			});
			return;
		}

		// Create columns for each color (sorted by palette index)
		const sortedColors = [...this.linksByColor.keys()].sort((a, b) => {
			const aIdx = this.stats.find((s) => s.color === a)?.paletteIndex ?? 0;
			const bIdx = this.stats.find((s) => s.color === b)?.paletteIndex ?? 0;
			return aIdx - bIdx;
		});

		const columnsContainer = tableContainer.createDiv({
			cls: "collision-table-columns",
		});

		sortedColors.forEach((color) => {
			const links = this.linksByColor.get(color) ?? [];
			const statInfo = this.stats.find((s) => s.color === color);

			const column = columnsContainer.createDiv({ cls: "collision-table-column" });

			// Column header
			const header = column.createDiv({ cls: "collision-column-header" });
			const swatch = header.createDiv({ cls: "collision-color-swatch-small" });
			swatch.style.backgroundColor = color;
			swatch.title = color;
			header.createEl("span", {
				cls: "collision-column-count",
				text: `(${links.length})`,
			});

			// Variant count in column header
			if (statInfo && statInfo.uniqueVariants > 0) {
				header.createEl("span", {
					cls: "collision-column-variants",
					text: statInfo.uniqueVariants === 1 ? "1 shade" : `${statInfo.uniqueVariants} shades`,
				});
			}

			// Column body
			const body = column.createDiv({ cls: "collision-column-body" });

			links.forEach((linkData) => {
				const displayName = stripPrefix(linkData.linkText) ?? linkData.linkText;
				const linkEl = body.createDiv({
					cls: "collision-link-item",
					text: displayName,
				});
				linkEl.title = linkData.linkText;
				linkEl.style.color = linkData.color;
			});
		});

		// Scroll hint
		tableContainer.createDiv({
			cls: "collision-scroll-hint",
			text: "Scroll horizontally to see all columns",
		});
	}
}