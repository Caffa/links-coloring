/**
 * Pure collision statistics aggregation.
 * Obsidian-free module used by the collision modal and tests.
 */

/**
 * Extract the actual link text from a cache key.
 * Cache key format: {palette}-{dark/light}-r{revision}-{seed}-{rangeKey}-{modeKey}-{cleanedText}
 * The cleanedText is everything after the modeKey (which follows the rangeKey).
 */
export function extractLinkTextFromCacheKey(cacheKey: string): string {
	const knownModes = ["strict-full", "strict-acronym", "phonetic-ipa", "random"];

	for (const mode of knownModes) {
		const idx = cacheKey.indexOf(mode);
		if (idx !== -1) {
			const afterMode = cacheKey.substring(idx + mode.length);
			return afterMode.startsWith("-") ? afterMode.substring(1) : afterMode;
		}
	}

	return cacheKey;
}

/**
 * Common file extensions that should NOT be treated as stripped content.
 */
export const COMMON_EXTENSIONS = new Set([
	"md", "markdown", "txt", "pdf", "doc", "docx", "canvas",
	"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp",
	"mp3", "mp4", "wav", "ogg", "webm",
	"json", "yaml", "yml", "xml", "html", "css", "js", "ts",
]);

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

export interface CollisionStatsResult {
	stats: ColorStats[];
	linksByColor: Map<string, LinkColorData[]>;
	totalLinks: number;
}

/**
 * Aggregate collision statistics from the color map and palette index map.
 * Pure function: produces the same modal output logic independent of UI state.
 */
export function aggregateCollisionStats(
	linkColorMap: Map<string, string>,
	linkPaletteIndexMap: Map<string, number>,
	colorList: string[],
): CollisionStatsResult {
	const stats: ColorStats[] = [];
	const linksByColor = new Map<string, LinkColorData[]>();
	let totalLinks = 0;

	const colorCounts = new Map<number, number>();
	for (let i = 0; i < colorList.length; i++) {
		colorCounts.set(i, 0);
	}

	const variantsPerColor = new Map<number, Set<string>>();

	linkColorMap.forEach((color, cacheKey) => {
		const linkText = extractLinkTextFromCacheKey(cacheKey);
		const paletteIndex = linkPaletteIndexMap.get(cacheKey);
		if (paletteIndex !== undefined && paletteIndex < colorList.length) {
			const currentCount = colorCounts.get(paletteIndex) ?? 0;
			colorCounts.set(paletteIndex, currentCount + 1);
			totalLinks++;

			if (!variantsPerColor.has(paletteIndex)) {
				variantsPerColor.set(paletteIndex, new Set());
			}
			variantsPerColor.get(paletteIndex)?.add(color.toLowerCase());

			const baseColor = colorList[paletteIndex];
			if (baseColor && !linksByColor.has(baseColor)) {
				linksByColor.set(baseColor, []);
			}
			if (baseColor) {
				linksByColor.get(baseColor)?.push({
					linkText,
					color,
					paletteIndex,
				});
			}
		}
	});

	stats.push(
		...Array.from(colorCounts.entries())
			.map(([index, count]) => ({
				color: colorList[index]!,
				count,
				percentage: totalLinks > 0 ? (count / totalLinks) * 100 : 0,
				paletteIndex: index,
				uniqueVariants: variantsPerColor.get(index)?.size ?? 0,
			}))
			.sort((a, b) => b.count - a.count),
	);

	linksByColor.forEach((links) => {
		links.sort((a, b) => a.linkText.localeCompare(b.linkText));
	});

	return { stats, linksByColor, totalLinks };
}
