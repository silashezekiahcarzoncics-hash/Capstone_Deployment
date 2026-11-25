import { normalizeGeographicScope } from "./geographicScope.js";
import { predictiveAnalytics } from './forecasting.js';
import { snapshotMemo } from './cache/snapshotMemo.js';

// Keep the legacy forecast engine and its independently fitted comparison series.
export function cachedPredictive(rows, { filters, horizon, target, category = '', provinceKey = '', model, missingMonthMode, chartOnly = false }) {
    filters = normalizeGeographicScope(filters);
    return snapshotMemo(rows, chartOnly ? 'predictive-chart-response' : 'predictive-response',
        JSON.stringify([filters, horizon, target, category, provinceKey, model, missingMonthMode]), chartOnly ? 64 : 8,
        () => predictiveAnalytics(rows, filters, horizon, target, category, provinceKey, model, missingMonthMode, chartOnly));
}

export function forecastComparisons(rows, options, comparisons) {
    const { horizon, target, model, missingMonthMode } = options;
    const filters = normalizeGeographicScope(options.filters);
    const key = JSON.stringify([filters, horizon, target, model, missingMonthMode, comparisons]);
    // Preserve per-series errors, but never memoize incomplete results.
    class IncompleteGroup extends Error {
        constructor(series) { super('Incomplete forecast comparison group'); this.series = series; }
    }
    try {
        return snapshotMemo(rows, 'predictive-comparison-groups', key, 12, () => {
            const series = comparisons.map(({ category, provinceKey }) => {
                try {
                    const result = cachedPredictive(rows, { filters, horizon, target, model, missingMonthMode, category, provinceKey, chartOnly: true });
                    return { chart: result.chart, dataCompleteness: result.dataCompleteness };
                } catch (error) {
                    return { error: error.message, chart: null };
                }
            });
            if (series.some(item => item.error)) throw new IncompleteGroup(series);
            return series;
        });
    } catch (error) {
        if (error instanceof IncompleteGroup) return error.series;
        throw error;
    }
}
