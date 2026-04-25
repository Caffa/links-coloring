import { syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { type App, Plugin, type TFile, type Vault, MarkdownView } from "obsidian";
import { hashPhoneticIpa } from "./phonetic";
import {
	DEFAULT_SETTINGS,
	HASH_MODE_DESCRIPTIONS,
	type HashMode,
	type LinkColorSettings,
	LinkColorSettingTab,
	PALETTES,
} from "./settings";

// Global text-to-color mapping to ensure consistent shading per text
const textColorMap = new Map<string, string>();
// Track how many times each base color has been used (for shade generation)
const colorUsageMap = new Map<string, number>();
// Track which hash mode is currently active for this session
let activeHashMode: HashMode = "strict-full";
let isSmartModeEvaluated = false;
// Store evaluated hash modes with their scores
const hashModeScores = new Map<HashMode, number>();
// Track current parent folder path for folder-based re-roll
let currentParentFolderPath: string | null = null;
// Track files that have been opened (to distinguish new file opens from tab switches)
const openedFiles = new Set<string>();
// Track which files have been precomputed to avoid redundant work
const precomputedFiles = new Set<string>();
// Track last known seed to detect changes - used to force view updates
// Initialize to -1 (an impossible seed value) to force initial render
let lastKnownSeed: number = -1;
// Track last known hash mode to detect changes and invalidate cache
let lastKnownHashMode: HashMode | null = null;
// Threshold for normalizing color usage counts (prevents unbounded growth and convergence)
const COLOR_USAGE_NORMALIZE_THRESHOLD = 50;

/**
 * Normalize color usage counts when they grow too large.
 * When all palette indices have high usage counts, load balancing becomes pointless
 * because everything is "tied". This function caps the relative differences by
 * subtracting the minimum usage from all counts, preventing unbounded growth
 * while preserving relative ordering.
 */
function normalizeColorUsage(
	palette: string,
	isDarkMode: boolean,
	seed: number,
	paletteSize: number,
): void {
	// Check if any usage count exceeds the threshold
	let minUsage = Number.MAX_SAFE_INTEGER;
	let maxUsage = 0;
	for (let i = 0; i < paletteSize; i++) {
		const key = `${palette}-${isDarkMode ? "dark" : "light"}-${seed}-${i}`;
		const usage = colorUsageMap.get(key) || 0;
		minUsage = Math.min(minUsage, usage);
		maxUsage = Math.max(maxUsage, usage);
	}

	// Only normalize when the minimum usage exceeds the threshold
	// (meaning all colors have been used many times)
	if (minUsage < COLOR_USAGE_NORMALIZE_THRESHOLD) return;

	// Subtract the minimum from all counts to keep relative ordering
	// while preventing unbounded growth
	for (let i = 0; i < paletteSize; i++) {
		const key = `${palette}-${isDarkMode ? "dark" : "light"}-${seed}-${i}`;
		const usage = colorUsageMap.get(key);
		if (usage !== undefined) {
			colorUsageMap.set(key, usage - minUsage);
		}
	}
}

/**
 * Extract unique wiki-style links from a file (ASYNC VERSION)
 * Returns link targets (the text inside [[...]])
 * 
 * FIX: This was previously synchronous but used vault.cachedRead which returns a Promise.
 * Now properly awaits the async read operation.
 */
async function extractLinksFromFileAsync(file: TFile, vault: Vault): Promise<string[]> {
	try {
		const content = await vault.cachedRead(file);
		if (!content) return [];

		// Match [[link]] and [[link|alias]] patterns
		const linkPattern = /\[\[([^\]]+)\]\]/g;
		const links: string[] = [];
		let match: RegExpExecArray | null = null;

		while (true) {
			match = linkPattern.exec(content);
			if (match === null) break;

			const linkText = match[1];
			if (!linkText) continue;

			// Handle aliases: [[target|alias]] → use "target"
			const pipeIndex = linkText.indexOf("|");
			const cleanLinkText =
				pipeIndex !== -1 ? linkText.substring(0, pipeIndex) : linkText;
			links.push(cleanLinkText);
		}

		return [...new Set(links)]; // Deduplicate
	} catch (error) {
		console.warn("Failed to extract links from file:", file.path, error);
		return [];
	}
}

/**
 * Extract links synchronously from already-loaded content
 * Used by buildDecorations for immediate processing
 */
function extractLinksFromContent(content: string): string[] {
	if (!content) return [];

	const linkPattern = /\[\[([^\]]+)\]\]/g;
	const links: string[] = [];
	let match: RegExpExecArray | null = null;

	while (true) {
		match = linkPattern.exec(content);
		if (match === null) break;

		const linkText = match[1];
		if (!linkText) continue;

		const pipeIndex = linkText.indexOf("|");
		const cleanLinkText =
			pipeIndex !== -1 ? linkText.substring(0, pipeIndex) : linkText;
		links.push(cleanLinkText);
	}

	return [...new Set(links)];
}

/**
 * Extract links with their occurrence counts from content.
 * Returns a Map of link text → count, sorted by count descending.
 * Links that appear more times are listed first, so they can claim
 * the most distinct palette colors during priority precomputation.
 */
function extractLinksWithCounts(content: string): Map<string, number> {
	if (!content) return new Map();

	const linkPattern = /\[\[([^\]]+)\]\]/g;
	const counts = new Map<string, number>();
	let match: RegExpExecArray | null = null;

	while (true) {
		match = linkPattern.exec(content);
		if (match === null) break;

		const linkText = match[1];
		if (!linkText) continue;

		const pipeIndex = linkText.indexOf("|");
		const cleanLinkText =
			pipeIndex !== -1 ? linkText.substring(0, pipeIndex) : linkText;
		counts.set(cleanLinkText, (counts.get(cleanLinkText) || 0) + 1);
	}

	// Sort by count descending (most frequent first)
	const sorted = new Map<string, number>();
	const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	for (const [link, count] of entries) {
		sorted.set(link, count);
	}

	return sorted;
}

