/**
 * Pure color utility functions for link coloring.
 *
 * Extracted from main.ts for testability. All functions are pure
 * (no DOM access, no module-level mutable state) so they can be
 * unit-tested without Obsidian.
 */

// ============================================================================
// Bug 4: Multi-separator prefix stripping
// ============================================================================

/**
 * Supported prefix separators for ignorePrefix mode.
 * Ordered by preference: longer/more specific separators first to avoid
 * partial matches (e.g., " — " before " - " to prevent em-dash being
 * partially consumed as a regular dash).
 */
export const PREFIX_SEPARATORS = [
	" — ", // em-dash with spaces
	" - ",  // en-dash/hyphen with spaces (original)
	": ",   // colon with space
	" | ",  // pipe with spaces
	"/",    // forward slash
	".",    // period
] as const;

/**
 * Strip a prefix from link text using multiple supported separators.
 * Uses lastIndexOf (rightmost match) so "A - B - C" → "C", consistent
 * with the original split-then-take-last behavior.
 *
 * Returns the stripped text, or null if no separator was found.
 */
export function stripPrefix(text: string): string | null {
	for (const sep of PREFIX_SEPARATORS) {
		const idx = text.lastIndexOf(sep);
		if (idx !== -1) {
			const namePart = text.substring(idx + sep.length);
			if (namePart.length > 0) {
				return namePart.trim();
			}
		}
	}
	return null;
}

// ============================================================================
// Bug 7: Improved DJB2 hash with MurmurHash3 finalizer (avalanche)
// ============================================================================

/**
 * DJB2 hash with MurmurHash3-style finalizer for improved avalanche properties.
 *
 * The classic DJB2 (`hash * 33 + c`) has poor avalanche for short strings:
 * similar inputs produce similar outputs, and `Math.abs(hash)` causes
 * collisions at 0 when the integer wraps negative.
 *
 * The finalizer (bit mixing) ensures:
 * - Good avalanche: 1-bit input change → ~50% output bits flip
 * - No Math.abs collision at 0 (uses `>>> 0` for unsigned result)
 * - All hash modes benefit since they all call this function
 */
export function djb2Hash(str: string, seed: number = 5381): number {
	let hash = seed;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) + hash + str.charCodeAt(i);
		hash = hash & hash; // Keep as 32-bit int
	}
	// MurmurHash3 fmix32-inspired finalizer for avalanche
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b) >>> 0;
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
	hash ^= hash >>> 16;
	return hash >>> 0; // Always positive unsigned 32-bit
}

// ============================================================================
// Hash mode functions (pure, extracted from main.ts)
// ============================================================================

export function hashStrictFull(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const acronyms = words.map((word) => word.charAt(0)).join("");
	const str = acronyms + text + text.length.toString();
	return djb2Hash(str, seed);
}

export function hashStrictAcronym(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const acronyms = words.map((word) => word.charAt(0)).join("");
	return djb2Hash(acronyms, seed);
}

