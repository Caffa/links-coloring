/**
 * Stable public API for other Obsidian plugins.
 *
 * Reads are side-effect free: cache hits return the exact on-screen color;
 * misses are computed deterministically from the text hash (what Live Preview
 * will paint first) without touching caches, usage stats, or collision stats.
 */

import {
	computeColorWithoutCaching,
	computeRandomColorWithoutCaching,
	lookupCachedColor,
} from "./color-core";
import { stripPrefix } from "./color-utils";
import { type LinkColorSettings } from "./settings-data";

/** Minimal plugin shape the API needs; keeps this module free of main.ts. */
interface LinkColorPluginLike {
	settings: LinkColorSettings;
	app: {
		workspace: {
			on: (name: string, callback: (...args: unknown[]) => void | Promise<void>) => unknown;
			offref: (eventRef: unknown) => void;
			trigger: (name: string, payload: unknown) => void;
		};
	};
	registerEvent: (eventRef: unknown) => void;
}

export interface LinkColorerApi {
	/** API version. Bumps only on breaking changes. */
	version: 1;

	/** True once the host plugin has finished loading settings. */
	isReady(): boolean;

	/**
	 * Return the hex color (#rrggbb) for this link text.
	 *
	 * Exact for links Link Colorer has already colored (cache hit). On a cache
	 * miss, the color is computed deterministically from the text hash
	 * (`hash % paletteSize`, no load balancing or usage dependency), matching
	 * what Live Preview will paint first. API calls never mutate caches, usage
	 * stats, or collision statistics.
	 *
	 * Returns null for empty/whitespace input, missing settings, or any
	 * unexpected failure.
	 */
	getColorForLink(text: string): string | null;

	/**
	 * Batch convenience: returns a map of text -> color (or null).
	 *
	 * Each requested text is mapped through getColorForLink, so a disposed or
	 * unloaded API yields per-text nulls. Only invalid input (non-array)
	 * returns {}.
	 */
	getColorsForLinks(texts: string[]): Record<string, string | null>;

	/**
	 * Register a callback that runs whenever colors are recalculated.
	 * The callback is registered with the plugin so it is cleaned up on unload.
	 *
	 * Returns an unsubscribe function that removes just this callback (safe to
	 * call more than once). Call it before re-registering to avoid stacking
	 * duplicate handlers. Callers that ignore the return value keep working;
	 * the handler is still cleaned up automatically on plugin unload.
	 */
	onRecolor(cb: () => void | Promise<void>): () => void;
}

/** Null-object API returned by getApi() before the plugin has loaded. */
const stubApiSingleton: LinkColorerApi = {
	version: 1,
	isReady: () => false,
	getColorForLink: () => null,
	getColorsForLinks: (texts) => {
		const result: Record<string, string | null> = {};
		for (const text of texts) {
			result[text] = null;
		}
		return result;
	},
	onRecolor: () => () => {},
};

export function createStubApi(): LinkColorerApi {
	return stubApiSingleton;
}

const apiStates = new WeakMap<LinkColorerApi, { disposed: boolean }>();

/** Mark a real public API as disposed so stale references become inert. */
export function disposeApi(api: LinkColorerApi): void {
	const state = apiStates.get(api);
	if (state) state.disposed = true;
}

function isDarkMode(): boolean {
	if (typeof document === "undefined") return false;
	return document.body.classList.contains("theme-dark");
}

function getPluginSettings(plugin: LinkColorPluginLike): LinkColorSettings | null {
	const settings = plugin.settings;
	if (!settings) return null;
	return settings;
}

/** Fire the public recolor event with a stable payload shape. */
export function emitRecolorEvent(
	plugin: LinkColorPluginLike,
	reason: 'settings' | 'reroll' | 'auto-reroll',
): void {
	plugin.app.workspace.trigger('link-colorer:recolor', { reason });
}

/**
 * Create the public API bound to a loaded plugin instance.
 *
 * The same object is returned by `plugin.getApi()` and assigned to
 * `window.linkColorerApi` during `onload`; it is removed on `onunload`.
 */
export function createPublicApi(plugin: LinkColorPluginLike): LinkColorerApi {
	const state = { disposed: false };
	const api: LinkColorerApi = {
		version: 1,

		isReady() {
			return !state.disposed && getPluginSettings(plugin) !== null;
		},

		getColorForLink(text: string): string | null {
			try {
				if (state.disposed) return null;
				if (typeof text !== "string") return null;
				const trimmed = text.trim();
				if (trimmed.length === 0) return null;

				const settings = getPluginSettings(plugin);
				if (!settings) return null;

				const isDark = isDarkMode();

				// Cache hit: exact on-screen color, no mutation.
				const cached = lookupCachedColor(text, settings, isDark);
				if (cached !== undefined) return cached;

				// Cache miss: predict Live Preview's first paint deterministically.
				let workingText = text;
				if (settings.ignorePrefix) {
					const stripped = stripPrefix(workingText);
					if (stripped !== null) workingText = stripped;
				}
				const cleaned = workingText.trim().toLowerCase();

				if (settings.hashMode === "random") {
					return computeRandomColorWithoutCaching(
						cleaned,
						settings,
						isDark,
						settings.customSeed,
					).color;
				}
				return computeColorWithoutCaching(
					cleaned,
					settings,
					isDark,
					settings.customSeed,
				).color;
			} catch (error) {
				console.warn("[Link Colorer] public API getColorForLink failed:", error);
				return null;
			}
		},

		getColorsForLinks(texts: string[]): Record<string, string | null> {
			const result: Record<string, string | null> = {};
			try {
				if (!Array.isArray(texts)) return result;
				for (const text of texts) {
					result[text] = api.getColorForLink(text);
				}
			} catch (error) {
				console.warn("[Link Colorer] public API getColorsForLinks failed:", error);
			}
			return result;
		},

		onRecolor(cb: () => void | Promise<void>): () => void {
			const eventRef = plugin.app.workspace.on("link-colorer:recolor", async () => {
				try {
					const maybePromise = cb();
					if (maybePromise && typeof maybePromise.then === "function") {
						await maybePromise;
					}
				} catch (error) {
					console.warn("[Link Colorer] public API recolor callback failed:", error);
				}
			});
			plugin.registerEvent(eventRef);
			return () => plugin.app.workspace.offref(eventRef);
		},
	};

	apiStates.set(api, state);
	return api;
}
