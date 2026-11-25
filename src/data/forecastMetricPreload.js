export async function preloadForecastMetrics({ metrics, isCached, fetchForecast, comparisonOptions = [], batchSize = 3 }) {
    let failed = false;

    for (const metric of metrics) {
        if (!isCached(metric)) {
            const result = await Promise.allSettled([fetchForecast(metric)]);
            if (result[0].status === 'rejected') failed = true;
        }

        for (let index = 0; index < comparisonOptions.length; index += batchSize) {
            const batch = comparisonOptions.slice(index, index + batchSize);
            const results = await Promise.allSettled(batch.map(option => fetchForecast(metric, option)));
            if (results.some(result => result.status === 'rejected')) failed = true;
        }
    }

    return { failed };
}

// Request the main result and one complete comparison group. An existing warmup
// and a user's click share the same API requests; no per-category network loop.
export async function prepareForecastMetric({ options, comparisonOptions, getMain, getComparisons, fetchMain, fetchComparisons, signal }) {
    signal?.throwIfAborted();
    const main = getMain(options) || fetchMain(options, signal);
    const comparisons = comparisonOptions.comparisons.length
        ? getComparisons(comparisonOptions) || fetchComparisons(comparisonOptions, signal)
        : { series: [] };
    const [data, group] = await Promise.all([main, comparisons]);
    signal?.throwIfAborted();
    if (group.series.some(item => item.error)) throw new Error('Some comparison forecasts could not be prepared. Please try again.');
    return { data, group };
}
