/**
 * Structured logging module for Link Colorer plugin.
 *
 * Designed for mobile debugging where DevTools are unavailable.
 * Uses an in-memory ring buffer so logs never grow unbounded,
 * and supports export to JSON for AI agent review.
 *
 * Categories: lifecycle, render, cache, mutation, settings, performance, mobile, error
 * Levels: debug, info, warn, error
 *
 * When logging is disabled (`loggingEnabled: false`), all method calls
 * become no-ops via a proxy pattern — zero runtime cost.
 */

// --- Types ---

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
	| "lifecycle"
	| "render"
	| "cache"
	| "mutation"
	| "settings"
	| "performance"
	| "mobile"
	| "error";

export interface LogEntry {
	/** Unix timestamp (Date.now()) — compact in memory, ISO on export */
	ts: number;
	/** Log level */
	level: LogLevel;
	/** Category for filtering */
	cat: LogCategory;
	/** Human-readable message */
	msg: string;
	/** Structured payload — must be JSON-serializable, no circular refs */
	data?: Record<string, unknown>;
	/** Duration in ms (for timed operations) */
	durMs?: number;
}

export interface LogExport {
	metadata: {
		pluginVersion: string;
		platform: string;
		userAgent: string;
		obsidianVersion: string;
		viewport: { width: number; height: number; dpr: number };
		settings: Record<string, unknown>;
		logLevel: LogLevel;
		logCategories: LogCategory[];
		logMaxEntries: number;
		exportedAt: string;
		isMobile?: boolean;
	};
	logs: LogEntry[];
}

// --- Level priority map ---

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const ALL_CATEGORIES: LogCategory[] = [
	"lifecycle",
	"render",
	"cache",
	"mutation",
	"settings",
	"performance",
	"mobile",
	"error",
];

// --- Null logger (zero-cost no-op when disabled) ---

const NOOP_LOGGER = {
	log: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	time: () => {},
	timeEnd: () => {},
	getEntries: () => [] as LogEntry[],
	getStats: () =>
		({
			totalEntries: 0,
			byLevel: {},
			byCategory: {},
			cacheHitRate: null,
		}) as LogStats,
	clear: () => {},
	export: () =>
		({
			metadata: {
				pluginVersion: "0",
				platform: "unknown",
				userAgent: "",
				obsidianVersion: "",
				viewport: { width: 0, height: 0, dpr: 1 },
				settings: {},
				logLevel: "info",
				logCategories: [],
				logMaxEntries: 0,
				exportedAt: "",
				isMobile: false,
			},
			logs: [],
		}) as LogExport,
	setSettings: () => {},
};

// --- Stats type ---

export interface LogStats {
	totalEntries: number;
	byLevel: Record<LogLevel, number>;
	byCategory: Record<LogCategory, number>;
	/** Percentage of cache hits (null if no cache entries were logged) */
	cacheHitRate: number | null;
}

// --- Real logger ---

class LinkColorLogger {
	private entries: LogEntry[] = [];
	private maxEntries: number;
	private minLevel: LogLevel;
	private enabledCategories: Set<LogCategory>;
	enabled: boolean; // Public so proxy can check it

	// Timing map: key = "cat:label" -> start timestamp
	private timers: Map<string, number> = new Map();

	// Cache stats tracking
	private cacheHits = 0;
	private cacheMisses = 0;

	// Plugin metadata (set once during onload)
		private pluginVersion = "unknown";
	private platform = "unknown";
	private userAgent = "";
	private obsidianVersion = "unknown";
	private viewport = { width: 0, height: 0, dpr: 1 };
	private settingsSnapshot: Record<string, unknown> = {};
	private _isMobile = false;

	constructor() {
		this.enabled = false;
		this.maxEntries = 500;
		this.minLevel = "info";
		this.enabledCategories = new Set(ALL_CATEGORIES);
	}

	setSettings(opts: {
		enabled?: boolean;
		maxEntries?: number;
		minLevel?: LogLevel;
		categories?: LogCategory[];
	}) {
		if (opts.enabled !== undefined) this.enabled = opts.enabled;
		if (opts.maxEntries !== undefined) this.maxEntries = opts.maxEntries;
		if (opts.minLevel !== undefined) this.minLevel = opts.minLevel;
		if (opts.categories !== undefined) {
			this.enabledCategories = new Set(opts.categories);
		}
	}

	/** Set plugin metadata for export headers */
	setMetadata(meta: {
		pluginVersion: string;
		platform: string;
		userAgent: string;
		obsidianVersion: string;
		viewport: { width: number; height: number; dpr: number };
		settings: Record<string, unknown>;
		isMobile?: boolean;
	}) {
		this.pluginVersion = meta.pluginVersion;
		this.platform = meta.platform;
		this.userAgent = meta.userAgent;
		this.obsidianVersion = meta.obsidianVersion;
		this.viewport = meta.viewport;
		this.settingsSnapshot = meta.settings;
		if (meta.isMobile !== undefined) this._isMobile = meta.isMobile;
	}

	private shouldLog(level: LogLevel, cat: LogCategory): boolean {
		if (!this.enabled) return false;
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return false;
		if (!this.enabledCategories.has(cat)) return false;
		return true;
	}

