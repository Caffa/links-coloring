/**
 * Shared color-computation core.
 *
 * Holds the mutable cache/state used by the editor/reading-view renderer.
 * Also exposes side-effect-free helpers for the public API: cache lookups
 * return the exact on-screen color, and uncached computes predict what
 * Live Preview will paint first without touching caches or usage stats.
 */

import { hashPhoneticIpa } from "./phonetic";
import {
	type ColorUsageMap,
	applyAggressiveVariant,
	buildCacheKey,
	djb2Hash,
	hashStrictAcronym,
	hashStrictFull,
	stripPrefix,
	selectPaletteIndexWithLoadBalancing,
} from "./color-utils";
import {
	type LinkColorSettings,
	PALETTES,
} from "./settings-data";
import { LRUCache } from "./lru-cache";

// Performance: Use LRU cache to prevent unbounded memory growth
// Global text-to-color mapping to ensure consistent shading per text
export let textColorMap = new LRUCache<string, string>({ maxSize: 3500 }); // Initial size, updated on vault detection
// Track the palette index for each link (for collision statistics)
export let linkPaletteIndexMap = new LRUCache<string, number>({ maxSize: 3500 });
// Track how many times each base color has been used (for shade generation)
export const colorUsageMap: ColorUsageMap = new Map();

// Bug 5: Dark mode revision counter — incremented on theme switch to
// force cache invalidation so stale dark/light mode colors aren't reused
let darkModeRevision = 0;

/** Resize the global color caches when vault-size settings change. */
export function resizeColorCaches(maxCacheSize: number): void {
	textColorMap = new LRUCache<string, string>({ maxSize: maxCacheSize });
	linkPaletteIndexMap = new LRUCache<string, number>({ maxSize: maxCacheSize });
}

/** Increment the dark-mode revision (theme switched). */
export function incrementDarkModeRevision(): void {
	darkModeRevision++;
}

/** Reset the dark-mode revision (plugin unloaded). */
export function resetDarkModeRevision(): void {
	darkModeRevision = 0;
}

/**
 * Side-effect-free cache lookup for the public API.
 *
 * Builds the same cache key the renderer uses and returns the cached hex color
 * only if both textColorMap and linkPaletteIndexMap contain the entry.
 * Does not write to any map, usage counter, or statistic.
 */
export function lookupCachedColor(
	text: string,
	settings: LinkColorSettings,
	isDarkMode: boolean,
): string | undefined {
	// 1. Clean Prefix (same as getColor / getRandomColor)
	if (settings.ignorePrefix) {
		const stripped = stripPrefix(text);
		if (stripped !== null) text = stripped;
	}

	// 2. Prepare Data
	const cleaned = text.trim().toLowerCase();
	const seed = settings.customSeed;

	// 3. Build Cache Key (same key construction as getColor)
	const rangeKey = isDarkMode
		? `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`
		: `${settings.lightSaturationMin}-${settings.lightSaturationMax}-${settings.lightLightnessMin}-${settings.lightLightnessMax}`;
	const textKey = buildCacheKey(
		settings.palette,
		isDarkMode,
		darkModeRevision,
		seed,
		rangeKey,
		settings.hashMode,
		cleaned,
	);

	// 4. Check Cache
	const cachedColor = textColorMap.get(textKey);
	if (cachedColor !== undefined && linkPaletteIndexMap.has(textKey)) {
		return cachedColor;
	}
	return undefined;
}

/**
 * Get random color from palette with consistency and color avoidance
 * - Uses caching to ensure same link text gets same color per session
 * - Implements load balancing to avoid overusing colors
 * - Applies hue/shade adjustments for visual distinction
 */
export function getRandomColor(
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

	const baseColor = colorList[bestIndex]!;

	// 7. Apply Hue/Shade Adjustments (same as other modes)
	const variantSeed = djb2Hash(cleaned + "|v", seed);
	const finalColor = applyAggressiveVariant(
		baseColor,
		variantSeed,
		currentUsageCount,
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
export function computeRandomColorWithoutCaching(
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

export interface UncachedColorResult {
	color: string;
	paletteIndex: number;
}

/**
 * Compute a color for display without caching it.
 * Returns { color, paletteIndex } and is used for Live Preview complete-link
 * recording (recordStats) and other uncached paths.
 */
export function computeColorWithoutCaching(
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
 * Main cached color computation used by both the renderer and the public API.
 * Routes through the exact same key construction, cache lookup, and load-balancing
 * path so every caller converges on the same color for the same link text.
 */
export function getColor(
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