/**
 * Collect sample links from current folder context
 * - Starts with links from current active file
 * - Then adds links from same folder
 * - If < 20 links, moves up folder hierarchy
 * - Continues until 20+ links or reaches vault root
 * 
 * FIX: Now properly awaits async file reads
 */
async function collectSampleLinks(
	app: App,
	minLinks: number = 20,
	maxLinks: number = 50,
): Promise<string[]> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		// No active file, use some arbitrary file
		const files = app.vault.getMarkdownFiles();
		if (files.length === 0) return [];
		const firstFile = files[0];
		if (!firstFile) return [];
		const links = await extractLinksFromFileAsync(firstFile, app.vault);
		return links.slice(0, maxLinks);
	}

	const sampleLinks = new Set<string>();

	// Step 1: Extract links from current active file
	const currentFileLinks = await extractLinksFromFileAsync(activeFile, app.vault);
	currentFileLinks.forEach((link) => sampleLinks.add(link));

	if (sampleLinks.size >= minLinks) {
		return Array.from(sampleLinks).slice(0, maxLinks);
	}

	// Step 2: Add links from files in same folder
	const folder = activeFile.parent;
	if (folder) {
		const folderFiles = app.vault
			.getMarkdownFiles()
			.filter((f: TFile) => f.parent === folder);
		for (const file of folderFiles) {
			const links = await extractLinksFromFileAsync(file, app.vault);
			links.forEach((link) => sampleLinks.add(link));
			if (sampleLinks.size >= maxLinks) {
				return Array.from(sampleLinks).slice(0, maxLinks);
			}
		}
	}

	// Step 3: Move up folder hierarchy until we have enough links
	let currentFolder = folder;
	while (currentFolder && sampleLinks.size < maxLinks) {
		// Move up one level
		currentFolder = currentFolder.parent;
		if (!currentFolder) break; // Reached vault root

		// Get all files in this folder
		const folderFiles = app.vault
			.getMarkdownFiles()
			.filter((f: TFile) => f.parent === currentFolder);
		for (const file of folderFiles) {
			const links = await extractLinksFromFileAsync(file, app.vault);
			links.forEach((link) => sampleLinks.add(link));
			if (sampleLinks.size >= maxLinks) {
				return Array.from(sampleLinks).slice(0, maxLinks);
			}
		}
	}

	// Return collected links
	return Array.from(sampleLinks);
}

/**
 * Pre-compute colors for all links in the active file
 * This eliminates scroll lag by populating the cache before links come into view
 */
async function precomputeFileLinkColors(
	file: TFile,
	plugin: LinkColorPlugin,
): Promise<void> {
	const filePath = file.path;

	// Skip if already precomputed (prevents redundant work on file switches)
	if (precomputedFiles.has(filePath)) {
		return;
	}

	try {
		const content = await plugin.app.vault.cachedRead(file);
		const links = extractLinksFromContent(content);
		const isDarkMode = document.body.classList.contains("theme-dark");

		// Pre-compute colors for all links (populates textColorMap cache)
		for (const link of links) {
			getColor(link, plugin.settings, isDarkMode);
		}

		// Mark as precomputed
		precomputedFiles.add(filePath);
	} catch (error) {
		console.warn("Failed to precompute link colors:", error);
	}
}

/**
 * Pre-compute colors for links in a file, processing them by frequency.
 * Links with more occurrences are processed first, so they claim the most
 * distinct colors from the load-balancing algorithm. This is used for
 * priority files (e.g., "Chapter - *" pages) to ensure their most
 * frequently-appearing links get the best color distribution.
 */
async function precomputeFileLinkColorsByFrequency(
	file: TFile,
	plugin: LinkColorPlugin,
): Promise<void> {
	const filePath = file.path;

	// Skip if already precomputed (prevents redundant work on file switches)
	if (precomputedFiles.has(filePath)) {
		return;
	}

	try {
		const content = await plugin.app.vault.cachedRead(file);
		const linksWithCounts = extractLinksWithCounts(content);
		const isDarkMode = document.body.classList.contains("theme-dark");

		// Process links in order of frequency (most frequent first)
		// This gives the most-occurring links the freshest palette colors
		for (const [link] of linksWithCounts) {
			getColor(link, plugin.settings, isDarkMode);
		}

		// Mark as precomputed
		precomputedFiles.add(filePath);
	} catch (error) {
		console.warn("Failed to precompute link colors by frequency:", error);
	}
}

/**
 * Get random color from palette with consistency and color avoidance
 * - Uses caching to ensure same link text gets same color per session
 * - Implements load balancing to avoid overusing colors
 * - Applies hue/shade adjustments for visual distinction
 */
