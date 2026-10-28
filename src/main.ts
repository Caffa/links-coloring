import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
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
	type ColorUsageMap,
	COLOR_USAGE_NORMALIZE_THRESHOLD,
	applyAggressiveVariant,
	buildCacheKey,
	djb2Hash,
	hashStrictAcronym,
	hashStrictFull,
	normalizeColorUsage,
	selectPaletteIndexWithLoadBalancing,
	stripPrefix,
} from "./color-utils";
import {
	DEFAULT_SETTINGS,
	type HashMode,
	type LinkColorSettings,
	LinkColorSettingTab,
	PALETTES,
} from "./settings";
import { CollisionModal } from "./ui/collision-modal";
import { LRUCache } from "./lru-cache";
import {
	updatePerformanceConfig,
	getCurrentConfig,
	getVaultSizeTier,
	getTierDisplayName,
	type VaultSizeTier,
	type VaultSizeInfo,
} from "./performance-config";
import { LimitedSet, debounce, perfTracker } from "./performance-config";

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
		// Performance: Filter mutations more aggressively
		// Only recolor if actual link elements were added/changed
		let shouldRecolor = false;
		
		for (const mutation of mutations) {
			// Skip if no nodes added
			if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
				// Check attribute changes on link elements only
				if (mutation.type === "attributes") {
					const target = mutation.target as HTMLElement;
					// Only care about link elements
					if (target.tagName === "A" && 
						(target.classList.contains("internal-link") || 
						 target.hasAttribute("data-href"))) {
						shouldRecolor = true;
						break;
					}
				}
				continue;
			}
			
			// Check if added nodes contain links (more efficient than recoloring everything)
			const addedNodes = Array.from(mutation.addedNodes);
			for (const node of addedNodes) {
				if (node instanceof HTMLElement) {
					// Check if this node is a link or contains links
					if (node.tagName === "A" || node.querySelector?.('a.internal-link, a[data-href]')) {
						shouldRecolor = true;
						break;
					}
				}
			}
			
			if (shouldRecolor) break;
		}
		
		if (shouldRecolor) {
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

// Performance: Use LRU cache to prevent unbounded memory growth
// Global text-to-color mapping to ensure consistent shading per text
let textColorMap = new LRUCache<string, string>({ maxSize: 3500 }); // Initial size, updated on vault detection
// Track the palette index for each link (for collision statistics)
let linkPaletteIndexMap = new LRUCache<string, number>({ maxSize: 3500 });
// Track how many times each base color has been used (for shade generation)
const colorUsageMap: ColorUsageMap = new Map();
// Track current parent folder path for folder-based re-roll
let currentParentFolderPath: string | null = null;
// Track files that have been opened (to distinguish new file opens from tab switches)
// Performance: Use LimitedSet to prevent unbounded growth
let openedFiles = new LimitedSet<string>(150); // Initial size, updated on vault detection
// Track which files have been precomputed to avoid redundant work
let precomputedFiles = new LimitedSet<string>(75); // Initial size, updated on vault detection
// Track when files were last precomputed (for cooldown)
const lastPrecomputeTime = new Map<string, number>();
// Track last known seed to detect changes - used to force view updates
// Initialize to -1 (an impossible seed value) to force initial render
let lastKnownSeed: number = -1;
// Track last known hash mode to detect changes and invalidate cache
let lastKnownHashMode: HashMode | null = null;

// Mobile fix: CM6 parses only an initial window (~3000 chars) eagerly, so the
// first buildDecorations() can run against an incomplete syntax tree and
// produce (near-)empty decorations that never refresh if no transaction
// fires. Retry on a short timer until the visible range is parsed.
const PARSE_RETRY_DELAY_MS = 200;
const PARSE_RETRY_MAX = 20; // worst case ~4s of retries, then give up

// Bug 5: Dark mode revision counter — incremented on theme switch to
// force cache invalidation so stale dark/light mode colors aren't reused
let darkModeRevision = 0;
// Counter for auto-reroll check throttling
let fileSwitchesSinceLastRerollCheck = 0;

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
		if (!content) {
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
		return deduped;
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
 * 
 * Performance: Uses cooldown to prevent redundant precomputation on rapid file switches
 */
async function precomputeFileLinkColors(
	file: TFile,
	plugin: LinkColorPlugin,
): Promise<void> {
	const filePath = file.path;

	// Performance: Check cooldown to prevent redundant work
	const lastTime = lastPrecomputeTime.get(filePath) || 0;
	const now = Date.now();
	const cooldownMs = getCurrentConfig().precomputeCooldownMs;
	if (now - lastTime < cooldownMs) {
		// Skip if recently precomputed
		return;
	}

	// Skip if already precomputed this session (prevents redundant work on file switches)
	if (precomputedFiles.has(filePath)) {
		return;
	}

	const startTime = perfTracker.start("precompute");

	try {
		const content = await plugin.app.vault.cachedRead(file);
		const links = extractLinksFromContent(content);
		const isDarkMode = document.body.classList.contains("theme-dark");

		// Pre-compute colors for all links (populates textColorMap cache)
		for (const link of links) {
			getColor(link, plugin.settings, isDarkMode);
		}

		// Mark as precomputed and record time
		precomputedFiles.add(filePath);
		lastPrecomputeTime.set(filePath, now);

		perfTracker.end("precompute", startTime);
	} catch (error) {
		console.warn("Failed to precompute link colors:", filePath, error);
	}
}

/**
 * Pre-compute colors for links in a file, processing them by frequency.
 * Links with more occurrences are processed first, so they claim the most
 * distinct colors from the load-balancing algorithm. This is used for
 * priority files (e.g., "Chapter - *" pages) to ensure their most
 * frequently-appearing links get the best color distribution.
 * 
 * Performance: Uses cooldown to prevent redundant precomputation
 */
async function precomputeFileLinkColorsByFrequency(
	file: TFile,
	plugin: LinkColorPlugin,
): Promise<void> {
	const filePath = file.path;

	// Performance: Check cooldown to prevent redundant work
	const lastTime = lastPrecomputeTime.get(filePath) || 0;
	const now = Date.now();
	const cooldownMs = getCurrentConfig().precomputeCooldownMs;
	if (now - lastTime < cooldownMs) {
		// Skip if recently precomputed
		return;
	}

	// Skip if already precomputed (prevents redundant work on file switches)
	if (precomputedFiles.has(filePath)) {
		return;
	}

	const startTime = perfTracker.start("precomputeFrequency");

	try {
		const content = await plugin.app.vault.cachedRead(file);
		const linksWithCounts = extractLinksWithCounts(content);
		const isDarkMode = document.body.classList.contains("theme-dark");

		// Process links in order of frequency (most frequent first)
		// This gives the most-occurring links the freshest palette colors
		for (const [link] of linksWithCounts) {
			getColor(link, plugin.settings, isDarkMode);
		}

		// Mark as precomputed and record time
		precomputedFiles.add(filePath);
		lastPrecomputeTime.set(filePath, now);

		perfTracker.end("precomputeFrequency", startTime);
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
	shouldCache: boolean = true,
	recordStats: boolean = false,
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
	// Performance: LRU cache access - moves to most-recently-used if found
	const cachedColor = textColorMap.get(textKey);
	if (cachedColor !== undefined && linkPaletteIndexMap.has(textKey)) {
		return cachedColor;
	}

	// Early return if not caching - compute color without storing
	if (!shouldCache) {
		const result = computeRandomColorWithoutCaching(cleaned, settings, isDarkMode, seed);
		if (recordStats) {
			// Recording writes both maps without a load-balancing increment, so the
			// rendered Live Preview color pins the recorded palette index by design.
			linkPaletteIndexMap.set(textKey, result.paletteIndex);
			textColorMap.set(textKey, result.color);
		}
		return result.color;
	}

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

	// Store palette index for collision statistics (use textKey for consistency)
	linkPaletteIndexMap.set(textKey, bestIndex);

	// 8. Cache Result
	textColorMap.set(textKey, finalColor);

	return finalColor;
}

/**
 * Compute a random color for display without caching it.
 * Used for partial links during typing to avoid polluting the cache.
 */
function computeRandomColorWithoutCaching(
	cleaned: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
	seed: number,
): UncachedColorResult {
	const hash = djb2Hash(cleaned, seed);
	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	// Use hash directly for palette selection (no load balancing for uncached)
	const paletteIndex = Math.abs(hash) % paletteSize;
	const baseColor = colorList[paletteIndex]!;

	const variantSeed = djb2Hash(cleaned + "|v", seed);
	const color = applyAggressiveVariant(baseColor, variantSeed, 0, isDarkMode, settings);
	return { color, paletteIndex };
}



// Export for UI components (compatibility with existing code)
// Performance: Convert LRU cache to Map for external use
export function getTextColorMap(): Map<string, string> {
	return new Map(textColorMap.entries());
}

export function getColorUsageMap(): Map<string, number> {
	return new Map(colorUsageMap);
}

export function getLinkPaletteIndexMap(): Map<string, number> {
	return new Map(linkPaletteIndexMap.entries());
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
	// Guard against overlapping rebuildLinkColorStats invocations
	private rebuilding = false;

	/**
	 * Get the current link-to-color mapping.
	 * Returns a copy to prevent external modification.
	 * Performance: Converts LRU cache to regular Map.
	 */
	getLinkColorMap(): Map<string, string> {
		return new Map(textColorMap.entries());
	}

	/**
	 * Get the current color usage statistics.
	 * Returns a copy to prevent external modification.
	 */
	getColorUsageStats(): Map<string, number> {
		return new Map(colorUsageMap);
	}

	/**
	 * Detect vault size and apply appropriate performance settings.
	 * Automatically adjusts cache sizes and throttling based on vault complexity.
	 */
	private async detectAndApplyVaultSizeSettings(): Promise<void> {
		try {
			// Get all markdown files in vault
			const files = this.app.vault.getMarkdownFiles();
			const noteCount = files.length;

			// Detect vault size tier
			const tier = getVaultSizeTier(noteCount);
			
			// Apply performance configuration
			updatePerformanceConfig(tier);
			
			// Update cache and set sizes with new limits
			const config = getCurrentConfig();
			textColorMap = new LRUCache<string, string>({ maxSize: config.maxCacheSize });
			linkPaletteIndexMap = new LRUCache<string, number>({ maxSize: config.maxCacheSize });
			openedFiles = new LimitedSet<string>(config.maxOpenedFiles);
			precomputedFiles = new LimitedSet<string>(config.maxPrecomputedFiles);

			console.log(
				`[Link Colorer] Vault detected: ${noteCount} notes, tier: ${getTierDisplayName(tier)}, ` +
				`cache: ${config.maxCacheSize}, debounce: ${config.fileSwitchDebounceMs}ms`
			);
		} catch (error) {
			// Fallback to medium settings if detection fails
			console.warn("[Link Colorer] Failed to detect vault size, using defaults", error);
			updatePerformanceConfig('medium');
		}
	}

	async onload() {
		await this.loadSettings();
		// Initialize seed tracking from settings
		lastKnownSeed = this.settings.customSeed;
		// Initialize hash mode tracking from settings to avoid spurious cache clear on first render
		lastKnownHashMode = this.settings.hashMode;

		// --- Mobile detection ---
		this.isMobile = (this.app as any).isMobile ?? false;
		
		// --- Vault size detection for auto-performance tuning ---
		await this.detectAndApplyVaultSizeSettings();
		
		// Debug logging for mobile diagnostics
		if (this.isMobile) {
			console.log("[Link Colorer] Running on mobile platform");
		}

		this.addSettingTab(new LinkColorSettingTab(this.app, this));
		this.editorExtension = createLinkColorExtension(this, this.isMobile);
		this.registerEditorExtension(this.editorExtension);

		// --- Command: Show Link Collision Statistics ---
		this.addCommand({
			id: "show-link-collision-stats",
			name: "Show Link Collision Statistics",
			callback: () => {
				new CollisionModal(this.app, this).open();
			},
		});

		// --- Command: Reroll Colors ---
		this.addCommand({
			id: "reroll-colors",
			name: "Reroll Colors",
			callback: async () => {
				const newSeed = Math.floor(Math.random() * 100000) + 1;
				this.settings.customSeed = newSeed;
				this.resetColorState();
				await this.saveSettings();
				await this.forceViewUpdate();
			},
		});

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
				const delay = getCurrentConfig().mobileDebounceMs;
				this.recolorDebounceTimer = window.setTimeout(() => {
					this.setupReadingViewObservers();
					this.recolorAllReadingViews();
					this.recolorDebounceTimer = null;
				}, delay);
			});
		}

		// Re-color reading view links when active leaf changes (new file opened)
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				// On mobile, use debouncing to avoid excessive recoloring during
				// rapid navigation (swipe gestures, etc.)
				// Performance: Use configurable debounce delays from performance-config
				const config = getCurrentConfig();
				const delay = this.isMobile ? config.mobileDebounceMs : config.fileSwitchDebounceMs;
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
			this.app.workspace.on("css-change", async () => {
				// Bug 5: Increment dark mode revision to invalidate color cache
				darkModeRevision++;
				// Clear caches so colors are recalculated with the new theme
				textColorMap.clear();
				linkPaletteIndexMap.clear();
				// Clear precomputed files so they'll be recomputed with new theme colors
				precomputedFiles.clear();
				// Precompute colors for the current active file with new theme
				// Performance: Properly await async operation to avoid race conditions
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					await precomputeFileLinkColors(activeFile, this);
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
				}

				// OPTION 2: Pre-process links for smooth scrolling
				// Pre-compute colors for all links in the new file before user scrolls
				// (priorityPrecompute already handles some files, but this ensures
				// the active file is always precomputed even if no re-roll occurred)
				await precomputeFileLinkColors(file, this);

				// OPTION 3: Auto-reroll when too many links share same color
				// Performance: Throttled to only check every N file switches
				if (this.settings.autoRerollThreshold > 0) {
					fileSwitchesSinceLastRerollCheck++;
					const checkFrequency = getCurrentConfig().autoRerollCheckFrequency;
					if (fileSwitchesSinceLastRerollCheck >= checkFrequency) {
						await this.checkAndAutoReroll();
						fileSwitchesSinceLastRerollCheck = 0;
					}
				}
			}),
		);

		// Pre-compute colors for initially active file
		const initialFile = this.app.workspace.getActiveFile();
		if (initialFile) {
			currentParentFolderPath = initialFile.parent?.path ?? null;
			openedFiles.add(initialFile.path);
			await precomputeFileLinkColors(initialFile, this);
		}
	}

	/**
	 * Check if color distribution is poor and auto-reroll if needed.
	 * Auto-reroll triggers when the same color is assigned to more than
	 * the threshold percentage of unique links.
	 * 
	 * Performance: Only runs every N file switches (throttled)
	 */
	async checkAndAutoReroll(): Promise<boolean> {
		const threshold = this.settings.autoRerollThreshold;
		if (threshold <= 0) return false;

		// Performance: Skip if too few links (meaningless statistics)
		const config = getCurrentConfig();
		const totalLinks = textColorMap.size;
		if (totalLinks < config.autoRerollMinLinks) return false;

		// Count color distribution
		const colorCounts = new Map<string, number>();

		// Performance: Use LRU cache entries() iterator
		for (const [text, color] of textColorMap.entries()) {
			colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
		}

		// Find the most used color
		let maxCount = 0;
		let maxColor = "";
		for (const [color, count] of colorCounts.entries()) {
			if (count > maxCount) {
				maxCount = count;
				maxColor = color;
			}
		}

		// Calculate percentage
		const percentage = (maxCount / totalLinks) * 100;

		// Auto-reroll if exceeded threshold
		if (percentage >= threshold) {
			console.log(`Link Colorer: Auto-reroll triggered - ${maxColor} used for ${maxCount}/${totalLinks} links (${percentage.toFixed(1)}%, threshold: ${threshold}%)`);
			
			const newSeed = Math.floor(Math.random() * 100000) + 1;
			this.settings.customSeed = newSeed;
			this.resetColorState();
			await this.saveSettings();
			await this.forceViewUpdate();
			return true;
		}

		return false;
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
		linkPaletteIndexMap.clear();
		precomputedFiles.clear();
		openedFiles.clear();
		lastPrecomputeTime.clear();
		currentParentFolderPath = null;
		lastKnownSeed = -1;
		lastKnownHashMode = null;
		darkModeRevision = 0;
		fileSwitchesSinceLastRerollCheck = 0;
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
		// Re-color reading view links when settings change
		this.recolorAllReadingViews();
	}

	// Reset all color tracking
	resetColorState() {
		textColorMap.clear();
		colorUsageMap.clear();
		linkPaletteIndexMap.clear();
		precomputedFiles.clear();
		// Clear precompute cooldown tracking
		lastPrecomputeTime.clear();
		// Note: Don't clear openedFiles - we want to remember which files
		// have been opened even after color reset, to distinguish between
		// "new files" and "switching between already-open tabs"
		// Reset seed tracking to force view update on next render
		// Setting to -1 ensures next view update will detect seed change
		lastKnownSeed = -1;
		// Keep hash mode tracking at its current value.
		// After a reroll, the caches are empty and will be repopulated by priorityPrecompute / view update.
		// If lastKnownHashMode were reset to null, the next CM6 ViewPlugin update would see
		// hashModeChanged=true and clear the freshly repopulated textColorMap again, leaving
		// collision statistics empty while links are still colored.
		// Reset auto-reroll check counter
		fileSwitchesSinceLastRerollCheck = 0;
		console.log("Color state reset");
	}

	/**
	 * Pre-compute link colors for priority files before other open tabs.
	 * Files whose names start with the priorityFilePrefix are processed first,
	 * giving them the best color distribution from the load-balancing algorithm.
	 * Within priority files, links with more occurrences are processed first,
	 * so the most frequent links claim the most distinct colors.
	 * 
	 * Performance: Processes files in parallel batches to avoid blocking
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

		// Performance: Process files in parallel batches
		// to avoid blocking when many tabs are open
		const config = getCurrentConfig();
		const batchSize = config.maxConcurrentPrecomputes;
		
		const processBatch = async (files: TFile[], useFrequency: boolean) => {
			for (let i = 0; i < files.length; i += batchSize) {
				const batch = files.slice(i, i + batchSize);
				await Promise.all(
					batch.map(file => 
						useFrequency 
							? precomputeFileLinkColorsByFrequency(file, this)
							: precomputeFileLinkColors(file, this)
					)
				);
			}
		};

		// Priority files get frequency-based ordering
		await processBatch(priorityFiles, true);
		
		// Other files get standard precomputation
		await processBatch(otherFiles, false);
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

	/**
	 * Rebuild collision statistics from the current open workspace state.
	 * Bypasses precomputed-file sticky guards and the precompute cooldown so
	 * the modal can recover after cache wipes.
	 */
	async rebuildLinkColorStats(): Promise<void> {
		if (this.rebuilding) return;
		this.rebuilding = true;
		try {
			// Deliberately do NOT clear textColorMap, linkPaletteIndexMap, or
			// colorUsageMap here. Recomputation reuses load-balancing state, so
			// recovered colors may shift slightly after a cache wipe/desync —
			// that is intended recovery behavior.
			precomputedFiles.clear();
			lastPrecomputeTime.clear();
			await this.priorityPrecompute();
			this.recolorAllReadingViews();
			console.log(
				`[Link Colorer] Rebuilt collision stats: ${textColorMap.size} colors, ` +
				`${linkPaletteIndexMap.size} palette indices`,
			);
		} finally {
			this.rebuilding = false;
		}
	}
}

