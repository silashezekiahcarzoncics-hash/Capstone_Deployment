// Cache only the immutable, complete snapshots owned by createAnalyticsCache.
// Weak keys allow a replaced snapshot and all of its indexes/results to be collected.
const snapshots = new WeakMap();

export function registerSnapshot(rows, index) {
    snapshots.set(rows, { index, day: null, caches: new Map() });
}

export function snapshotIndex(rows) {
    return snapshots.get(rows)?.index;
}

export function clearSnapshotMemos(rows) {
    snapshots.get(rows)?.caches.clear();
}

export function snapshotMemo(rows, namespace, key, limit, compute) {
    const state = snapshots.get(rows);
    if (!state) return compute(); // Ordinary caller-owned arrays may be mutated.
    const day = new Date().toISOString().slice(0, 10);
    if (day !== state.day) {
        state.caches.clear();
        state.day = day;
    }
    if (!state.caches.has(namespace)) state.caches.set(namespace, new Map());
    const cache = state.caches.get(namespace);
    if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    }
    const value = compute();
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
}
