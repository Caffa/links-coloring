/**
 * Performance configuration and utilities for Link Colorer plugin.
 * 
 * Centralizes all performance-related settings for easy tuning
 * and provides reusable debounce/throttle helpers.
 * 
 * PERFORMANCE TIERS:
 * - Small vault (< 500 notes): Fast response, minimal caching
 * - Medium vault (500-2000 notes): Balanced
 * - Large vault (2000-5000 notes): Aggressive caching
 * - Very large vault (> 5000 notes): Maximum performance, larger caches
 */

// ============================================================================
// VAULT SIZE DETECTION
// ============================================================================

export type VaultSizeTier = 'small' | 'medium' | 'large' | 'very-large';

export interface VaultSizeInfo {
	tier: VaultSizeTier;
	noteCount: number;
	avgLinksPerNote: number;
	totalUniqueLinks: number;
}

/**
 * Detect vault size tier based on note count.
 */
export function getVaultSizeTier(noteCount: number): VaultSizeTier {
	if (noteCount < 500) return 'small';
	if (noteCount < 2000) return 'medium';
	if (noteCount < 5000) return 'large';
	return 'very-large';
}

/**
 * Get performance tier display name.
 */
export function getTierDisplayName(tier: VaultSizeTier): string {
	switch (tier) {
		case 'small': return 'Small (< 500 notes)';
		case 'medium': return 'Medium (500-2000 notes)';
		case 'large': return 'Large (2000-5000 notes)';
		case 'very-large': return 'Very Large (> 5000 notes)';
	}
}

// ============================================================================
// TIER-SPECIFIC CONFIGURATION
// ============================================================================

export interface PerformanceConfig {
	/** Maximum unique link colors to cache */
	maxCacheSize: number;
	/** Maximum files to track as precomputed */
	maxPrecomputedFiles: number;
	/** Maximum files to track as opened */
	maxOpenedFiles: number;
	/** Debounce delay for file switches (ms) */
	fileSwitchDebounceMs: number;
	/** Debounce delay for mobile (ms) */
	mobileDebounceMs: number;
	/** Cooldown between precomputations for same file (ms) */
	precomputeCooldownMs: number;
	/** How often to run auto-reroll checks (in file switches) */
	autoRerollCheckFrequency: number;
	/** Minimum links before auto-reroll triggers */
	autoRerollMinLinks: number;
	/** Maximum concurrent precomputations */
	maxConcurrentPrecomputes: number;
}

/**
 * Get performance configuration for a given vault size tier.
 */
export function getPerformanceConfig(tier: VaultSizeTier): PerformanceConfig {
	switch (tier) {
		case 'small':
			// Small vaults: minimal caching, fast response
			return {
				maxCacheSize: 2000,
				maxPrecomputedFiles: 50,
				maxOpenedFiles: 100,
				fileSwitchDebounceMs: 50,
				mobileDebounceMs: 100,
				precomputeCooldownMs: 10000, // 10 seconds
				autoRerollCheckFrequency: 3,
				autoRerollMinLinks: 5,
				maxConcurrentPrecomputes: 2,
			};
		
		case 'medium':
			// Medium vaults: balanced performance
			return {
				maxCacheSize: 3500,
				maxPrecomputedFiles: 75,
				maxOpenedFiles: 150,
				fileSwitchDebounceMs: 75,
				mobileDebounceMs: 150,
				precomputeCooldownMs: 20000, // 20 seconds
				autoRerollCheckFrequency: 4,
				autoRerollMinLinks: 8,
				maxConcurrentPrecomputes: 2,
			};
		
		case 'large':
			// Large vaults: aggressive caching
			return {
				maxCacheSize: 5000,
				maxPrecomputedFiles: 100,
				maxOpenedFiles: 200,
				fileSwitchDebounceMs: 100,
				mobileDebounceMs: 200,
				precomputeCooldownMs: 30000, // 30 seconds
				autoRerollCheckFrequency: 5,
				autoRerollMinLinks: 10,
				maxConcurrentPrecomputes: 3,
			};
		
		case 'very-large':
			// Very large vaults: maximum performance
			return {
				maxCacheSize: 8000,
				maxPrecomputedFiles: 150,
				maxOpenedFiles: 300,
				fileSwitchDebounceMs: 150,
				mobileDebounceMs: 250,
				precomputeCooldownMs: 45000, // 45 seconds
				autoRerollCheckFrequency: 8,
				autoRerollMinLinks: 15,
				maxConcurrentPrecomputes: 4,
			};
	}
}

