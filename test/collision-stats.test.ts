/**
 * Tests for collision statistics aggregation and the LRU cache used by main.ts.
 */
import { describe, it, expect } from "vitest";
import { LRUCache } from "../src/lru-cache";
import { aggregateCollisionStats, extractLinkTextFromCacheKey } from "../src/collision-stats";

describe("collision-stats: aggregateCollisionStats", () => {
	it("joins color map and index map and counts totalLinks", () => {
		const colorList = ["#ff0000", "#00ff00", "#0000ff"];
		const colorMap = new Map<string, string>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", "#ff0000"],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", "#00ff00"],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-carol", "#0000ff"],
		]);
		const indexMap = new Map<string, number>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", 0],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", 1],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-carol", 2],
		]);

		const result = aggregateCollisionStats(colorMap, indexMap, colorList);
		expect(result.totalLinks).toBe(3);
		expect(result.stats).toHaveLength(3);
		expect(result.stats.find((s) => s.paletteIndex === 0)?.count).toBe(1);
		expect(result.stats.find((s) => s.paletteIndex === 1)?.count).toBe(1);
		expect(result.stats.find((s) => s.paletteIndex === 2)?.count).toBe(1);
	});

	it("ignores index entries missing a color entry", () => {
		const colorList = ["#ff0000", "#00ff00"];
		const colorMap = new Map<string, string>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", "#ff0000"],
		]);
		const indexMap = new Map<string, number>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", 0],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", 1],
		]);

		const result = aggregateCollisionStats(colorMap, indexMap, colorList);
		expect(result.totalLinks).toBe(1);
		expect(result.stats.find((s) => s.paletteIndex === 0)?.count).toBe(1);
		expect(result.stats.find((s) => s.paletteIndex === 1)?.count).toBe(0);
	});

	it("excludes palette indices outside colorList range", () => {
		const colorList = ["#ff0000"];
		const colorMap = new Map<string, string>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", "#ff0000"],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", "#00ff00"],
		]);
		const indexMap = new Map<string, number>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", 0],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", 5],
		]);

		const result = aggregateCollisionStats(colorMap, indexMap, colorList);
		expect(result.totalLinks).toBe(1);
		expect(result.stats).toHaveLength(1);
		expect(result.stats[0].paletteIndex).toBe(0);
	});

	it("returns zero stats for empty maps", () => {
		const colorList = ["#ff0000", "#00ff00"];
		const result = aggregateCollisionStats(new Map(), new Map(), colorList);
		expect(result.totalLinks).toBe(0);
		expect(result.stats).toHaveLength(2);
		expect(result.stats.every((s) => s.count === 0)).toBe(true);
		expect(result.linksByColor.size).toBe(0);
	});

	it("tracks unique variants per palette index", () => {
		const colorList = ["#ff0000", "#00ff00"];
		const colorMap = new Map<string, string>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", "#ff0001"],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", "#FF0002"],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-carol", "#00ff00"],
		]);
		const indexMap = new Map<string, number>([
			["vibrant-dark-r0-1-30-65-50-75-strict-full-alice", 0],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-bob", 0],
			["vibrant-dark-r0-1-30-65-50-75-strict-full-carol", 1],
		]);

		const result = aggregateCollisionStats(colorMap, indexMap, colorList);
		const redStat = result.stats.find((s) => s.paletteIndex === 0)!;
		expect(redStat.uniqueVariants).toBe(2);
		const greenStat = result.stats.find((s) => s.paletteIndex === 1)!;
		expect(greenStat.uniqueVariants).toBe(1);
	});
});

describe("collision-stats: extractLinkTextFromCacheKey", () => {
	it("extracts cleaned text after the hash mode segment", () => {
		expect(
			extractLinkTextFromCacheKey("vibrant-dark-r0-1-30-65-50-75-strict-full-alice"),
		).toBe("alice");
		expect(
			extractLinkTextFromCacheKey("vibrant-light-r1-42-50-95-20-50-strict-acronym-bob"),
		).toBe("bob");
		expect(
			extractLinkTextFromCacheKey("vibrant-dark-r0-1-30-65-50-75-phonetic-ipa-carol"),
		).toBe("carol");
		expect(
			extractLinkTextFromCacheKey("vibrant-dark-r0-1-30-65-50-75-random-dave"),
		).toBe("dave");
	});

	it("preserves multi-segment cleaned text", () => {
		expect(
			extractLinkTextFromCacheKey("vibrant-dark-r0-1-30-65-50-75-strict-full-md---chapter-one"),
		).toBe("md---chapter-one");
	});
});

describe("LRUCache.has() promotes a hit", () => {
	it("promotes a hit so has() and get() evict identically", () => {
		const cache = new LRUCache<string, string>({ maxSize: 2 });
		cache.set("a", "A");
		cache.set("b", "B");
		expect(cache.has("a")).toBe(true); // promote "a" to MRU
		cache.set("c", "C"); // should evict "b", keep "a"
		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
		expect(cache.has("c")).toBe(true);
	});

	it("get- and has-promoted keys evict in the same order", () => {
		const cacheGet = new LRUCache<string, string>({ maxSize: 3 });
		cacheGet.set("a", "A");
		cacheGet.set("b", "B");
		cacheGet.set("c", "C");
		cacheGet.get("a");
		cacheGet.set("d", "D"); // evict b
		expect([...cacheGet.entries()].map(([k]) => k)).toEqual(["c", "a", "d"]);

		const cacheHas = new LRUCache<string, string>({ maxSize: 3 });
		cacheHas.set("a", "A");
		cacheHas.set("b", "B");
		cacheHas.set("c", "C");
		cacheHas.has("a");
		cacheHas.set("d", "D"); // should also evict b
		expect([...cacheHas.entries()].map(([k]) => k)).toEqual(["c", "a", "d"]);
	});
});
