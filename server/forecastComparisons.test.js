import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastComparisons, cachedPredictive } from './forecastComparisons.js';
import { predictiveAnalytics } from './forecasting.js';
import { prepareAnalyticsSnapshot, attachAdjustments } from './analytics.js';
import { fixture, adjustment } from './cache/optimizationFixture.js';
const filters = { period: 'All Available Data', categories: ['C0','C1','C2'] };
const options = { filters, horizon: 6, target: 'revenue', model: 'auto', missingMonthMode: 'strict' };
const categorySelections = ['C2','C0','C1'].map(category => ({category, provinceKey:''}));
const provinceSelections = ['["R1","P1"]','["R0","P0"]'].map(provinceKey => ({category:'', provinceKey}));
const expected = (rows, opts, selection) => {
    const result = predictiveAnalytics(rows, opts.filters, opts.horizon, opts.target, selection.category, selection.provinceKey, opts.model, opts.missingMonthMode, true);
    return { chart: result.chart, dataCompleteness: result.dataCompleteness };
};
test('batch charts exactly match independent forecasts across metrics, models, modes and both comparison dimensions', () => {
    const original = fixture({months:36});
    const rows = prepareAnalyticsSnapshot(structuredClone(original));
    for (const target of ['revenue','orders','quantity']) for (const model of ['arima','prophet','random_forest','auto']) for (const missingMonthMode of ['strict','confirmed_zero','intermittent']) {
        const opts = {...options, target, model, missingMonthMode};
        for (const selection of [categorySelections, provinceSelections]) {
            assert.deepEqual(forecastComparisons(rows,opts,selection), selection.map(item => expected(original,opts,item)));
        }
        assert.deepEqual(cachedPredictive(rows,opts), predictiveAnalytics(original, filters, 6,target,'','',model,missingMonthMode));
    }
});
test('comparison groups preserve order and isolate individual invalid selections', () => {
    const rows = prepareAnalyticsSnapshot(fixture());
    const selected = [categorySelections[0],{category:'Unknown',provinceKey:''},categorySelections[1]];
    const result = forecastComparisons(rows,options,selected);
    assert.deepEqual(result[0],expected(rows,options,selected[0]));
    assert.match(result[1].error,/outside the current analysis scope/);
    assert.equal(result[1].chart,null);
    assert.deepEqual(result[2],expected(rows,options,selected[2]));
    assert.notStrictEqual(forecastComparisons(rows,options,selected),result,'partial failures must not be cached');
});
test('warm group reuse, metric/scope isolation, snapshot replacement and adjustment invalidation', () => {
    const rows = prepareAnalyticsSnapshot(fixture());
    const revenue = forecastComparisons(rows,options,categorySelections);
    assert.strictEqual(forecastComparisons(rows,options,categorySelections),revenue);
    const orders = forecastComparisons(rows,{...options,target:'orders'},categorySelections);
    assert.notStrictEqual(orders,revenue);
    const selected = forecastComparisons(rows,{...options,filters:{...filters,region:'R0'}},categorySelections);
    assert.notStrictEqual(selected,revenue);
    const newRows = prepareAnalyticsSnapshot(fixture());
    assert.notStrictEqual(forecastComparisons(newRows,options,categorySelections),revenue);
    attachAdjustments(rows,adjustment);
    assert.notStrictEqual(forecastComparisons(rows,options,categorySelections),revenue);
    assert.deepEqual(forecastComparisons(rows,options,categorySelections),categorySelections.map(item=>expected(rows,options,item)));
});
