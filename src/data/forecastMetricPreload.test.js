import test from 'node:test';
import assert from 'node:assert/strict';
import { preloadForecastMetrics } from './forecastMetricPreload.js';

test('continues preparing every metric when one metric request fails', async () => {
    const attempted = [];
    const result = await preloadForecastMetrics({
        metrics: ['revenue', 'orders', 'quantity'],
        isCached: () => false,
        comparisonOptions: [{ category: 'A' }, { category: 'B' }],
        fetchForecast: async (metric, option) => {
            attempted.push(`${metric}:${option?.category || 'main'}`);
            if (metric === 'revenue' && !option) throw new Error('temporary failure');
        }
    });

    assert.equal(result.failed, true);
    assert.deepEqual(attempted, [
        'revenue:main', 'revenue:A', 'revenue:B',
        'orders:main', 'orders:A', 'orders:B',
        'quantity:main', 'quantity:A', 'quantity:B'
    ]);
});

test('skips cached main forecasts and reports success when all remaining requests succeed', async () => {
    const attempted = [];
    const result = await preloadForecastMetrics({
        metrics: ['revenue', 'orders'],
        isCached: metric => metric === 'revenue',
        fetchForecast: async metric => attempted.push(metric)
    });

    assert.equal(result.failed, false);
    assert.deepEqual(attempted, ['orders']);
});
