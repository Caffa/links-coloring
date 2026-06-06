import { syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { type App, Plugin, type TFile, type Vault, MarkdownView, Modal, Notice } from "obsidian";
import { hashPhoneticIpa } from "./phonetic";
import {
	type ColorVariantSettings,
	type ColorUsageMap,
	COLOR_USAGE_NORMALIZE_THRESHOLD,
	applyAggressiveVariant,
	buildCacheKey,
	djb2Hash,
	hashLengthMiddle,
	hashPositionWeighted,
	hashSimilarity,
	hashStrictAcronym,
	hashStrictFirstLast,
	hashStrictFirstTwoLastTwo,
	hashStrictFull,
	hashVowelConsonant,
	hashWordBoundaryNgrams,
	normalizeColorUsage,
	selectPaletteIndexWithLoadBalancing,
	stripPrefix,
} from "./color-utils";
import {
	DEFAULT_SETTINGS,
	HASH_MODE_DESCRIPTIONS,
	type HashMode,
	type LinkColorSettings,
	LinkColorSettingTab,
	PALETTES,
} from "./settings";
import { log, type LogCategory, type LogEntry } from "./logger";

// --- Reading view DOM coloring ---

/**
 * Apply link colors to all internal links in a DOM element (reading view, Dataview tables, etc.).
 * Targets both <a class="internal-link"> elements and <span class="cm-hmd-internal-link"> in rendered content.
 * Works on both desktop and mobile Obsidian.
 */
function colorLinksInElement(el: HTMLElement, settings: LinkColorSettings): void {
	const isDarkMode = document.body.classList.contains("theme-dark");
	const isMobile = document.body.classList.contains("is-mobile");

	// Target internal links in reading view / Dataview tables
	// Dataview uses <a> with data-href or href pointing to internal pages
	//
	// Mobile note: Obsidian mobile uses the same DOM structure for internal links,
	// but may have additional wrapper classes. The core selectors still work.
	const internalLinks = Array.from(
		el.querySelectorAll<HTMLAnchorElement>(
			'a.internal-link, a[data-href], a.is-unresolved, a.internal-link-link',
		),
	);

	log.debug("render", "colorLinksInElement — scanning DOM", {
		internalLinks: internalLinks.length,
		isDarkMode,
		isMobile,
		elTag: el.tagName,
		elClass: el.className.slice(0, 80),
	});

	for (const link of internalLinks) {
		// Get the link target: prefer data-href (Obsidian's internal link target),
		// then href attribute, then fall back to text content
		const target =
			link.getAttribute("data-href") ||
			link.getAttribute("href") ||
			link.textContent ||
			"";
		if (!target) continue;

		// Decode the target (may be URL-encoded)
		const decodedTarget = decodeURIComponent(target);

		// Get the color for this link
		const color = getColor(decodedTarget, settings, isDarkMode);

		// Apply color using style.setProperty for maximum compatibility.
		// On mobile WebKit, setAttribute("style", ...) can sometimes conflict
		// with existing theme styles or fail to override properly, while
		// style.setProperty with "important" priority is more reliable.
		link.style.setProperty("color", color, "important");
		link.style.setProperty("-webkit-text-fill-color", color, "important");
		link.style.setProperty("--link-color", color, "important");
		link.style.setProperty("--link-external-color", color, "important");
	}
}

/**
 * Watch a container element for changes (Dataview re-renders, etc.) and re-apply link colors.
 * Returns the observer so it can be disconnected later.
 */
function observeLinksInContainer(
	container: HTMLElement,
	_plugin: LinkColorPlugin,
): MutationObserver {
	// Bug 8 fix: Initial coloring uses plugin.settings directly (not the captured
	// parameter), ensuring the latest settings are always used even if they changed
	// between observer creation and the first mutation.
	const plugin = _plugin;
	// Initial coloring pass
	colorLinksInElement(container, plugin.settings);

	const observer = new MutationObserver((mutations) => {
		let shouldRecolor = false;
		for (const mutation of mutations) {
			if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
				shouldRecolor = true;
				break;
			}
			// Also handle attribute changes on links (Dataview may update data-href)
			if (mutation.type === "attributes") {
				const target = mutation.target as HTMLElement;
				if (target.tagName === "A" || target.closest("a.internal-link, a[data-href]")) {
					shouldRecolor = true;
					break;
				}
			}
		}
		if (shouldRecolor) {
			log.debug("mutation", "MutationObserver triggered recolor", {
				mutationCount: mutations.length,
				containerTag: container.tagName,
			});
			colorLinksInElement(container, plugin.settings);
		}
	});

	observer.observe(container, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-href", "href", "class"],
	});

	return observer;
}