function getRandomColor(
	text: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
): string {
	// 1. Clean Prefix (consistent with other modes)
	if (settings.ignorePrefix && text.includes(" - ")) {
		const parts = text.split(" - ");
		const namePart = parts[parts.length - 1];
		if (namePart) text = namePart.trim();
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();
	const seed = settings.customSeed;

	// 3. Check Cache (consistent with other modes)
	const rangeKey = isDarkMode
		? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
		: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
	const textKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${rangeKey}-random-${cleaned}`;
	if (textColorMap.has(textKey)) {
		return textColorMap.get(textKey)!;
	}

	// 4. Generate random hash (different from other modes)
	const hash = djb2Hash(cleaned, seed);

	// 5. Select Palette with Load Balancing
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	// Load Balancing: find least used color(s), then random tiebreaker among ties
	let bestIndex = -1;
	let minUsage = Number.MAX_SAFE_INTEGER;
	const candidates: number[] = []; // indices tied at minUsage
	const startOffset = hash % paletteSize;

	for (let i = 0; i < paletteSize; i++) {
		const idx = (startOffset + i) % paletteSize;
		const key = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${idx}`;
		const usage = colorUsageMap.get(key) || 0;

		if (usage < minUsage) {
			minUsage = usage;
			candidates.length = 0;
			candidates.push(idx);
		} else if (usage === minUsage) {
			candidates.push(idx);
		}
	}

	// Random tiebreaker among equally-used colors (prevents deterministic convergence)
	if (candidates.length === 1) {
		bestIndex = candidates[0]!;
	} else {
		// Use the hash to deterministically but uniformly pick among tied candidates
		bestIndex = candidates[Math.abs(hash) % candidates.length]!;
	}

	// 6. Register Usage
	const selectedKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	let currentUsageCount = colorUsageMap.get(selectedKey) || 0;
	colorUsageMap.set(selectedKey, currentUsageCount + 1);

	// Normalize usage counts when they grow too large (prevents convergence
	// where all indices are tied at high usage and load balancing becomes useless)
	normalizeColorUsage(settings.palette, isDarkMode, seed, paletteSize);

	const actualUsageCount = currentUsageCount;
	const baseColor = colorList[bestIndex]!;

	// 7. Apply Hue/Shade Adjustments (same as other modes)
	const variantSeed = djb2Hash(cleaned + "|v", seed);
	const finalColor = applyAggressiveVariant(
		baseColor,
		variantSeed,
		actualUsageCount,
		isDarkMode,
		settings,
	);

	// 8. Cache Result
	textColorMap.set(textKey, finalColor);

	return finalColor;
}

/**
 * Smart mode: Evaluates all hash modes against links from current folder context
 * and selects one with best color distribution for session
 */
async function evaluateSmartHashMode(
	plugin: LinkColorPlugin,
): Promise<HashMode> {
	if (isSmartModeEvaluated && hashModeScores.size > 0) {
		return activeHashMode; // Already evaluated this session
	}

	const isDarkMode = document.body.classList.contains("theme-dark");
	const paletteObj = PALETTES[plugin.settings.palette] ?? PALETTES["vibrant"]!;
	const palette = isDarkMode ? paletteObj.dark : paletteObj.light;
	const availableModes = Object.keys(HASH_MODE_DESCRIPTIONS) as HashMode[];

	// Collect sample links from folder context
	const sampleLinks = await collectSampleLinks(plugin.app);

	if (sampleLinks.length === 0) {
		// No links found, use default
		activeHashMode = "strict-full";
		isSmartModeEvaluated = true;
		return activeHashMode;
	}

	console.log(`Smart mode evaluating ${sampleLinks.length} sample links...`);

	// Evaluate each hash mode
	const scores = availableModes.map((mode) => {
		// Count how many colors each hash mode produces
		const colorCounts = new Map<string, number>();

		for (const link of sampleLinks) {
			if (mode === "random") continue; // Skip random mode in evaluation
			const color = getColorWithHashMode(
				link,
				mode,
				plugin.settings,
				isDarkMode,
				false,
			);
			colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
		}

		// Calculate score:
		// 1. Prefer using more colors from palette (higher unique count = better)
		// 2. Prefer even distribution (lower max usage = better)
		const uniqueColors = colorCounts.size;
		const colorCountsValues = Array.from(colorCounts.values());
		const maxUsage =
			colorCountsValues.length > 0 ? Math.max(...colorCountsValues) : 0;
		const distributionScore = maxUsage / sampleLinks.length; // Lower is better

		// Combined score: prioritize unique colors, then even distribution
		// Weight: unique colors × 100 - distribution × 10
		const score = uniqueColors * 100 - distributionScore * 10;

		hashModeScores.set(mode, score);

		return { mode, score, uniqueColors, maxUsage };
	});

	// Sort by score (descending - higher score is better)
	scores.sort((a, b) => b.score - a.score);

	// Select best mode
	if (scores.length > 0) {
		const bestScore = scores[0];
		if (bestScore) {
			activeHashMode = bestScore.mode;
			isSmartModeEvaluated = true;

			const modeDescription = HASH_MODE_DESCRIPTIONS[activeHashMode];
			console.log(`Smart mode selected: ${modeDescription?.name || "unknown"}`);
			console.log(
				`  Unique colors: ${bestScore.uniqueColors}/${palette.length}`,
			);
			console.log(
				`  Max usage: ${bestScore.maxUsage}/${sampleLinks.length} (${((bestScore.maxUsage / sampleLinks.length) * 100).toFixed(1)}%)`,
			);
		}
	}

	return activeHashMode;
}

export default class LinkColorPlugin extends Plugin {
	settings: LinkColorSettings;
	editorExtension: Extension;

