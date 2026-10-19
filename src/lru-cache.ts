/**
 * LRU (Least Recently Used) Cache for link color storage.
 * 
 * Prevents unbounded memory growth in large vaults with thousands of unique links.
 * Automatically evicts least-recently-used entries when capacity is reached.
 */

export interface LRUCacheOptions {
	maxSize: number;
	onEvict?: (key: string, value: unknown) => void;
}

export class LRUCache<K = string, V = unknown> {
	private cache: Map<K, V>;
	private maxSize: number;
	private onEvict?: (key: string, value: unknown) => void;
	private hits = 0;
	private misses = 0;

	constructor(options: LRUCacheOptions) {
		this.cache = new Map();
		this.maxSize = options.maxSize;
		this.onEvict = options.onEvict;
	}

	/**
	 * Get a value from the cache.
	 * Returns undefined if not found.
	 * Moves the entry to most-recently-used position.
	 */
	get(key: K): V | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			this.hits++;
			// Move to end (most recently used) by deleting and re-inserting
			this.cache.delete(key);
			this.cache.set(key, value);
			return value;
		}
		this.misses++;
		return undefined;
	}

	/**
	 * Set a value in the cache.
	 * Evicts least-recently-used entry if at capacity.
	 */
	set(key: K, value: V): void {
		// If key exists, delete it first (to update position)
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		
		// Add to end (most recently used)
		this.cache.set(key, value);

		// Evict if over capacity
		if (this.cache.size > this.maxSize) {
			this.evictLRU();
		}
	}

	/**
	 * Check if key exists in cache.
	 */
	has(key: K): boolean {
		return this.cache.has(key);
	}

	/**
	 * Delete a specific key from cache.
	 */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/**
	 * Clear all entries from cache.
	 */
	clear(): void {
		this.cache.clear();
		this.hits = 0;
		this.misses = 0;
	}

	/**
	 * Get current cache size.
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Get cache hit rate percentage (0-100).
	 */
	get hitRate(): number {
		const total = this.hits + this.misses;
		return total === 0 ? 0 : Math.round((this.hits / total) * 100);
	}

	/**
	 * Evict the least recently used entry.
	 */
	private evictLRU(): void {
		// Map iterators return entries in insertion order
		// First entry is least recently used
		const firstKey = this.cache.keys().next().value;
		if (firstKey !== undefined) {
			const value = this.cache.get(firstKey);
			this.cache.delete(firstKey);
			if (this.onEvict && value !== undefined) {
				this.onEvict(String(firstKey), value);
			}
		}
	}

	/**
	 * Get all keys (for iteration/debugging).
	 */
	keys(): IterableIterator<K> {
		return this.cache.keys();
	}

	/**
	 * Get all values (for iteration/debugging).
	 */
	values(): IterableIterator<V> {
		return this.cache.values();
	}

	/**
	 * Get all entries (for iteration/debugging).
	 */
	entries(): IterableIterator<[K, V]> {
		return this.cache.entries();
	}
}