function createLinkColorExtension(plugin: LinkColorPlugin, isMobile: boolean) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private parseRetryTimer: number | null = null;
			private parseRetries = 0;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
				// Debug: Log initial decoration creation on mobile
				if (isMobile) {
					console.log("[Link Colorer] ViewPlugin constructor - Initial decorations created");
				}
				this.scheduleParseRetry(view);
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
					linkPaletteIndexMap.clear();
					colorUsageMap.clear();
				}
				
				// Rebuild decorations on any change that could affect rendering.
				// On mobile, `focusChanged` is important because the editor may
				// lose and regain focus during swipe gestures, keyboard toggles, etc.
				// `treeChanged`: the background parser finished/advanced without any
				// transaction (docChanged/viewportChanged both false when it does),
				// so decorations built against a partial tree would otherwise never
				// refresh.
				const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
				const shouldRebuild =
					update.docChanged ||
					update.viewportChanged ||
					seedChanged ||
					hashModeChanged ||
					update.focusChanged ||
					treeChanged;
				
				if (shouldRebuild) {
					this.decorations = this.buildDecorations(update.view);
					// Debug: Log decoration rebuild on mobile
					if (isMobile && update.docChanged) {
						console.log("[Link Colorer] ViewPlugin update - Rebuilt decorations due to:", {
							docChanged: update.docChanged,
							viewportChanged: update.viewportChanged,
							focusChanged: update.focusChanged,
							seedChanged,
							hashModeChanged
						});
					}
				}
				
				// Update the tracked values after processing
				lastKnownSeed = currentSeed;
				lastKnownHashMode = currentHashMode;
			}

			destroy(): void {
				if (this.parseRetryTimer !== null) {
					window.clearTimeout(this.parseRetryTimer);
					this.parseRetryTimer = null;
				}
			}

			/**
			 * Schedule a bounded chain of deferred rebuilds while the background
			 * parser is still working. `buildDecorations` reads `view.visibleRanges`
			 * against the partial `syntaxTree`, so we target the check at the
			 * largest visible range instead of the whole document (much shorter
			 * wait on huge notes, correct on mobile and desktop alike).
			 */
			scheduleParseRetry(view: EditorView): void {
				if (this.parseRetries >= PARSE_RETRY_MAX) return;
				let parsedUpTo = 0;
				for (const range of view.visibleRanges) {
					parsedUpTo = Math.max(parsedUpTo, range.to);
				}
				if (parsedUpTo === 0) return; // no viewport yet; update() handles it
				if (syntaxTreeAvailable(view.state, parsedUpTo)) return;
				this.parseRetries++;
				if (isMobile) {
					console.debug(`[Link Colorer] Syntax tree incomplete - retry #${this.parseRetries} in ${PARSE_RETRY_DELAY_MS}ms`);
				}
				this.parseRetryTimer = window.setTimeout(() => {
					this.parseRetryTimer = null;
					// View may have been destroyed while we waited.
					if (!view.dom || !view.dom.isConnected) return;
					// Never touch the view mid-IME-composition (CJK input); retrying
					// instead avoids interrupting an in-progress composition.
					if (view.composing) {
						this.scheduleParseRetry(view);
						return;
					}
					this.decorations = this.buildDecorations(view);
					// Plugin field changes between transactions are only re-read on a
					// view update; an empty transaction is the cheapest such update.
					view.dispatch({});
					this.scheduleParseRetry(view); // continue until visible range is parsed
				}, PARSE_RETRY_DELAY_MS);
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const isDarkMode = document.body.classList.contains("theme-dark");

				let inLink = false;
				let isEmbed = false;
				let hasPipe = false;
				let targetTextBuffer = "";
				let targetColor = "";
				let linkCount = 0;

				// Debug: Check visible ranges on mobile
				const visibleRanges = view.visibleRanges;
				if (isMobile && visibleRanges.length === 0) {
					console.warn("[Link Colorer] No visible ranges detected - this may indicate a timing issue");
				}

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
								if (inLink && !isEmbed && targetTextBuffer) {
									// Record the completed link target for collision statistics without
									// running load balancing (the per-node partial calls already did that).
									getColor(
										targetTextBuffer,
										plugin.settings,
										isDarkMode,
										false, // shouldCache: false - do not touch load balancing
										true, // recordStats: true - register final palette index
									);
								}
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
									// Don't cache partial link colors - only compute for display
									targetColor = getColor(
										targetTextBuffer,
										plugin.settings,
										isDarkMode,
										false, // shouldCache: false - don't cache partial aliases
									);
									return;
								}

								if (!type.includes("formatting")) {
									if (!hasPipe) {
										targetTextBuffer += text;
										// Don't cache partial link colors during typing - only compute for display
										// This prevents "md", "md -", etc. from being cached while user types
										const dynColor = getColor(
											targetTextBuffer,
											plugin.settings,
											isDarkMode,
											false, // shouldCache: false - don't cache incomplete links
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

				// Debug: Log link count on mobile
				if (isMobile && linkCount > 0) {
					console.log(`[Link Colorer] Built ${linkCount} link decorations`);
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}



function getColor(
	text: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
	shouldCache: boolean = true,
	recordStats: boolean = false,
): string {
	// Handle special modes first
	if (settings.hashMode === "random") {
		return getRandomColor(text, settings, isDarkMode, shouldCache, recordStats);
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
	// Performance: LRU cache access - moves to most-recently-used if found
	const cachedColor = textColorMap.get(textKey);
	if (cachedColor !== undefined && linkPaletteIndexMap.has(textKey)) {
		return cachedColor;
	}

	// Early return if not caching - compute color without storing
	if (!shouldCache) {
		const result = computeColorWithoutCaching(cleaned, settings, isDarkMode, seed);
		if (recordStats) {
			// Recording writes both maps without a load-balancing increment, so the
			// rendered Live Preview color pins the recorded palette index by design.
			linkPaletteIndexMap.set(textKey, result.paletteIndex);
			textColorMap.set(textKey, result.color);
		}
		return result.color;
	}
	
	let hash: number;

	switch (settings.hashMode) {
		case "strict-full":
			hash = hashStrictFull(cleaned, seed);
			break;
		case "strict-acronym":
			hash = hashStrictAcronym(cleaned, seed);
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

	// Store palette index for collision statistics (use textKey for consistency)
	linkPaletteIndexMap.set(textKey, bestIndex);

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

interface UncachedColorResult {
	color: string;
	paletteIndex: number;
}

/**
 * Compute a color for display without caching it.
 * Returns { color, paletteIndex } and is used for Live Preview complete-link
 * recording (recordStats) and other uncached paths.
 */
function computeColorWithoutCaching(
	cleaned: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
	seed: number,
): UncachedColorResult {
	let hash: number;

	switch (settings.hashMode) {
		case "strict-full":
			hash = hashStrictFull(cleaned, seed);
			break;
		case "strict-acronym":
			hash = hashStrictAcronym(cleaned, seed);
			break;
		case "phonetic-ipa":
			hash = hashPhoneticIpa(cleaned, seed);
			break;
		default:
			hash = hashStrictFull(cleaned, seed);
	}

	const paletteObj = PALETTES[settings.palette] ?? PALETTES["vibrant"]!;
	const colorList = isDarkMode ? paletteObj.dark : paletteObj.light;
	const paletteSize = colorList.length;

	// Use hash directly for palette selection (no load balancing for uncached)
	const paletteIndex = Math.abs(hash) % paletteSize;
	const baseColor = colorList[paletteIndex]!;

	const variantSeed = djb2Hash(cleaned + "|v", seed);
	const color = applyAggressiveVariant(baseColor, variantSeed, 0, isDarkMode, settings);
	return { color, paletteIndex };
}



/**
 * Generate a compact inline style string for link coloring.
 * Mobile WebKit can be strict about whitespace in style attributes,
 * so we produce a clean, single-line string with no extra whitespace.
 */
function generateStyleString(color: string, _settings: LinkColorSettings): string {
	return `color:${color} !important;-webkit-text-fill-color:${color} !important;--link-color:${color} !important;--link-external-color:${color} !important;`;
}