	async onload() {
		await this.loadSettings();
		// Initialize seed tracking from settings
		lastKnownSeed = this.settings.customSeed;
		// Initialize hash mode tracking from settings to avoid spurious cache clear on first render
		lastKnownHashMode = this.settings.hashMode;
		this.addSettingTab(new LinkColorSettingTab(this.app, this));
		this.editorExtension = createLinkColorExtension(this);
		this.registerEditorExtension(this.editorExtension);

		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				// Clear precomputed files so they'll be recomputed with new theme colors
				precomputedFiles.clear();
				// Precompute colors for the current active file with new theme
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					precomputeFileLinkColors(activeFile, this);
				}
				this.app.workspace.updateOptions();
			}),
		);

		// Handle file changes with folder-based re-roll and pre-processing
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", async (leaf) => {
				if (!leaf) return;

				const view = leaf.view;
				// Check if this is a file view with a file
				const file = 'file' in view ? (view as any).file : null;
				if (!file) return;

				const newParentPath = file.parent?.path ?? null;
				const parentChanged = newParentPath !== currentParentFolderPath;
				const filePath = file.path;
				const isNewFile = !openedFiles.has(filePath);

				// OPTION 1: Folder-based re-roll
				// Re-roll when parent folder changes AND a new file is opened
				// (not when switching between already-open tabs)
				if (this.settings.rerollOnFileChange && parentChanged && isNewFile) {
					// Generate a new random seed
					const newSeed = Math.floor(Math.random() * 100000) + 1;
					this.settings.customSeed = newSeed;
					// Clear the color cache so new colors are generated
					this.resetColorState();
					// Update tracked folder
					currentParentFolderPath = newParentPath;
					// Mark file as opened (after reset, since reset clears openedFiles)
					openedFiles.add(filePath);
					console.log(`Folder changed to: ${newParentPath}, re-rolling colors`);

					// Prioritize Chapter-prefixed files first for best color distribution
					await this.priorityPrecompute();
				} else {
					// No reset needed, just mark file as opened
					openedFiles.add(filePath);
				}

				// OPTION 2: Pre-process links for smooth scrolling
				// Pre-compute colors for all links in the new file before user scrolls
				// (priorityPrecompute already handles some files, but this ensures
				// the active file is always precomputed even if no re-roll occurred)
				await precomputeFileLinkColors(file, this);
			}),
		);

		// Evaluate smart mode on load if selected
		if (this.settings.hashMode === "smart") {
			evaluateSmartHashMode(this);
		}

		// Pre-compute colors for initially active file
		const initialFile = this.app.workspace.getActiveFile();
		if (initialFile) {
			currentParentFolderPath = initialFile.parent?.path ?? null;
			openedFiles.add(initialFile.path);
			await precomputeFileLinkColors(initialFile, this);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		) as LinkColorSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.app.workspace.updateOptions();
	}

	// Reset all color tracking
	resetColorState() {
		textColorMap.clear();
		colorUsageMap.clear();
		hashModeScores.clear();
		precomputedFiles.clear();
		// Note: Don't clear openedFiles - we want to remember which files
		// have been opened even after color reset, to distinguish between
		// "new files" and "switching between already-open tabs"
		isSmartModeEvaluated = false;
		activeHashMode = "strict-full";
		// Reset seed tracking to force view update on next render
		// Setting to -1 ensures next view update will detect seed change
		lastKnownSeed = -1;
		// Reset hash mode tracking to force cache invalidation
		lastKnownHashMode = null;
		console.log("Color state reset");
	}

	/**
	 * Pre-compute link colors for priority files before other open tabs.
	 * Files whose names start with the priorityFilePrefix are processed first,
	 * giving them the best color distribution from the load-balancing algorithm.
	 * Within priority files, links with more occurrences are processed first,
	 * so the most frequent links claim the most distinct colors.
	 */
	async priorityPrecompute() {
		const prefix = this.settings.priorityFilePrefix?.trim();
		if (!prefix) return;

		const priorityFiles: TFile[] = [];
		const otherFiles: TFile[] = [];

		// Collect all open markdown files, splitting into priority and other
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const file = leaf.view.file;
				if (file) {
					const basename = file.basename;
					if (basename.startsWith(prefix)) {
						priorityFiles.push(file);
					} else {
						otherFiles.push(file);
					}
				}
			}
		});

		// Pre-compute priority files first with frequency-based ordering,
		// so links that appear most often get the most distinct colors
		for (const file of priorityFiles) {
			await precomputeFileLinkColorsByFrequency(file, this);
		}
		for (const file of otherFiles) {
			await precomputeFileLinkColors(file, this);
		}
	}

	// Force all open markdown views to re-render their decorations
	async forceViewUpdate() {
		// Pre-compute priority files first so they get the best color distribution
		await this.priorityPrecompute();

		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				// Get the CodeMirror EditorView from the MarkdownView
				// @ts-expect-error - editor.cm is internal but available
				const view = leaf.view.editor?.cm as EditorView | undefined;
				if (view) {
					view.dispatch({});
				}
			}
		});
	}
}