export function hashStrictFirstLast(text: string, seed: number): number {
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

export function hashStrictFirstTwoLastTwo(text: string, seed: number): number {
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

export function hashVowelConsonant(text: string, seed: number): number {
	const vowels = new Set(["a", "e", "i", "o", "u"]);
	const words = text.split(/\s+/).filter(Boolean);
	const pattern = words
		.map((word) => {
			return Array.from(word)
				.map((char) => (vowels.has(char) ? "V" : "C"))
				.join("");
		})
		.join("|");
	const lengthInfo = words.map((w) => w.length.toString()).join(",");
	return djb2Hash(pattern + ":" + lengthInfo, seed);
}

export function hashPositionWeighted(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	let weightedSum = 0;

	for (const word of words) {
		const len = word.length;
		if (len === 0) continue;

		for (let i = 0; i < len; i++) {
			const distFromEdge = Math.min(i, len - 1 - i);
			const weight = distFromEdge === 0 ? 4 : distFromEdge === 1 ? 2 : 1;
			weightedSum += word.charCodeAt(i) * weight;
		}
		weightedSum += len * 1000;
	}

	return djb2Hash(weightedSum.toString() + text, seed);
}

export function hashWordBoundaryNgrams(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const trigrams: string[] = [];

	for (const word of words) {
		if (word.length < 3) {
			trigrams.push(word);
		} else {
			for (let i = 0; i <= word.length - 3; i++) {
				trigrams.push(word.substring(i, i + 3));
			}
		}
	}

	if (trigrams.length === 0) return djb2Hash(text, seed);

	const signature = trigrams.join("|") + ":" + words.length.toString();
	return djb2Hash(signature, seed);
}

export function hashLengthMiddle(text: string, seed: number): number {
	const words = text.split(/\s+/).filter(Boolean);
	const signature = words
		.map((word) => {
			const len = word.length;
			if (len === 0) return "0";
			if (len === 1) return "1" + word + word;
			if (len === 2) return "2" + word;

			const first = word.charAt(0);
			const last = word.charAt(len - 1);

			let middle: string;
			if (len === 3) {
				middle = word.charAt(1);
			} else if (len % 2 === 0) {
				const mid = len / 2;
				middle = word.substring(mid - 1, mid + 1);
			} else {
				const mid = Math.floor(len / 2);
				middle = word.charAt(mid);
			}

			return len.toString() + first + middle + last;
		})
		.join("");

	return djb2Hash(signature, seed);
}

export function extractBigrams(text: string): string[] {
	const bigrams: string[] = [];
	for (let i = 0; i < text.length - 1; i++) {
		bigrams.push(text.substring(i, i + 2));
	}
	return bigrams;
}

export function hashSimilarity(text: string, seed: number): number {
	const bigrams = extractBigrams(text);
	if (bigrams.length === 0) return djb2Hash(text, seed);

	let hash = seed;
	for (const bigram of bigrams) {
		hash = (hash << 5) + hash + bigram.charCodeAt(0);
		hash = (hash << 5) + hash + bigram.charCodeAt(1);
		hash = hash & hash;
	}
	// Apply same avalanche finalizer
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b) >>> 0;
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
	hash ^= hash >>> 16;
	return hash >>> 0;
}

// ============================================================================
// Color math (pure functions)
// ============================================================================

export function rgbToHsl(
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

export function hslToRgb(
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

export function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) => {
		const hex = n.toString(16);
		return hex.length === 1 ? "0" + hex : hex;
	};
	return "#" + toHex(r) + toHex(g) + toHex(b);
}

export interface ColorVariantSettings {
	darkSaturationMin: number;
	darkSaturationMax: number;
	darkLightnessMin: number;
	darkLightnessMax: number;
	lightSaturationMin: number;
	lightSaturationMax: number;
	lightLightnessMin: number;
	lightLightnessMax: number;
}

export function applyAggressiveVariant(
	baseColor: string,
	variantSeed: number,
	usageCount: number,
	isDarkMode: boolean,
	settings: ColorVariantSettings,
): string {
	const hex = baseColor.replace("#", "");
	const r = parseInt(hex.substring(0, 2), 16);
	const g = parseInt(hex.substring(2, 4), 16);
	const b = parseInt(hex.substring(4, 6), 16);
	const hsl = rgbToHsl(r, g, b);

	// Seed-based deterministic random
	const rand = (n: number) =>
		Math.abs(((variantSeed >> n) ^ (variantSeed << (n % 13))) & 0xffff) /
		0xffff;

	// Usage-based spread: creates a "fan" effect around the base color
	const cappedUsageCount = Math.min(usageCount, 6);
	const spreadDirection = cappedUsageCount % 2 === 0 ? 1 : -1;
	const spreadMagnitude = Math.ceil(cappedUsageCount / 2) * 15;

	const randomHueNoise = (rand(3) - 0.5) * 20;
	const effectiveSpread = Math.min(spreadMagnitude, 60) * spreadDirection;
	hsl.h = (hsl.h + effectiveSpread + randomHueNoise + 360) % 360;

	// Saturation: mode-specific ranges from settings
	if (isDarkMode) {
		const satRange = settings.darkSaturationMax - settings.darkSaturationMin;
		const satNoise = (rand(5) - 0.5) * (satRange * 0.3);
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

	// Lightness: mode-specific ranges from settings
	if (isDarkMode) {
		const lightRange = settings.darkLightnessMax - settings.darkLightnessMin;
		const lightTarget =
			(settings.darkLightnessMin + settings.darkLightnessMax) / 2;
		const lightNoise = (rand(7) - 0.5) * (lightRange * 0.2);
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

// ============================================================================
// Bug 1 & 2: Load balancing with hash-mode-isolated usage map
// ============================================================================

export type ColorUsageMap = Map<string, number>;

/** Threshold for normalizing color usage counts (prevents unbounded growth) */
export const COLOR_USAGE_NORMALIZE_THRESHOLD = 50;

/**
 * Normalize color usage counts when they grow too large.
 * Now accepts the usage map as a parameter (Bug 1 & 2 fix).
 */
export function normalizeColorUsage(
	usageMap: ColorUsageMap,
	palette: string,
	hashMode: string,
	isDarkMode: boolean,
	seed: number,
	paletteSize: number,
): void {
	let minUsage = Number.MAX_SAFE_INTEGER;

	for (let i = 0; i < paletteSize; i++) {
		const key = `${palette}-${hashMode}-${isDarkMode ? "dark" : "light"}-${seed}-${i}`;
		const usage = usageMap.get(key) || 0;
		minUsage = Math.min(minUsage, usage);
	}

	if (minUsage < COLOR_USAGE_NORMALIZE_THRESHOLD) return;

	for (let i = 0; i < paletteSize; i++) {
		const key = `${palette}-${hashMode}-${isDarkMode ? "dark" : "light"}-${seed}-${i}`;
		const usage = usageMap.get(key);
		if (usage !== undefined) {
			usageMap.set(key, usage - minUsage);
		}
	}
}

/**
 * Bug 3 fix: Load-balancing with improved tiebreaker.
 *
 * Selects a palette index using load balancing (prefer least-used colors)
 * with a secondary-hash tiebreaker to avoid deterministic convergence.
 *
 * Bug 1 fix: key format includes hashMode so different modes don't share counters.
 * Bug 2 fix: accepts an isolated usageMap parameter for smart mode evaluation.
 */
export function selectPaletteIndexWithLoadBalancing(
	usageMap: ColorUsageMap,
	hash: number,
	palette: string,
	hashMode: string,
	isDarkMode: boolean,
	seed: number,
	paletteSize: number,
): number {
	let bestIndex = -1;
	let minUsage = Number.MAX_SAFE_INTEGER;
	const candidates: number[] = [];

	// Randomized start point based on hash
	const startOffset = hash % paletteSize;

	for (let i = 0; i < paletteSize; i++) {
		const idx = (startOffset + i) % paletteSize;
		const key = `${palette}-${hashMode}-${isDarkMode ? "dark" : "light"}-${seed}-${idx}`;
		const usage = usageMap.get(key) || 0;

		if (usage < minUsage) {
			minUsage = usage;
			candidates.length = 0;
			candidates.push(idx);
		} else if (usage === minUsage) {
			candidates.push(idx);
		}
	}

	// Bug 3 fix: Use a secondary hash for tiebreaking instead of primary hash
	// This prevents deterministic convergence where all tied links always
	// pick the same palette index
	if (candidates.length === 1) {
		bestIndex = candidates[0]!;
	} else {
		const tiebreakerHash = djb2Hash(
			String(hash) + "|" + String(candidates.length),
			seed,
		);
		bestIndex = candidates[Math.abs(tiebreakerHash) % candidates.length]!;
	}

	// Register usage with hash-mode-isolated key
	const selectedKey = `${palette}-${hashMode}-${isDarkMode ? "dark" : "light"}-${seed}-${bestIndex}`;
	const currentUsageCount = usageMap.get(selectedKey) || 0;
	usageMap.set(selectedKey, currentUsageCount + 1);

	// Normalize usage counts
	normalizeColorUsage(usageMap, palette, hashMode, isDarkMode, seed, paletteSize);

	return bestIndex;
}

// ============================================================================
// Bug 5: Cache key builder (includes darkModeRevision)
// ============================================================================

/**
 * Build a cache key for the textColorMap.
 * Includes darkModeRevision to force cache invalidation on theme switches.
 */
export function buildCacheKey(
	palette: string,
	isDarkMode: boolean,
	darkModeRevision: number,
	seed: number,
	rangeKey: string,
	modeKey: string,
	cleanedText: string,
): string {
	return `${palette}-${isDarkMode ? "dark" : "light"}-r${darkModeRevision}-${seed}-${rangeKey}-${modeKey}-${cleanedText}`;
}