// ============================================================================
// RUNTIME CONFIGURATION (Updated based on vault size)
// ============================================================================

/**
 * Global performance configuration.
 * Automatically set based on vault size, can be manually overridden.
 */
let currentConfig: PerformanceConfig = getPerformanceConfig('medium');

/**
 * Update performance configuration based on vault size.
 */
export function updatePerformanceConfig(tier: VaultSizeTier): void {
	currentConfig = getPerformanceConfig(tier);
}

/**
 * Get current performance configuration.
 */
export function getCurrentConfig(): PerformanceConfig {
	return { ...currentConfig };
}

/**
 * Manually override specific performance settings.
 */
export function overridePerformanceConfig(overrides: Partial<PerformanceConfig>): void {
	currentConfig = { ...currentConfig, ...overrides };
}

// ============================================================================
// CONFIGURABLE LIMITS (Now dynamic)
// ============================================================================

/**
 * Maximum number of unique link colors to cache.
 */
export const MAX_CACHE_SIZE = {
	get current() { return currentConfig.maxCacheSize; }
};

/**
 * Maximum number of files to track as "precomputed".
 */
export const MAX_PRECOMPUTED_FILES = {
	get current() { return currentConfig.maxPrecomputedFiles; }
};

/**
 * Maximum number of files to track as "opened".
 */
export const MAX_OPENED_FILES = {
	get current() { return currentConfig.maxOpenedFiles; }
};

/**
 * Debounce delay for file switches (milliseconds).
 */
export const FILE_SWITCH_DEBOUNCE_MS = {
	get current() { return currentConfig.fileSwitchDebounceMs; }
};

/**
 * Debounce delay for mobile interactions (milliseconds).
 */
export const MOBILE_DEBOUNCE_MS = {
	get current() { return currentConfig.mobileDebounceMs; }
};

/**
 * Cooldown between precomputations for the same file (milliseconds).
 */
export const PRECOMPUTE_COOLDOWN_MS = {
	get current() { return currentConfig.precomputeCooldownMs; }
};

/**
 * How often to run auto-reroll checks (in file switches).
 */
export const AUTO_REROLL_CHECK_FREQUENCY = {
	get current() { return currentConfig.autoRerollCheckFrequency; }
};

/**
 * Minimum number of unique links before auto-reroll triggers.
 */
export const AUTO_REROLL_MIN_LINKS = {
	get current() { return currentConfig.autoRerollMinLinks; }
};

/**
 * Maximum number of concurrent precomputations during priority compute.
 */
export const MAX_CONCURRENT_PRECOMPUTES = {
	get current() { return currentConfig.maxConcurrentPrecomputes; }
};

/**
 * Minimum viewport size for decoration rendering.
 */
export const MIN_VIEWPORT_SIZE = 10;

// ============================================================================
// DEBOUNCE UTILITY
// ============================================================================

