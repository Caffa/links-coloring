/**
 * Tests for the stable public API exposed to other plugins.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPublicApi, createStubApi, disposeApi, emitRecolorEvent, type LinkColorerApi } from "../src/public-api";
import { DEFAULT_SETTINGS, type LinkColorSettings } from "../src/settings-data";
import { buildCacheKey } from "../src/color-utils";
import {
	getColor,
	textColorMap,
	colorUsageMap,
	linkPaletteIndexMap,
	resetDarkModeRevision,
} from "../src/color-core";

const DARK_SETTINGS: LinkColorSettings = {
	...DEFAULT_SETTINGS,
	palette: "vibrant",
	ignorePrefix: true,
	hashMode: "strict-full",
	customSeed: 12345,
};

function makePlugin(settings: LinkColorSettings = DARK_SETTINGS) {
	const registeredEvents: { off: () => void }[] = [];
	const triggeredEvents: { name: string; payload: unknown }[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => void | Promise<void>>>();

	return {
		settings,
		app: {
			workspace: {
				on: (name: string, callback: (...args: unknown[]) => void | Promise<void>) => {
					if (!handlers.has(name)) {
						handlers.set(name, []);
					}
					handlers.get(name)!.push(callback);
					const eventRef = {
						off: () => {
							const list = handlers.get(name) ?? [];
							const idx = list.indexOf(callback);
							if (idx !== -1) list.splice(idx, 1);
						},
					};
					registeredEvents.push(eventRef);
					return eventRef as unknown;
				},
				trigger: (name: string, payload: unknown) => {
					triggeredEvents.push({ name, payload });
					for (const cb of handlers.get(name) ?? []) {
						cb(payload);
					}
				},
				offref: (eventRef: unknown) => {
					(eventRef as { off: () => void }).off();
				},
			},
		},
		registerEvent: (eventRef: unknown) => {
			registeredEvents.push(eventRef as { off: () => void });
		},
		_registeredEvents: registeredEvents,
		_triggeredEvents: triggeredEvents,
		_handlers: handlers,
	};
}

type TestPlugin = ReturnType<typeof makePlugin>;

function setDarkMode(isDark = true) {
	// @ts-expect-error - minimal document stub for unit tests
	global.document = {
		body: {
			classList: {
				contains: (cls: string) => (cls === "theme-dark" ? isDark : false),
			},
		},
	};
}

function clearDocument() {
	// @ts-expect-error
	delete global.document;
}

describe("public API", () => {
	beforeEach(() => {
		textColorMap.clear();
		colorUsageMap.clear();
		linkPaletteIndexMap.clear();
		resetDarkModeRevision();
		setDarkMode(true);
	});

	afterEach(() => {
		clearDocument();
	});

	it("stub API is not ready and returns null", () => {
		const stub = createStubApi();
		expect(stub.version).toBe(1);
		expect(stub.isReady()).toBe(false);
		expect(stub.getColorForLink("anything")).toBeNull();
		expect(stub.getColorsForLinks(["a", "b"])).toEqual({ a: null, b: null });
	});

	it("returns a deterministic hex color for a text", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);
		expect(api.isReady()).toBe(true);

		const color = api.getColorForLink("Char - B");
		expect(color).toMatch(/^#[0-9a-f]{6}$/);

		const second = api.getColorForLink("Char - B");
		expect(second).toBe(color);
	});

	it("returns the cached color on a hit without growing the cache", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		// Seed the cache via the renderer path.
		getColor("Chapter - Alpha", DARK_SETTINGS, true, true);
		const firstSize = textColorMap.size;
		expect(firstSize).toBeGreaterThan(0);

		const apiColor = api.getColorForLink("Chapter - Alpha");
		expect(apiColor).toMatch(/^#[0-9a-f]{6}$/);

		api.getColorForLink("Chapter - Alpha");
		expect(textColorMap.size).toBe(firstSize);
		expect(linkPaletteIndexMap.size).toBe(firstSize);
	});

	it("batch map matches individual calls", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);
		const texts = ["Alice", "Bob", "Char - C"];

		const singles = Object.fromEntries(texts.map((t) => [t, api.getColorForLink(t)]));
		const batch = api.getColorsForLinks(texts);

		expect(batch).toEqual(singles);
	});

	it("returns null for empty or whitespace input", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		expect(api.getColorForLink("")).toBeNull();
		expect(api.getColorForLink("   ")).toBeNull();
		expect(api.getColorForLink("\t\n")).toBeNull();
	});

	it("version is 1", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);
		expect(api.version).toBe(1);
	});

	it("converges with renderer cache key format", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		// Populate the cache via the renderer path (the same key the API looks up).
		getColor("MD - Chapter One", DARK_SETTINGS, true, true);

		// Build the expected key exactly as the renderer does.
		const seed = DARK_SETTINGS.customSeed;
		const rangeKey = `${DARK_SETTINGS.darkSaturationMin}-${DARK_SETTINGS.darkSaturationMax}-${DARK_SETTINGS.darkLightnessMin}-${DARK_SETTINGS.darkLightnessMax}`;
		const expectedKey = buildCacheKey(
			DARK_SETTINGS.palette,
			true,
			0,
			seed,
			rangeKey,
			DARK_SETTINGS.hashMode,
			"chapter one",
		);

		expect(textColorMap.has(expectedKey)).toBe(true);
		expect(linkPaletteIndexMap.has(expectedKey)).toBe(true);

		const apiColor = api.getColorForLink("MD - Chapter One");
		expect(apiColor).toBe(textColorMap.get(expectedKey));
	});

	it("random mode returns the exact cached renderer color on a hit", () => {
		const settings: LinkColorSettings = { ...DARK_SETTINGS, hashMode: "random" };
		const plugin = makePlugin(settings);
		const api = createPublicApi(plugin);

		// Seed the cache via the renderer path (random mode).
		getColor("MD - Random One", settings, true, true);

		// Build the expected key exactly as the random renderer does.
		const seed = settings.customSeed;
		const rangeKey = `${settings.darkSaturationMin}-${settings.darkSaturationMax}-${settings.darkLightnessMin}-${settings.darkLightnessMax}`;
		const expectedKey = buildCacheKey(
			settings.palette,
			true,
			0,
			seed,
			rangeKey,
			"random",
			"random one",
		);

		expect(textColorMap.has(expectedKey)).toBe(true);
		expect(linkPaletteIndexMap.has(expectedKey)).toBe(true);

		const apiColor = api.getColorForLink("MD - Random One");
		expect(apiColor).toBe(textColorMap.get(expectedKey));
	});

	it("cache miss does not mutate caches, usage stats, or collision stats", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		const color = api.getColorForLink("Never Colored Before");
		expect(color).toMatch(/^#[0-9a-f]{6}$/);

		expect(textColorMap.size).toBe(0);
		expect(linkPaletteIndexMap.size).toBe(0);
		expect(colorUsageMap.size).toBe(0);

		// Batch calls must stay side-effect free too.
		api.getColorsForLinks(["Alice", "Bob"]);
		expect(textColorMap.size).toBe(0);
		expect(linkPaletteIndexMap.size).toBe(0);
		expect(colorUsageMap.size).toBe(0);
	});

	it("getColorsForLinks works when destructured from the api object", () => {
		const plugin = makePlugin();
		const { getColorsForLinks } = createPublicApi(plugin);

		const result = getColorsForLinks(["Alice"]);
		expect(result.Alice).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("is not ready and returns null when the plugin has no settings", () => {
		const plugin = makePlugin();
		plugin.settings = null as unknown as LinkColorSettings;
		const api = createPublicApi(plugin);

		expect(api.isReady()).toBe(false);
		expect(api.getColorForLink("Alice")).toBeNull();
		expect(api.getColorsForLinks(["Alice"])).toEqual({ Alice: null });
	});

	it("disposed api stops answering and reports not ready", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);
		expect(api.isReady()).toBe(true);

		disposeApi(api);

		expect(api.isReady()).toBe(false);
		expect(api.getColorForLink("Alice")).toBeNull();
		// Consistent with the pre-onload stub: each requested text maps to null.
		expect(api.getColorsForLinks(["Alice"])).toEqual({ Alice: null });
	});

	it("onRecolor registers a workspace callback via the plugin", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		const cb = vi.fn();
		api.onRecolor(cb);

		expect(plugin._registeredEvents.length).toBeGreaterThan(0);

		plugin.app.workspace.trigger("link-colorer:recolor", { reason: "reroll" });
		expect(cb).toHaveBeenCalledTimes(1);

		plugin.app.workspace.trigger("link-colorer:recolor", { reason: "settings" });
		expect(cb).toHaveBeenCalledTimes(2);
	});

	it("onRecolor returns an unsubscribe function that removes just that callback", () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		const cb = vi.fn();
		const unsubscribe = api.onRecolor(cb);
		expect(typeof unsubscribe).toBe("function");

		plugin.app.workspace.trigger("link-colorer:recolor", { reason: "settings" });
		expect(cb).toHaveBeenCalledTimes(1);

		unsubscribe();
		plugin.app.workspace.trigger("link-colorer:recolor", { reason: "reroll" });
		expect(cb).toHaveBeenCalledTimes(1);

		// Idempotent: unsubscribing twice must not throw.
		unsubscribe();
	});

	it("onRecolor handles async callbacks", async () => {
		const plugin = makePlugin();
		const api = createPublicApi(plugin);

		let resolved = false;
		api.onRecolor(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			resolved = true;
		});

		plugin.app.workspace.trigger("link-colorer:recolor", { reason: "settings" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(resolved).toBe(true);
	});
});

describe("emitRecolorEvent", () => {
	it("fires link-colorer:recolor with the given reason", () => {
		const plugin = makePlugin();

		emitRecolorEvent(plugin, 'settings');
		expect(plugin._triggeredEvents).toContainEqual({
			name: "link-colorer:recolor",
			payload: { reason: "settings" },
		});

		emitRecolorEvent(plugin, 'reroll');
		expect(plugin._triggeredEvents).toContainEqual({
			name: "link-colorer:recolor",
			payload: { reason: "reroll" },
		});

		emitRecolorEvent(plugin, 'auto-reroll');
		expect(plugin._triggeredEvents).toContainEqual({
			name: "link-colorer:recolor",
			payload: { reason: "auto-reroll" },
		});
	});
});