	private push(entry: LogEntry) {
		this.entries.push(entry);
		// Ring buffer: evict oldest when over capacity
		if (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}
	}

	log(level: LogLevel, cat: LogCategory, msg: string, data?: Record<string, unknown>, durMs?: number) {
		if (!this.shouldLog(level, cat)) return;
		this.push({ ts: Date.now(), level, cat, msg, data, durMs });
	}

	debug(cat: LogCategory, msg: string, data?: Record<string, unknown>) {
		this.log("debug", cat, msg, data);
	}

	info(cat: LogCategory, msg: string, data?: Record<string, unknown>) {
		this.log("info", cat, msg, data);
	}

	warn(cat: LogCategory, msg: string, data?: Record<string, unknown>) {
		this.log("warn", cat, msg, data);
	}

	error(cat: LogCategory, msg: string, data?: Record<string, unknown>) {
		this.log("error", cat, msg, data);
	}

	/** Start a named timer. Use timeEnd with the same label to log duration. */
	time(cat: LogCategory, label: string) {
		if (!this.enabled) return;
		this.timers.set(`${cat}:${label}`, performance.now());
	}

	/** End a named timer and log the duration. */
	timeEnd(cat: LogCategory, label: string, msg?: string) {
		if (!this.enabled) return;
		const key = `${cat}:${label}`;
		const start = this.timers.get(key);
		if (start === undefined) {
			this.warn("performance", `Timer "${label}" was never started`);
			return;
		}
		this.timers.delete(key);
		const durMs = Math.round((performance.now() - start) * 100) / 100;
		this.log(
			durMs > 100 ? "warn" : "debug",
			cat,
			msg ?? `${label} completed`,
			undefined,
			durMs,
		);
	}

	/** Convenience: track cache hit/miss ratio */
	recordCacheHit(hit: boolean) {
		if (!this.enabled) return;
		if (hit) {
			this.cacheHits++;
		} else {
			this.cacheMisses++;
		}
	}

	getEntries(): LogEntry[] {
		return [...this.entries];
	}

	getStats(): LogStats {
		const byLevel: Record<LogLevel, number> = {
			debug: 0,
			info: 0,
			warn: 0,
			error: 0,
		};
		const byCategory: Record<LogCategory, number> = {
			lifecycle: 0,
			render: 0,
			cache: 0,
			mutation: 0,
			settings: 0,
			performance: 0,
			mobile: 0,
			error: 0,
		};

		for (const entry of this.entries) {
			byLevel[entry.level]++;
			byCategory[entry.cat]++;
		}

		const totalCacheOps = this.cacheHits + this.cacheMisses;
		return {
			totalEntries: this.entries.length,
			byLevel,
			byCategory,
			cacheHitRate:
				totalCacheOps > 0
					? Math.round((this.cacheHits / totalCacheOps) * 100)
					: null,
		};
	}

	clear() {
		this.entries = [];
		this.cacheHits = 0;
		this.cacheMisses = 0;
		this.timers.clear();
	}

	export(): LogExport {
		return {
			metadata: {
				pluginVersion: this.pluginVersion,
				platform: this.platform,
				userAgent: this.userAgent,
				obsidianVersion: this.obsidianVersion,
				viewport: { ...this.viewport },
				settings: { ...this.settingsSnapshot },
				logLevel: this.minLevel,
				logCategories: [...this.enabledCategories],
				logMaxEntries: this.maxEntries,
				exportedAt: new Date().toISOString(),
				isMobile: this._isMobile,
			},
			logs: this.entries.map((e) => ({
				...e,
				// Convert timestamp to ISO string for readability
				ts: e.ts,
			})),
		};
	}
}

// --- Singleton export ---

const realLogger = new LinkColorLogger();

/**
 * The global logger instance.
 * When logging is disabled, calls become no-ops (zero runtime cost).
 * When enabled, calls are forwarded to the real logger.
 *
 * Usage:
 *   import { log } from "./logger";
 *   log.info("render", "Building decorations", { linkCount: 14 });
 *   log.recordCacheHit(true);
 *   log.time("performance", "buildDecorations");
 *   log.timeEnd("performance", "buildDecorations", "Done");
 */
export const log: LinkColorLogger & {
	setSettings: (opts: {
		enabled?: boolean;
		maxEntries?: number;
		minLevel?: LogLevel;
		categories?: LogCategory[];
	}) => void;
	setMetadata: (meta: {
		pluginVersion: string;
		platform: string;
		userAgent: string;
		obsidianVersion: string;
		viewport: { width: number; height: number; dpr: number };
		settings: Record<string, unknown>;
		isMobile?: boolean;
	}) => void;
} = new Proxy(realLogger, {
	get(_target, prop) {
		// Always delegate these methods regardless of enabled state
		// (they handle their own enabled checks internally)
		if (prop === "setSettings" || prop === "setMetadata" || prop === "clear" || prop === "export" || prop === "getStats" || prop === "getEntries") {
			return (realLogger as any)[prop];
		}
		// For logging methods, check enabled state for zero-cost when disabled
		if (!realLogger["enabled"]) {
			return () => {};
		}
		return (realLogger as any)[prop];
	},
}) as any;

// Export the class and types for direct use if needed
export { LinkColorLogger };
export { ALL_CATEGORIES };