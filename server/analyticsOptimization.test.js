import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows, attachAdjustments, prepareAnalyticsSnapshot } from './analytics.js';
import { predictiveAnalytics, prescriptiveAnalytics } from './forecasting.js';
import { snapshotMemo } from './cache/snapshotMemo.js';
import { fixture, adjustment } from './cache/optimizationFixture.js';

const all = { period: 'All Available Data', categories: null };
function datasets(adjustments = []) {
    const original = attachAdjustments(fixture(), adjustments);
    const indexed = prepareAnalyticsSnapshot(attachAdjustments(structuredClone(original), adjustments));
    return [original, indexed];
}
test('indexed descriptive checklists preserve exact aggregates, row order, return treatment and distinct orders', () => {
    const [original, indexed] = datasets(adjustment);
    for (const returns of ['Include All', 'Exclude Approved Returns', 'Returned / Refunded Only']) {
        for (const scope of [all, { ...all, categories: ['C2','C0'] }, { ...all, categories: [] }, { ...all, region: 'R1' }, { ...all, period: 'Last 12 Months' }, { ...all, period: 'Custom Range', start: '2023-03-15', end: '2023-12-10' }]) {
            for (const descriptiveFilters of [null, { categories: ['C1'] }, { categories: ['C2','C0','C2'] }, { categories: ['unknown'] }, { provinceKeys: ['["R0","P0"]'], categories: ['C0','C2'] }]) {
                const opts = { descriptiveFilters };
                assert.deepEqual(analyzeRows(indexed, { ...scope, returns }, opts), analyzeRows(original, { ...scope, returns }, opts));
            }
        }
    }
    assert.equal(analyzeRows(indexed, all).summary.orders, 18 * 2 * 3);
});
test('prewarmed model evaluations equal uncached results across checklist scopes, metrics, models and chart-only requests', () => {
    const [original, indexed] = datasets();
    for (const [target, model, mode] of [['revenue','arima','strict'], ['orders','prophet','strict'], ['quantity','random_forest','strict'], ['quantity','croston_sba','intermittent'], ['revenue','auto','strict']]) {
        for (const [scope, category, provinceKey, chartOnly] of [[all,'','',false], [{...all,categories:['C2','C0']},'C0','',true], [{...all,categories:['C0','C2']},'C2','["R1","P1"]',false], [all,'C0','',true]]) {
            const args = [scope, 3, target, category, provinceKey, model, mode, chartOnly];
            assert.deepEqual(predictiveAnalytics(indexed, ...args), predictiveAnalytics(original, ...args));
        }
    }
    assert.deepEqual(prescriptiveAnalytics(indexed, all, 3), prescriptiveAnalytics(original, all, 3));
});
test('category chart reuses the full evaluation rather than fitting again; adjustments and replacement invalidate cached results', () => {
    const [original, indexed] = datasets();
    predictiveAnalytics(indexed, all, 3);
    const first = predictiveAnalytics(indexed, all, 3, 'revenue', 'C0', '', 'arima', 'strict', true);
    const second = predictiveAnalytics(indexed, {...all, categories:['C0','C1']}, 3, 'revenue', 'C0', '', 'arima', 'strict', true);
    assert.strictEqual(first.chart.history, second.chart.history);
    attachAdjustments(indexed, adjustment); attachAdjustments(original, adjustment);
    const updated = predictiveAnalytics(indexed, all, 3, 'revenue', 'C0', '', 'arima', 'strict', true);
    assert.notStrictEqual(updated.chart.history, first.chart.history);
    assert.deepEqual(updated, predictiveAnalytics(original, all, 3, 'revenue', 'C0', '', 'arima', 'strict', true));
    const fresh = prepareAnalyticsSnapshot(fixture());
    assert.notStrictEqual(snapshotMemo(indexed, 'test', 'x', 2, () => ({})), snapshotMemo(fresh, 'test', 'x', 2, () => ({})));
});
test('snapshot memo is bounded LRU and never caches unregistered mutable inputs or thrown errors', () => {
    const rows = prepareAnalyticsSnapshot(fixture());
    let calls = 0;
    const get = key => snapshotMemo(rows, 'test', key, 2, () => ++calls);
    assert.equal(get('a'), 1); assert.equal(get('b'), 2); assert.equal(get('a'), 1); assert.equal(get('c'), 3); assert.equal(get('b'), 4);
    assert.throws(() => snapshotMemo(rows, 'test', 'error', 2, () => { throw Error('fail'); }), /fail/);
    assert.equal(get('error'), 5);
    const mutable = [];
    assert.equal(snapshotMemo(mutable, 'test','x',2,()=>1),1);
    assert.equal(snapshotMemo(mutable, 'test','x',2,()=>2),2);
});