function createLinkColorExtension(plugin: LinkColorPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				// Check if the seed changed (settings were updated)
				const currentSeed = plugin.settings.customSeed;
				const seedChanged = lastKnownSeed !== currentSeed;
				// Check if hash mode changed (requires cache invalidation)
				const currentHashMode = plugin.settings.hashMode;
				const hashModeChanged = lastKnownHashMode !== currentHashMode;
				
				// Clear cache when hash mode changes to ensure colors update immediately
				if (hashModeChanged) {
					textColorMap.clear();
					colorUsageMap.clear();
				}
				
				if (update.docChanged || update.viewportChanged || seedChanged || hashModeChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
				
				// Update the tracked values after processing
				lastKnownSeed = currentSeed;
				lastKnownHashMode = currentHashMode;
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const isDarkMode = document.body.classList.contains("theme-dark");

				let inLink = false;
				let isEmbed = false;
				let hasPipe = false;
				let targetTextBuffer = "";
				let targetColor = "";

				for (const { from, to } of view.visibleRanges) {
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node) => {
							const type = node.type.name;
							const text = view.state.sliceDoc(node.from, node.to);

							// 1. Detect Link Start
							if (type.includes("formatting-link-start")) {
								const charBefore =
									node.from > 0
										? view.state.sliceDoc(node.from - 1, node.from)
										: "";

								// This covers cases where "![[" is parsed as a single token.
								isEmbed = charBefore === "!" || text.startsWith("!");

								inLink = true;
								hasPipe = false;
								targetTextBuffer = "";
								targetColor = "";
								return;
							}

							// 2. Detect Link End
							// token type is unexpected (e.g., inside an embed block).
							if (type.includes("formatting-link-end") || text === "]]") {
								inLink = false;
								isEmbed = false;
								return;
							}

							if (inLink && !isEmbed) {
								// 3. Runaway Safety
								// If we hit a newline while in a link, assume the link was malformed or
								// we missed the end token. This prevents coloring the rest of the document.
								if (text.includes("\n")) {
									inLink = false;
									return;
								}

								if (text === "|" || type.includes("formatting-link-pipe")) {
									hasPipe = true;
									targetColor = getColor(
										targetTextBuffer,
										plugin.settings,
										isDarkMode,
									);
									return;
								}

								if (!type.includes("formatting")) {
									if (!hasPipe) {
										targetTextBuffer += text;
										const dynColor = getColor(
											targetTextBuffer,
											plugin.settings,
											isDarkMode,
										);
										builder.add(
											node.from,
											node.to,
											Decoration.mark({
												attributes: {
													style: generateStyleString(dynColor, plugin.settings),
												},
												class: "consistent-link-target",
											}),
										);
									} else {
										if (targetColor) {
											builder.add(
												node.from,
												node.to,
												Decoration.mark({
													attributes: {
														style: generateStyleString(
															targetColor,
															plugin.settings,
														),
													},
													class: "consistent-link-alias",
												}),
											);
										}
									}
								}
							}
						},
					});
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}

/**
 * Get color using a specific hash mode (used by smart mode evaluation)
 */