/**
 * Debounce function calls.
 * 
 * Returns a debounced version that delays invoking the function
 * until after `waitMs` have elapsed since the last call.
 * 
 * @param fn Function to debounce
 * @param waitMs Milliseconds to wait
 * @returns Debounced function with .cancel() method
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	waitMs: number,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
	let timeoutId: number | null = null;

	const debounced = (...args: Parameters<T>) => {
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
		}
		timeoutId = window.setTimeout(() => {
			timeoutId = null;
			fn(...args);
		}, waitMs);
	};

	debounced.cancel = () => {
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	return debounced;
}

/**
 * Throttle function calls.
 * 
 * Returns a throttled version that only invokes the function
 * at most once per `limitMs` milliseconds.
 * 
 * @param fn Function to throttle
 * @param limitMs Minimum time between invocations
 * @returns Throttled function with .cancel() method
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
	fn: T,
	limitMs: number,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
	let inThrottle = false;
	let lastArgs: Parameters<T> | null = null;
	let timeoutId: number | null = null;

	const throttled = (...args: Parameters<T>) => {
		if (!inThrottle) {
			fn(...args);
			inThrottle = true;
			timeoutId = window.setTimeout(() => {
				inThrottle = false;
				if (lastArgs) {
					fn(...lastArgs);
					lastArgs = null;
				}
			}, limitMs);
		} else {
			lastArgs = args;
		}
	};

	throttled.cancel = () => {
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
			timeoutId = null;
		}
		inThrottle = false;
		lastArgs = null;
	};

	return throttled;
}

// ============================================================================
// LIMITED SET UTILITY
// ============================================================================

/**
 * A Set that automatically removes oldest entries when it exceeds maxSize.
 * 
 * Used for tracking openedFiles and precomputedFiles without
 * unbounded memory growth.
 */
export class LimitedSet<T = string> {
	private items: T[] = [];
	private maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	add(item: T): void {
		const index = this.items.indexOf(item);
		if (index !== -1) {
			// Move to end (most recent)
			this.items.splice(index, 1);
			this.items.push(item);
			return;
		}

		this.items.push(item);

		// Evict oldest if over capacity
		while (this.items.length > this.maxSize) {
			this.items.shift();
		}
	}

	has(item: T): boolean {
		return this.items.indexOf(item) !== -1;
	}

	delete(item: T): boolean {
		const index = this.items.indexOf(item);
		if (index !== -1) {
			this.items.splice(index, 1);
			return true;
		}
		return false;
	}

	clear(): void {
		this.items = [];
	}

	get size(): number {
		return this.items.length;
	}

	/**
	 * Convert to regular Set for compatibility.
	 */
	toSet(): Set<T> {
		return new Set(this.items);
	}
}

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

/**
 * Simple performance metrics tracker.
 * 
 * Tracks operation durations to identify bottlenecks.
 * All tracking is disabled by default (zero overhead).
 */
export class PerfTracker {
	private enabled = false;
	private metrics = new Map<string, number[]>();

	enable(): void {
		this.enabled = true;
	}

	disable(): void {
		this.enabled = false;
	}

	/**
	 * Track an operation's duration.
	 * Call start() before operation, then end() after.
	 */
	start(_operation: string): number {
		if (!this.enabled) return 0;
		return performance.now();
	}

	end(operation: string, startTime: number): void {
		if (!this.enabled) return;
		const duration = performance.now() - startTime;
		const existing = this.metrics.get(operation) || [];
		existing.push(duration);
		// Keep only last 100 samples
		if (existing.length > 100) existing.shift();
		this.metrics.set(operation, existing);
	}

	/**
	 * Get average duration for an operation (in ms).
	 */
	getAverage(operation: string): number {
		const samples = this.metrics.get(operation);
		if (!samples || samples.length === 0) return 0;
		const sum = samples.reduce((a, b) => a + b, 0);
		return sum / samples.length;
	}

	/**
	 * Get all metrics as a summary object.
	 */
	getSummary(): Record<string, { avgMs: number; samples: number }> {
		const summary: Record<string, { avgMs: number; samples: number }> = {};
		for (const [op, samples] of this.metrics.entries()) {
			summary[op] = {
				avgMs: this.getAverage(op),
				samples: samples.length,
			};
		}
		return summary;
	}

	clear(): void {
		this.metrics.clear();
	}
}

/**
 * Global performance tracker instance.
 * Disabled by default for zero overhead.
 */
export const perfTracker = new PerfTracker();