// Global text-to-color mapping to ensure consistent shading per text
const textColorMap = new Map<string, string>();
// Track how many times each base color has been used (for shade generation)
const colorUsageMap: ColorUsageMap = new Map();
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
// Bug 5: Dark mode revision counter — incremented on theme switch to
// force cache invalidation so stale dark/light mode colors aren't reused
let darkModeRevision = 0;
// Mobile debouncing delay (ms) — avoid excessive recoloring on rapid mobile interactions
const MOBILE_RECOLOR_DEBOUNCE_MS = 150;

/**
 * Extract unique wiki-style links from a file (ASYNC VERSION)
 * Returns link targets (the text inside [[...]])
 * 
 * FIX: This was previously synchronous but used vault.cachedRead which returns a Promise.
 * Now properly awaits the async read operation.
 */
async function extractLinksFromFileAsync(file: TFile, vault: Vault): Promise<string[]> {
	try {
		log.time("performance", `extractLinks-${file.path}`);
		const content = await vault.cachedRead(file);
		if (!content) {
			log.debug("render", "extractLinks — empty content", { path: file.path });
			return [];
		}

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

		const deduped = [...new Set(links)]; // Deduplicate
		log.timeEnd("performance", `extractLinks-${file.path}`, `extractLinks — ${deduped.length} links`);
		return deduped;
	} catch (error) {
		log.error("error", "Failed to extract links from file", {
			path: file.path,
			error: String(error),
		});
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
		log.debug("cache", "precomputeFileLinkColors — skip (already precomputed)", {
			path: filePath,
		});
		return;
	}

	try {
		log.time("performance", `precompute-${filePath}`);
		const content = await plugin.app.vault.cachedRead(file);
		const links = extractLinksFromContent(content);
		const isDarkMode = document.body.classList.contains("theme-dark");

		log.info("render", `precomputeFileLinkColors — ${links.length} links`, {
			path: filePath,
			links: links.length,
			isDarkMode,
		});

		// Pre-compute colors for all links (populates textColorMap cache)
		for (const link of links) {
			getColor(link, plugin.settings, isDarkMode);
		}

		// Mark as precomputed
		precomputedFiles.add(filePath);
		log.timeEnd("performance", `precompute-${filePath}`, `precompute completed`);
	} catch (error) {
		log.error("error", "Failed to precompute link colors", {
			path: filePath,
			error: String(error),
		});
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
		log.error("error", "Failed to precompute link colors by frequency", {
			path: filePath,
			error: String(error),
		});
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
	// 1. Clean Prefix (Bug 4: multi-separator support)
	if (settings.ignorePrefix) {
		const stripped = stripPrefix(text);
		if (stripped !== null) text = stripped;
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();
	const seed = settings.customSeed;

	// 3. Check Cache (Bug 5: include darkModeRevision in key)
	const rangeKey = isDarkMode
		? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
		: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
	const textKey = buildCacheKey(settings.palette, isDarkMode, darkModeRevision, seed, rangeKey, "random", cleaned);
	if (textColorMap.has(textKey)) {
		log.recordCacheHit(true);
		return textColorMap.get(textKey)!;
	}
	log.recordCacheHit(false);

	// 4. Generate random hash (different from other modes)
	const hash = djb2Hash(cleaned, seed);

	// 5. Select Palette with Load Balancing (Bug 1: includes hash mode; Bug 3: improved tiebreaker)
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	const bestIndex = selectPaletteIndexWithLoadBalancing(
		colorUsageMap, hash, settings.palette, "random", isDarkMode, seed, paletteSize,
	);

	const selectedKey = `${settings.palette}-random-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = colorUsageMap.get(selectedKey) || 0;

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
		log.debug("cache", "Smart mode already evaluated", {
			activeHashMode,
		});
		return activeHashMode; // Already evaluated this session
	}

	log.info("lifecycle", "Smart mode evaluation starting");

	const isDarkMode = document.body.classList.contains("theme-dark");
	const paletteObj = PALETTES[plugin.settings.palette] ?? PALETTES["vibrant"]!;
	const palette = isDarkMode ? paletteObj.dark : paletteObj.light;
	const availableModes = Object.keys(HASH_MODE_DESCRIPTIONS) as HashMode[];

	// Collect sample links from folder context
	const sampleLinks = await collectSampleLinks(plugin.app);

	if (sampleLinks.length === 0) {
		// No links found, use default
		log.warn("lifecycle", "Smart mode — no sample links found, using default");
		activeHashMode = "strict-full";
		isSmartModeEvaluated = true;
		return activeHashMode;
	}

	console.log(`Smart mode evaluating ${sampleLinks.length} sample links...`);

	// Evaluate each hash mode using an ISOLATED usage map (Bug 2 fix:
	// prevents evaluation from polluting the global colorUsageMap)
	const scores = availableModes.map((mode) => {
		// Count how many colors each hash mode produces
		const colorCounts = new Map<string, number>();
		// Bug 2: Use an isolated usage map so evaluation doesn't affect rendering
		const evalUsageMap: ColorUsageMap = new Map();

		for (const link of sampleLinks) {
			if (mode === "random") continue; // Skip random mode in evaluation
			const color = getColorWithHashMode(
				link,
				mode,
				plugin.settings,
				isDarkMode,
				false,
				evalUsageMap, // isolated usage map
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
	// MutationObservers for reading view / Dataview link coloring (one per preview pane)
	private readingViewObservers: MutationObserver[] = [];
	// Whether the plugin is running on Obsidian Mobile
	private isMobile: boolean;
	// Debounce timer for mobile-optimized recoloring
	private recolorDebounceTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		// Initialize seed tracking from settings
		lastKnownSeed = this.settings.customSeed;
		// Initialize hash mode tracking from settings to avoid spurious cache clear on first render
		lastKnownHashMode = this.settings.hashMode;

		// --- Mobile detection ---
		this.isMobile = (this.app as any).isMobile ?? false;

		// --- Logging initialization ---
		this.applyLoggingSettings();

		// Detect platform info for logging
		const platform = this.isMobile ? "mobile" : "desktop";
		const obsidianVersion = (this.app as any).vault.adapter?.app?.version ?? "unknown";

		log.info("lifecycle", "Plugin loading", {
			version: this.manifest.version,
			isDesktopOnly: this.manifest.isDesktopOnly,
			platform,
			obsidianVersion,
			settings: {
				palette: this.settings.palette,
				hashMode: this.settings.hashMode,
				seed: this.settings.customSeed,
				rerollOnFileChange: this.settings.rerollOnFileChange,
			},
		});

		// Log mobile/viewport info
		log.info("mobile", "Platform detection", {
			platform,
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				dpr: window.devicePixelRatio,
			},
			userAgent: navigator.userAgent.slice(0, 120),
			isDarkMode: document.body.classList.contains("theme-dark"),
		});

		log.setSettings({
			enabled: this.settings.loggingEnabled,
		});
		// Update logger metadata
		log.setMetadata({
			pluginVersion: this.manifest.version,
			platform,
			userAgent: navigator.userAgent,
			obsidianVersion: String(obsidianVersion),
			viewport: {
				width: window.innerWidth,
				height: window.innerHeight,
				dpr: window.devicePixelRatio,
			},
			settings: this.settings as unknown as Record<string, unknown>,
			isMobile: this.isMobile,
		});

		this.addSettingTab(new LinkColorSettingTab(this.app, this));
		this.editorExtension = createLinkColorExtension(this);
		this.registerEditorExtension(this.editorExtension);

		// --- Reading view link coloring (covers Dataview tables too) ---
		// Use MarkdownPostProcessor for initial rendering of each section
		this.registerMarkdownPostProcessor((el) => {
			colorLinksInElement(el, this.settings);
		});

		// Also observe the active preview panes for dynamic updates (Dataview, etc.)
		this.setupReadingViewObservers();

		// Re-observe when layout changes (new panes opened, etc.)
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.setupReadingViewObservers();
				// On mobile, layout changes can also mean the view switched
				// between source and reading mode — recolor to catch any new content
				if (this.isMobile) {
					this.recolorAllReadingViews();
				}
			}),
		);

		// On mobile, also handle window resize (orientation change, keyboard toggle)
		// Re-observe and recolor since the layout may have changed
		if (this.isMobile) {
			this.registerDomEvent(window, "resize", () => {
				// Debounce resize events
				if (this.recolorDebounceTimer !== null) {
					window.clearTimeout(this.recolorDebounceTimer);
				}
				this.recolorDebounceTimer = window.setTimeout(() => {
					this.setupReadingViewObservers();
					this.recolorAllReadingViews();
					this.recolorDebounceTimer = null;
				}, MOBILE_RECOLOR_DEBOUNCE_MS);
			});
		}

		// Re-color reading view links when active leaf changes (new file opened)
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				log.debug("lifecycle", "active-leaf-change — recoloring reading views");
				// On mobile, use debouncing to avoid excessive recoloring during
				// rapid navigation (swipe gestures, etc.)
				const delay = this.isMobile ? MOBILE_RECOLOR_DEBOUNCE_MS : 100;
				if (this.recolorDebounceTimer !== null) {
					window.clearTimeout(this.recolorDebounceTimer);
				}
				this.recolorDebounceTimer = window.setTimeout(() => {
					this.recolorAllReadingViews();
					this.recolorDebounceTimer = null;
				}, delay);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				log.info("lifecycle", "css-change — theme switched, recomputing colors");
				// Bug 5: Increment dark mode revision to invalidate color cache
				darkModeRevision++;
				// Clear caches so colors are recalculated with the new theme
				textColorMap.clear();
				// Clear precomputed files so they'll be recomputed with new theme colors
				precomputedFiles.clear();
				// Precompute colors for the current active file with new theme
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					precomputeFileLinkColors(activeFile, this);
				}
				this.app.workspace.updateOptions();
				// Re-color reading view links with new theme
				this.recolorAllReadingViews();
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
					log.info("lifecycle", "Folder changed — re-rolling colors", {
						newParentPath,
						newSeed,
						filePath,
					});

					// Prioritize Chapter-prefixed files first for best color distribution
					await this.priorityPrecompute();
				} else {
					// No reset needed, just mark file as opened
					openedFiles.add(filePath);
				}

				// Bug fix: Always update currentParentFolderPath, not just on re-roll.
				// This ensures folder tracking stays accurate even when rerollOnFileChange is false.
				// When disabled, we still need to track where we are so that if the user later
				// enables rerollOnFileChange, it will correctly detect folder changes.
				if (currentParentFolderPath !== newParentPath) {
					currentParentFolderPath = newParentPath;
					log.debug("lifecycle", "Updated folder tracking", {
						currentParentFolderPath,
						filePath,
					});
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

		// --- Commands ---
		this.addCommand({
			id: "open-log-viewer",
			name: "Open debug log viewer",
			callback: () => {
				this.openLogViewer();
			},
		});

		this.addCommand({
			id: "export-logs",
			name: "Export debug logs to file",
			callback: () => {
				this.exportLogsToFile();
			},
		});

		this.addCommand({
			id: "copy-logs",
			name: "Copy debug logs to clipboard",
			callback: () => {
				this.copyLogsToClipboard();
			},
		});

		// Pre-compute colors for initially active file
		const initialFile = this.app.workspace.getActiveFile();
		if (initialFile) {
			currentParentFolderPath = initialFile.parent?.path ?? null;
			openedFiles.add(initialFile.path);
			await precomputeFileLinkColors(initialFile, this);
		}
	}

	onunload() {
		// Disconnect all MutationObservers
		this.disconnectReadingViewObservers();
		// Clear any pending debounce timers
		if (this.recolorDebounceTimer !== null) {
			window.clearTimeout(this.recolorDebounceTimer);
			this.recolorDebounceTimer = null;
		}
		// Bug 9: Clear all module-level state on unload to prevent stale
		// data from persisting across hot-reloads
		textColorMap.clear();
		colorUsageMap.clear();
		hashModeScores.clear();
		precomputedFiles.clear();
		openedFiles.clear();
		currentParentFolderPath = null;
		lastKnownSeed = -1;
		lastKnownHashMode = null;
		darkModeRevision = 0;
		isSmartModeEvaluated = false;
		activeHashMode = "strict-full";
		log.info("lifecycle", "Plugin unloaded");
	}

	/**
	 * Set up MutationObservers on all markdown preview panes.
	 * This covers reading view and Dataview tables that render dynamically.
	 * On mobile, the layout is single-pane — we still query MarkdownView
	 * leaves the same way, but there's typically only one leaf.
	 */
	private setupReadingViewObservers() {
		// Disconnect existing observers first to avoid duplicates
		this.disconnectReadingViewObservers();

		// Find all markdown preview view containers
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				// The preview container is available via view.containerEl
				const previewEl = leaf.view.containerEl.querySelector(
					".markdown-preview-view",
				);
				if (previewEl) {
					const observer = observeLinksInContainer(
						previewEl as HTMLElement,
						this,
					);
					this.readingViewObservers.push(observer);
				}

				// Also observe the source mode container for Live Preview
				// On mobile, this is the primary view mode
				const sourceEl = leaf.view.containerEl.querySelector(
					".markdown-source-view",
				);
				if (sourceEl) {
					const observer = observeLinksInContainer(
						sourceEl as HTMLElement,
						this,
					);
					this.readingViewObservers.push(observer);
				}

				// On mobile in reading mode, also observe the entire view container
				// as mobile may render content differently than desktop
				if (this.isMobile) {
					const contentEl = leaf.view.containerEl.querySelector(
						".markdown-reading-view",
					);
					if (contentEl) {
						const observer = observeLinksInContainer(
							contentEl as HTMLElement,
							this,
						);
						this.readingViewObservers.push(observer);
					}
				}
			}
		});
	}

	/**
	 * Disconnect all active MutationObservers for reading view.
	 */
	private disconnectReadingViewObservers() {
		for (const observer of this.readingViewObservers) {
			observer.disconnect();
		}
		this.readingViewObservers = [];
	}

	/**
	 * Re-apply colors to all reading view link elements.
	 * Called when settings change, theme changes, or active file changes.
	 * On mobile, includes additional selectors for mobile-specific rendering.
	 */
	private recolorAllReadingViews() {
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const previewEl = leaf.view.containerEl.querySelector(
					".markdown-preview-view",
				);
				if (previewEl) {
					colorLinksInElement(previewEl as HTMLElement, this.settings);
				}
				const sourceEl = leaf.view.containerEl.querySelector(
					".markdown-source-view",
				);
				if (sourceEl) {
					colorLinksInElement(sourceEl as HTMLElement, this.settings);
				}

				// Mobile-specific: also recolor the reading view container
				if (this.isMobile) {
					const readingEl = leaf.view.containerEl.querySelector(
						".markdown-reading-view",
					);
					if (readingEl) {
						colorLinksInElement(readingEl as HTMLElement, this.settings);
					}
				}
			}
		});
	}

	async loadSettings() {
		const loaded = (await this.loadData()) as Partial<LinkColorSettings> ?? {};
		// Bug 11: Remove stale keys from older versions of the plugin
		const staleKeys = ["saturation", "lightness"] as const;
		for (const key of staleKeys) {
			if (key in loaded) {
				delete (loaded as any)[key];
			}
		}
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loaded,
		) as LinkColorSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.app.workspace.updateOptions();
		log.debug("settings", "Settings saved", {
			palette: this.settings.palette,
			hashMode: this.settings.hashMode,
			seed: this.settings.customSeed,
		});
		// Re-color reading view links when settings change
		this.recolorAllReadingViews();
	}

	// Reset all color tracking
	resetColorState() {
		const previousSize = textColorMap.size;
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
		// Reset hash mode tracking to force cache invalidations
		lastKnownHashMode = null;
		log.info("cache", "Color state reset", {
			previousCacheSize: previousSize,
			precomputedFilesCleared: true,
		});
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

		// Force CodeMirror editors to re-render decorations.
		// On desktop, we can dispatch an empty transaction to trigger a re-render.
		// On mobile, the editor may not expose .cm directly, so we use
		// workspace.updateOptions() which triggers a full state update.
		if (!this.isMobile) {
			this.app.workspace.iterateRootLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView) {
					// @ts-expect-error - editor.cm is internal but available on desktop
					const view = leaf.view.editor?.cm as EditorView | undefined;
					if (view) {
						view.dispatch({});
					}
				}
			});
		}

		// This is the safe, cross-platform way to trigger a re-render
		// of the CodeMirror extensions. Works on both desktop and mobile.
		this.app.workspace.updateOptions();

		// Re-color reading view links
		this.recolorAllReadingViews();

		// Re-setup observers in case dynamic content changed
		this.setupReadingViewObservers();
	}

	// --- Logging helpers ---

	/** Sync logger settings from plugin settings */
	applyLoggingSettings() {
		log.setSettings({
			enabled: this.settings.loggingEnabled,
			maxEntries: this.settings.logMaxEntries,
			minLevel: this.settings.logLevel,
			categories: this.settings.logCategories,
		});
	}

	/** Get current logger stats for display */
	getLoggerStats() {
		return log.getStats();
	}

	/** Clear all in-memory logs */
	clearLogs() {
		log.clear();
	}

	/** Open the log viewer modal */
	openLogViewer() {
		new LogViewerModal(this.app, log.getEntries(), log.getStats()).open();
	}

	/** Export logs as JSON file to the vault */
	async exportLogsToFile() {
		const exportData = log.export();
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `link-colorer-logs-${timestamp}.json`;
		try {
			await this.app.vault.create(
				filename,
				JSON.stringify(exportData, null, 2),
			);
			log.info("lifecycle", `Logs exported to ${filename}`);
			new Notice(`Logs exported to ${filename}`);
		} catch (err) {
			log.error("error", "Failed to export logs", {
				error: String(err),
			});
			new Notice("Failed to export logs");
		}
	}

	/** Copy logs as JSON to clipboard */
	async copyLogsToClipboard() {
		const exportData = log.export();
		const json = JSON.stringify(exportData, null, 2);
		try {
			// On mobile, navigator.clipboard.writeText may not be available
			// in all WebView contexts. Fall back to a textarea-based approach.
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(json);
				new Notice("Logs copied to clipboard");
			} else {
				// Fallback: use a temporary textarea for mobile compatibility
				const textarea = document.createElement("textarea");
				textarea.value = json;
				textarea.style.position = "fixed";
				textarea.style.left = "-9999px";
				textarea.style.opacity = "0";
				document.body.appendChild(textarea);
				textarea.select();
				document.execCommand("copy");
				document.body.removeChild(textarea);
				new Notice("Logs copied to clipboard");
			}
		} catch (err) {
			log.error("error", "Failed to copy logs to clipboard", {
				error: String(err),
			});
			new Notice("Failed to copy logs — try exporting to file instead");
		}
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
					log.info("cache", "Hash mode changed — clearing color caches", {
						from: lastKnownHashMode,
						to: currentHashMode,
					});
					textColorMap.clear();
					colorUsageMap.clear();
				}
				
				// Rebuild decorations on any change that could affect rendering.
				// On mobile, `focusChanged` is important because the editor may
				// lose and regain focus during swipe gestures, keyboard toggles, etc.
				if (update.docChanged || update.viewportChanged || seedChanged || hashModeChanged || update.focusChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
				
				// Update the tracked values after processing
				lastKnownSeed = currentSeed;
				lastKnownHashMode = currentHashMode;
			}

			buildDecorations(view: EditorView): DecorationSet {
				log.time("render", "buildDecorations");
				const builder = new RangeSetBuilder<Decoration>();
				const isDarkMode = document.body.classList.contains("theme-dark");

				let inLink = false;
				let isEmbed = false;
				let hasPipe = false;
				let targetTextBuffer = "";
				let targetColor = "";
				let linkCount = 0;

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
								// Bug 6 fix: Also reset isEmbed to prevent it from leaking into subsequent links.
								if (text.includes("\n")) {
									inLink = false;
									isEmbed = false;
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
										linkCount++;
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
											linkCount++;
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

				log.timeEnd("render", "buildDecorations", `buildDecorations — ${linkCount} links decorated`);
				log.debug("render", "buildDecorations detail", {
					linkCount,
					visibleRanges: view.visibleRanges.length,
					isDarkMode,
					viewportFrom: view.visibleRanges[0]?.from,
					viewportTo: view.visibleRanges[0]?.to,
					cacheSize: textColorMap.size,
				});
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
 * Bug 2: Accepts an isolated usageMap parameter to prevent evaluation
 * from polluting the global colorUsageMap.
 */
function getColorWithHashMode(
	text: string,
	mode: HashMode,
	settings: LinkColorSettings,
	isDarkMode: boolean,
	useCache: boolean = true,
	usageMap: ColorUsageMap = colorUsageMap, // Bug 2: defaults to global, but can be isolated
): string {
	// 1. Clean Prefix (Bug 4: multi-separator support)
	if (settings.ignorePrefix) {
		const stripped = stripPrefix(text);
		if (stripped !== null) text = stripped;
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();
	const seed = settings.customSeed;

	// 3. Check Cache (if enabled) — Bug 5: include darkModeRevision
	if (useCache) {
		const rangeKey = isDarkMode
			? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
			: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
		const textKey = buildCacheKey(settings.palette, isDarkMode, darkModeRevision, seed, rangeKey, mode, cleaned);
		if (textColorMap.has(textKey)) {
			log.recordCacheHit(true);
			return textColorMap.get(textKey)!;
		}
		log.recordCacheHit(false);
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

	// 5. Select Palette (Bug 1: includes hash mode in key; Bug 3: improved tiebreaker)
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	const bestIndex = selectPaletteIndexWithLoadBalancing(
		usageMap, hash, settings.palette, mode, isDarkMode, seed, paletteSize,
	);

	const selectedKey = `${settings.palette}-${mode}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = usageMap.get(selectedKey) || 0;

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
		const textKey = buildCacheKey(settings.palette, isDarkMode, darkModeRevision, seed, rangeKey, mode, cleaned);
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
	// 1. Clean Prefix (Bug 4: multi-separator support)
	if (settings.ignorePrefix) {
		const stripped = stripPrefix(text);
		if (stripped !== null) text = stripped;
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();

	// 3. Check Cache (Bug 5: include darkModeRevision)
	const seed = settings.customSeed;
	const rangeKey = isDarkMode
		? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
		: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
	const textKey = buildCacheKey(settings.palette, isDarkMode, darkModeRevision, seed, rangeKey, settings.hashMode, cleaned);
	if (textColorMap.has(textKey)) {
		log.recordCacheHit(true);
		return textColorMap.get(textKey)!;
	}
	log.recordCacheHit(false);
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

	// 5. Select Palette (Bug 1: includes hash mode; Bug 3: improved tiebreaker)
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	const bestIndex = selectPaletteIndexWithLoadBalancing(
		colorUsageMap, hash, settings.palette, settings.hashMode, isDarkMode, seed, paletteSize,
	);

	const selectedKey = `${settings.palette}-${settings.hashMode}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = colorUsageMap.get(selectedKey) || 0;

	const baseColor = colorList[bestIndex]!;

	// 7. Variant Seed
	const variantSeed = djb2Hash(cleaned + "|v", seed);

	// 8. Apply Aggressive Variant
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



/**
 * Generate a compact inline style string for link coloring.
 * Mobile WebKit can be strict about whitespace in style attributes,
 * so we produce a clean, single-line string with no extra whitespace.
 */
function generateStyleString(color: string, _settings: LinkColorSettings): string {
	return `color:${color} !important;-webkit-text-fill-color:${color} !important;--link-color:${color} !important;--link-external-color:${color} !important;`;
}

// --- Log Viewer Modal ---

/**
 * Modal for browsing, searching, and filtering plugin logs.
 * Designed to replace DevTools on mobile — the user can inspect
 * what the plugin is doing from within Obsidian's settings.
 */
class LogViewerModal extends Modal {
	private entries: LogEntry[];
	private stats: ReturnType<typeof log.getStats>;
	private filterText = "";
	private filterCategory: LogCategory | "all" = "all";
	private filterLevel: string = "all";

	constructor(
		app: App,
		entries: LogEntry[],
		stats: ReturnType<typeof log.getStats>,
	) {
		super(app);
		this.entries = entries;
		this.stats = stats;
	}

	onOpen() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("link-color-log-viewer");

		// Title
		containerEl.createEl("h2", { text: "Link Colorer Logs" });

		// Stats bar
		const statsBar = containerEl.createDiv({ cls: "log-stats-bar" });
		const cacheInfo =
			this.stats.cacheHitRate !== null
				? ` | Cache: ${this.stats.cacheHitRate}%`
				: "";
		statsBar.textContent = `${this.stats.totalEntries} entries${cacheInfo}`;

		// Filters row
		const filterRow = containerEl.createDiv({ cls: "log-filter-row" });

		// Search input
		const searchInput = filterRow.createEl("input", {
			type: "text",
			placeholder: "Search logs...",
			cls: "log-search-input",
		});
		searchInput.addEventListener("input", () => {
			this.filterText = searchInput.value;
			this.renderLogs();
		});

		// Category dropdown
		const catSelect = filterRow.createEl("select", { cls: "log-filter-select" });
		catSelect.createEl("option", { text: "All categories", value: "all" });
		const categories: LogCategory[] = [
			"lifecycle",
			"render",
			"cache",
			"mutation",
			"settings",
			"performance",
			"mobile",
			"error",
		];
		for (const cat of categories) {
			catSelect.createEl("option", { text: cat, value: cat });
		}
		catSelect.addEventListener("change", () => {
			this.filterCategory = catSelect.value as LogCategory | "all";
			this.renderLogs();
		});

		// Level dropdown
		const levelSelect = filterRow.createEl("select", {
			cls: "log-filter-select",
		});
		levelSelect.createEl("option", { text: "All levels", value: "all" });
		for (const lvl of ["error", "warn", "info", "debug"] as const) {
			levelSelect.createEl("option", { text: lvl, value: lvl });
		}
		levelSelect.addEventListener("change", () => {
			this.filterLevel = levelSelect.value;
			this.renderLogs();
		});

		// Log container
		const logContainer = containerEl.createDiv({
			cls: "log-entries-container",
		});
		logContainer.setAttribute("data-log-container", "true");

		this.renderLogs();

		// Action buttons
		const actionsRow = containerEl.createDiv({ cls: "log-actions-row" });
		const copyBtn = actionsRow.createEl("button", {
			text: "Copy all to clipboard",
			cls: "mod-cta",
		});
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(
					JSON.stringify(log.export(), null, 2),
				);
				new Notice("Logs copied to clipboard");
			} catch {
				new Notice("Failed to copy logs");
			}
		});
	}

	private renderLogs() {
		const container = this.containerEl.querySelector(
			"[data-log-container]",
		) as HTMLElement | null;
		if (!container) return;
		container.empty();

		let filtered = [...this.entries].reverse(); // newest first

		if (this.filterText) {
			const lower = this.filterText.toLowerCase();
			filtered = filtered.filter(
				(e) =>
					e.msg.toLowerCase().includes(lower) ||
					(e.data && JSON.stringify(e.data).toLowerCase().includes(lower)),
			);
		}

		if (this.filterCategory !== "all") {
			filtered = filtered.filter((e) => e.cat === this.filterCategory);
		}

		if (this.filterLevel !== "all") {
			filtered = filtered.filter((e) => e.level === this.filterLevel);
		}

		// Limit display to 200 entries for DOM performance
		const displayed = filtered.slice(0, 200);

		if (filtered.length > 200) {
			container.createDiv({
				cls: "log-truncation-notice",
				text: `Showing 200 of ${filtered.length} filtered entries`,
			});
		}

		for (const entry of displayed) {
			const row = container.createDiv({
				cls: `log-entry log-level-${entry.level}`,
			});

			const time = new Date(entry.ts);
			const timeStr = time.toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});

			const header = row.createDiv({ cls: "log-entry-header" });
			header.createEl("span", {
				cls: "log-time",
				text: timeStr,
			});
			header.createEl("span", {
				cls: `log-level log-level-badge-${entry.level}`,
				text: entry.level.toUpperCase(),
			});
			header.createEl("span", {
				cls: "log-category",
				text: entry.cat,
			});

			const msgEl = row.createDiv({ cls: "log-entry-msg", text: entry.msg });

			if (entry.durMs !== undefined) {
				const durEl = row.createEl("span", {
					cls: "log-duration",
					text: `${entry.durMs}ms`,
				});
				if (entry.durMs > 100) {
					durEl.addClass("log-duration-slow");
				}
				msgEl.appendChild(durEl);
			}

			if (entry.data && Object.keys(entry.data).length > 0) {
				const dataEl = row.createDiv({ cls: "log-entry-data" });
				dataEl.textContent = JSON.stringify(entry.data, null, 2);
				// Make data collapsible
				dataEl.style.display = "none";
				msgEl.addEventListener("click", () => {
					dataEl.style.display =
						dataEl.style.display === "none" ? "block" : "none";
				});
				msgEl.style.cursor = "pointer";
			}
		}

		if (displayed.length === 0) {
			container.createDiv({
				cls: "log-empty",
				text: "No log entries match your filters.",
			});
		}
	}
}