function getColorWithHashMode(
	text: string,
	mode: HashMode,
	settings: LinkColorSettings,
	isDarkMode: boolean,
	useCache: boolean = true,
): string {
	// 1. Clean Prefix
	if (settings.ignorePrefix && text.includes(" - ")) {
		const parts = text.split(" - ");
		const namePart = parts[parts.length - 1];
		if (namePart) text = namePart.trim();
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();
	const seed = settings.customSeed;

	// 3. Check Cache (if enabled)
	if (useCache) {
		const rangeKey = isDarkMode
			? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
			: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
		const textKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${rangeKey}-${mode}-${cleaned}`;
		if (textColorMap.has(textKey)) {
			return textColorMap.get(textKey)!;
		}
	}

	// 4. Generate Hash based on specific mode
	let hash: number;
	switch (mode) {
		case "strict-full":
			hash = hashStrictFull(cleaned, seed);
			break;
		case "strict-acronym":
			hash = hashStrictAcronym(cleaned, seed);
			break;
		case "strict-first-last":
			hash = hashStrictFirstLast(cleaned, seed);
			break;
		case "strict-first-two-last-two":
			hash = hashStrictFirstTwoLastTwo(cleaned, seed);
			break;
		case "vowel-consonant":
			hash = hashVowelConsonant(cleaned, seed);
			break;
		case "position-weighted":
			hash = hashPositionWeighted(cleaned, seed);
			break;
		case "word-boundary-ngrams":
			hash = hashWordBoundaryNgrams(cleaned, seed);
			break;
		case "length-middle":
			hash = hashLengthMiddle(cleaned, seed);
			break;
		case "similarity":
			hash = hashSimilarity(cleaned, seed);
			break;
		case "phonetic-ipa":
			hash = hashPhoneticIpa(cleaned, seed);
			break;
		default:
			hash = hashStrictFull(cleaned, seed);
	}

	// 5. Select Palette
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	// Load Balancing: find least used color(s), then random tiebreaker among ties
	let bestIndex = -1;
	let minUsage = Number.MAX_SAFE_INTEGER;
	const candidatesColorWith: number[] = []; // indices tied at minUsage
	const startOffset = hash % paletteSize;

	for (let i = 0; i < paletteSize; i++) {
		const idx = (startOffset + i) % paletteSize;
		const key = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${idx}`;
		const usage = colorUsageMap.get(key) || 0;

		if (usage < minUsage) {
			minUsage = usage;
			candidatesColorWith.length = 0;
			candidatesColorWith.push(idx);
		} else if (usage === minUsage) {
			candidatesColorWith.push(idx);
		}
	}

	// Random tiebreaker among equally-used colors (prevents deterministic convergence)
	if (candidatesColorWith.length === 1) {
		bestIndex = candidatesColorWith[0]!;
	} else {
		bestIndex = candidatesColorWith[Math.abs(hash) % candidatesColorWith.length]!;
	}

	// Register Usage
	const selectedKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = colorUsageMap.get(selectedKey) || 0;
	colorUsageMap.set(selectedKey, currentUsageCount + 1);

	// Normalize usage counts when they grow too large
	normalizeColorUsage(settings.palette, isDarkMode, seed, paletteSize);

	const baseColor = colorList[bestIndex]!;

	// Apply Variant
	const variantSeed = djb2Hash(cleaned + "|v", seed);
	const finalColor = applyAggressiveVariant(
		baseColor,
		variantSeed,
		currentUsageCount,
		isDarkMode,
		settings,
	);

	// Cache result
	if (useCache) {
		const rangeKey = isDarkMode
			? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
			: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
		const textKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${rangeKey}-${mode}-${cleaned}`;
		textColorMap.set(textKey, finalColor);
	}

	return finalColor;
}

function getColor(
	text: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
): string {
	// Handle special modes first
	if (settings.hashMode === "random") {
		return getRandomColor(text, settings, isDarkMode);
	}

	if (settings.hashMode === "smart") {
		// Smart mode uses the pre-selected hash mode from evaluation
		return getColorWithHashMode(text, activeHashMode, settings, isDarkMode);
	}

	// Regular hash modes
	// 1. Clean Prefix
	if (settings.ignorePrefix && text.includes(" - ")) {
		const parts = text.split(" - ");
		const namePart = parts[parts.length - 1];
		if (namePart) text = namePart.trim();
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();

	// 4. Generate Hashes
	const seed = settings.customSeed; // <--- GET SEED FROM SETTINGS

	// 3. Check Cache (must include hashMode, seed and range settings so changing them invalidates cache)
	const rangeKey = isDarkMode
		? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
		: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
	const textKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${rangeKey}-${settings.hashMode}-${cleaned}`;
	if (textColorMap.has(textKey)) {
		return textColorMap.get(textKey)!;
	}
	let hash: number;

	switch (settings.hashMode) {
		case "strict-full":
			hash = hashStrictFull(cleaned, seed);
			break;
		case "strict-acronym":
			hash = hashStrictAcronym(cleaned, seed);
			break;
		case "strict-first-last":
			hash = hashStrictFirstLast(cleaned, seed);
			break;
		case "strict-first-two-last-two":
			hash = hashStrictFirstTwoLastTwo(cleaned, seed);
			break;
		case "vowel-consonant":
			hash = hashVowelConsonant(cleaned, seed);
			break;
		case "position-weighted":
			hash = hashPositionWeighted(cleaned, seed);
			break;
		case "word-boundary-ngrams":
			hash = hashWordBoundaryNgrams(cleaned, seed);
			break;
		case "length-middle":
			hash = hashLengthMiddle(cleaned, seed);
			break;
		case "similarity":
			hash = hashSimilarity(cleaned, seed);
			break;
		case "phonetic-ipa":
			hash = hashPhoneticIpa(cleaned, seed);
			break;
		default:
			hash = hashStrictFull(cleaned, seed);
	}

	// 5. Select Palette
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	// --- FIX 1: GLOBAL LOAD BALANCING ---
	// Instead of checking 3 spots, scan the WHOLE palette to find the least used color(s).
	// When there's a tie, use hash-based random tiebreaker to prevent deterministic convergence.

	let bestIndex = -1;
	let minUsage = Number.MAX_SAFE_INTEGER;
	const candidatesGetColor: number[] = []; // indices tied at minUsage

	// We create a randomized start point based on hash so we don't always fill index 0 first
	const startOffset = hash % paletteSize;

	for (let i = 0; i < paletteSize; i++) {
		// Wrap around array
		const idx = (startOffset + i) % paletteSize;
		const key = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${idx}`;
		const usage = colorUsageMap.get(key) || 0;

		if (usage < minUsage) {
			minUsage = usage;
			candidatesGetColor.length = 0;
			candidatesGetColor.push(idx);
		} else if (usage === minUsage) {
			candidatesGetColor.push(idx);
		}
	}

	// Hash-based tiebreaker among equally-used colors (prevents deterministic convergence)
	if (candidatesGetColor.length === 1) {
		bestIndex = candidatesGetColor[0]!;
	} else {
		bestIndex = candidatesGetColor[Math.abs(hash) % candidatesGetColor.length]!;
	}

	// 6. Register Usage
	const selectedKey = `${settings.palette}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = colorUsageMap.get(selectedKey) || 0;
	colorUsageMap.set(selectedKey, currentUsageCount + 1);

	// Normalize usage counts when they grow too large (prevents convergence)
	normalizeColorUsage(settings.palette, isDarkMode, seed, paletteSize);

	const baseColor = colorList[bestIndex]!;

	// 7. Variant Seed
	const variantSeed = djb2Hash(cleaned + "|v", seed);

	// 8. Apply Aggressive Variant
	// We pass 'currentUsageCount' to force distinctness when a color is reused
	const finalColor = applyAggressiveVariant(
		baseColor,
		variantSeed,
		currentUsageCount,
		isDarkMode,
		settings,
	);

	textColorMap.set(textKey, finalColor);
	return finalColor;
}

function applyAggressiveVariant(
	baseColor: string,
	variantSeed: number,
	usageCount: number,
	isDarkMode: boolean,
	settings: LinkColorSettings,
): string {
	const hex = baseColor.replace("#", "");
	const r = parseInt(hex.substring(0, 2), 16);
	const g = parseInt(hex.substring(2, 4), 16);
	const b = parseInt(hex.substring(4, 6), 16);
	const hsl = rgbToHsl(r, g, b);

	// Seed Random generator
	const rand = (n: number) =>
		Math.abs(((variantSeed >> n) ^ (variantSeed << (n % 13))) & 0xffff) /
		0xffff;

	// --- FIX 2: USAGE BASED SPREAD ---
	// If this is the 1st time using this base color: almost no shift.
	// 2nd time: shift Left. 3rd time: shift Right. 4th: shift Left more.
	// This creates a "fan" effect around the base color.
	// Cap usageCount to prevent extreme shifts when many links share palette slots
	const cappedUsageCount = Math.min(usageCount, 6);
	const spreadDirection = cappedUsageCount % 2 === 0 ? 1 : -1;
	const spreadMagnitude = Math.ceil(cappedUsageCount / 2) * 15; // 15, 30, 45 degree jumps per usage

	// Random noise (kept smaller to preserve the "Base" color identity slightly)
	const randomHueNoise = (rand(3) - 0.5) * 20; // +/- 10 degrees random wobble

	// Total Hue Shift
	// We limit spreadMagnitude to ~60 to prevent complete color crossovers (e.g. Red becoming Blue)
	const effectiveSpread = Math.min(spreadMagnitude, 60) * spreadDirection;
	hsl.h = (hsl.h + effectiveSpread + randomHueNoise + 360) % 360;

	// --- FIX 3: SATURATION/LIGHTNESS VARIANCE ---
	// Dark mode: softer, less saturated colors for reduced eye strain
	// Light mode: higher saturation works well against light backgrounds

	// Saturation: Mode-specific ranges from settings
	if (isDarkMode) {
		const satRange = settings.darkSaturationMax - settings.darkSaturationMin;
		const satNoise = (rand(5) - 0.5) * (satRange * 0.3); // 30% of range as noise
		hsl.s = Math.max(
			settings.darkSaturationMin,
			Math.min(settings.darkSaturationMax, hsl.s + satNoise),
		);
	} else {
		const satRange = settings.lightSaturationMax - settings.lightSaturationMin;
		const satNoise = (rand(5) - 0.5) * (satRange * 0.3);
		hsl.s = Math.max(
			settings.lightSaturationMin,
			Math.min(settings.lightSaturationMax, hsl.s + satNoise),
		);
	}

	// Lightness: Mode-specific ranges from settings
	if (isDarkMode) {
		const lightRange = settings.darkLightnessMax - settings.darkLightnessMin;
		const lightTarget =
			(settings.darkLightnessMin + settings.darkLightnessMax) / 2;
		const lightNoise = (rand(7) - 0.5) * (lightRange * 0.2); // 20% of range as noise
		hsl.l = Math.max(
			settings.darkLightnessMin,
			Math.min(settings.darkLightnessMax, lightTarget + lightNoise),
		);
	} else {
		const lightRange = settings.lightLightnessMax - settings.lightLightnessMin;
		const lightTarget =
			(settings.lightLightnessMin + settings.lightLightnessMax) / 2;
		const lightNoise = (rand(7) - 0.5) * (lightRange * 0.3);
		hsl.l = Math.max(
			settings.lightLightnessMin,
			Math.min(settings.lightLightnessMax, lightTarget + lightNoise),
		);
	}

	const out = hslToRgb(hsl.h, hsl.s, hsl.l);
	return rgbToHex(out.r, out.g, out.b);
}

/**
 * Convert RGB to HSL color space
 */
function rgbToHsl(
	r: number,
	g: number,
	b: number,
): { h: number; s: number; l: number } {
	r /= 255;
	g /= 255;
	b /= 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
				break;
			case g:
				h = ((b - r) / d + 2) / 6;
				break;
			case b:
				h = ((r - g) / d + 4) / 6;
				break;
		}
	}

	return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL to RGB color space
 */
function hslToRgb(
	h: number,
	s: number,
	l: number,
): { r: number; g: number; b: number } {
	h = h / 360;
	s = s / 100;
	l = l / 100;

	let r: number, g: number, b: number;

	if (s === 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return {
		r: Math.round(r * 255),
		g: Math.round(g * 255),
		b: Math.round(b * 255),
	};
}

/**
 * Convert RGB values to hex color string
 */
function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) => {
		const hex = n.toString(16);
		return hex.length === 1 ? "0" + hex : hex;
	};
	return "#" + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Strict Full Hash: Maximum uniqueness using acronyms, full text, and length.
 * Example: "Data Science" -> "ds" + "data science" + "12"
 */
function hashStrictFull(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const acronyms = words.map((word) => word.charAt(0)).join("");
	const str = acronyms + text + text.length.toString();
	return djb2Hash(str, seed);
}

/**
 * Strict Acronym Hash: Uses only first letters of words.
 * Similar structure words may share colors.
 * Example: "Data Science" -> "ds", "Design System" -> "ds" (same color)
 */
function hashStrictAcronym(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const acronyms = words.map((word) => word.charAt(0)).join("");
	return djb2Hash(acronyms, seed);
}

/**
 * Strict First-Last Hash: Uses the first and last letters of every word.
 * Example: "Data Science" -> "D" + "a" + "S" + "e" -> "DaSe"
 */
function hashStrictFirstLast(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const signature = words
		.map((word) => {
			if (word.length === 0) return "";
			if (word.length === 1) return word + word;
			return word.charAt(0) + word.charAt(word.length - 1);
		})
		.join("");
	return djb2Hash(signature, seed);
}

/**
 * Strict First-Two-Last-Two Hash: Uses first 2 and last 2 characters of each word.
 * Provides better discrimination than first-last alone.
 * Example: "Data Science" -> "Da" + "ta" + "Sc" + "ce" -> "DataScce"
 */
function hashStrictFirstTwoLastTwo(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const signature = words
		.map((word) => {
			if (word.length === 0) return "";
			if (word.length === 1) return word + word + word + word;
			if (word.length === 2) return word + word;
			if (word.length === 3) return word.substring(0, 2) + word.substring(1);
			const firstTwo = word.substring(0, 2);
			const lastTwo = word.substring(word.length - 2);
			return firstTwo + lastTwo;
		})
		.join("");
	return djb2Hash(signature, seed);
}

/**
 * Vowel-Consonant Pattern Hash: Creates a pattern based on vowel/consonant positions.
 * Each character is mapped to 'V' (vowel) or 'C' (consonant), creating a unique pattern.
 * Example: "Data" -> "CVCV", "Science" -> "CCVCCV"
 */
function hashVowelConsonant(text: string, seed: number): number {
	const vowels = new Set(["a", "e", "i", "o", "u"]);
	const words = text.split(/\s+/).filter(Boolean);
	const pattern = words
		.map((word) => {
			return Array.from(word)
				.map((char) => (vowels.has(char) ? "V" : "C"))
				.join("");
		})
		.join("|");
	// Also include word lengths for extra discrimination
	const lengthInfo = words.map((w) => w.length.toString()).join(",");
	return djb2Hash(pattern + ":" + lengthInfo, seed);
}

/**
 * Position-Weighted Hash: Characters are weighted by their position in the word.
 * Edge characters (first/last) have higher weight, middle characters have lower weight.
 * This creates better discrimination for words with similar starts/ends but different middles.
 * Example: "Data" -> weighted sum of 'D'(4) + 'a'(1) + 't'(1) + 'a'(4)
 */
function hashPositionWeighted(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	let weightedSum = 0;

	for (const word of words) {
		const len = word.length;
		if (len === 0) continue;

		for (let i = 0; i < len; i++) {
			// Weight: edges get weight 4, middle gets weight 1
			// Distance from edge: min(i, len - 1 - i)
			const distFromEdge = Math.min(i, len - 1 - i);
			const weight = distFromEdge === 0 ? 4 : distFromEdge === 1 ? 2 : 1;
			weightedSum += word.charCodeAt(i) * weight;
		}
		// Add word length as separator
		weightedSum += len * 1000;
	}

	// Combine with seed and hash
	return djb2Hash(weightedSum.toString() + text, seed);
}

/**
 * Word Boundary N-grams Hash: Uses trigrams (3-character sequences) that respect word boundaries.
 * Only creates n-grams within words, not across word boundaries.
 * This provides better discrimination while maintaining word identity.
 * Example: "Data Science" -> ["Dat", "ata"] + ["Sci", "cie", "ien", "enc", "nce"]
 */
function hashWordBoundaryNgrams(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const trigrams: string[] = [];

	for (const word of words) {
		if (word.length < 3) {
			// For short words, just use the word itself
			trigrams.push(word);
		} else {
			// Extract all trigrams from this word
			for (let i = 0; i <= word.length - 3; i++) {
				trigrams.push(word.substring(i, i + 3));
			}
		}
	}

	if (trigrams.length === 0) return djb2Hash(text, seed);

	// Hash all trigrams together with word count for extra discrimination
	const signature = trigrams.join("|") + ":" + words.length.toString();
	return djb2Hash(signature, seed);
}

/**
 * Length + Middle Hash: Combines word length with middle characters.
 * For each word, takes: length + first char + middle char(s) + last char.
 * This provides excellent discrimination while being compact.
 * Example: "Data" (len=4) -> "4Dta", "Science" (len=7) -> "7Scee"
 */
function hashLengthMiddle(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const signature = words
		.map((word) => {
			const len = word.length;
			if (len === 0) return "0";
			if (len === 1) return "1" + word + word;
			if (len === 2) return "2" + word;

			const first = word.charAt(0);
			const last = word.charAt(len - 1);

			// Get middle character(s)
			let middle: string;
			if (len === 3) {
				middle = word.charAt(1);
			} else if (len % 2 === 0) {
				// Even length: take two middle chars
				const mid = len / 2;
				middle = word.substring(mid - 1, mid + 1);
			} else {
				// Odd length: take center char
				const mid = Math.floor(len / 2);
				middle = word.charAt(mid);
			}

			return len.toString() + first + middle + last;
		})
		.join("");

	return djb2Hash(signature, seed);
}

/**
 * Similarity Hash: Similar words get similar colors using Levenshtein distance.
 * Words with small edit distances map to nearby color indices.
 *
 * Strategy: Use character n-grams (bigrams) to create a similarity-based hash.
 * Words sharing many bigrams will hash to nearby values, ensuring similar words
 * get similar colors.
 */
function hashSimilarity(text: string, seed: number): number {
	const bigrams = extractBigrams(text);
	if (bigrams.length === 0) return djb2Hash(text, seed);

	let hash = seed; // Use the seed
	for (const bigram of bigrams) {
		hash = (hash << 5) + hash + bigram.charCodeAt(0);
		hash = (hash << 5) + hash + bigram.charCodeAt(1);
		hash = hash & hash;
	}
	return Math.abs(hash);
}

/**
 * Extract bigrams (2-character sequences) from text.
 * Example: "apple" -> ["ap", "pp", "pl", "le"]
 */
function extractBigrams(text: string): string[] {
	const bigrams: string[] = [];
	for (let i = 0; i < text.length - 1; i++) {
		bigrams.push(text.substring(i, i + 2));
	}
	return bigrams;
}

/**
 * DJB2 Hash Function: A widely used non-cryptographic hash function.
 * Known for excellent distribution and speed.
 */
function djb2Hash(str: string, seed: number = 5381): number {
	let hash = seed; // Use the passed seed instead of hardcoded 5381
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) + hash + str.charCodeAt(i);
		hash = hash & hash;
	}
	return Math.abs(hash);
}

function generateStyleString(color: string, settings: LinkColorSettings) {
	return `
        color: ${color} !important;
        -webkit-text-fill-color: ${color} !important;
        --link-color: ${color} !important;
        --link-external-color: ${color} !important;
    `;
}
