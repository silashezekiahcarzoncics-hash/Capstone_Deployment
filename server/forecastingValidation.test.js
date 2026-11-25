import test from 'node:test';
import assert from 'node:assert/strict';
import { predictiveAnalytics, prescriptiveAnalytics, MODEL_MINIMUM_OBSERVATIONS } from './forecasting.js';
import { attachAdjustments } from './analytics.js';

const ALL = { period: 'All Available Data' };
const monthAt = index => new Date(Date.UTC(2021, index, 1)).toISOString().slice(0, 7);
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const rowsOf = values => values.flatMap((amount, index) => {
    if (amount === null) return [];
    const month = monthAt(index);
    return [0, 1].map(k => ({
        id: `${index}-${k}`, order_id: `${index}-${k}`,
        year_month: month, order_creation_date: `${k ? lastDay(month) : `${month}-01`}T00:00:00Z`,
        region: 'R', province: 'P', category: 'C', line_revenue: amount / 2,
        net_quantity: amount / 2, quantity: amount / 2, returned_quantity: 0,
        is_included_in_analysis: true, is_exact_duplicate: false
    }));
});
const chartOf = (values, model = 'arima', mode = 'strict') =>
    predictiveAnalytics(rowsOf(values), ALL, 3, 'revenue', '', '', model, mode, true);

// The final holdout is never inspected to choose the winner.
test('automatic selection is invariant to the final unseen twelve months', () => {
    const early = Array.from({ length: 36 }, (_, i) => 200 + i * 3 + 12 * Math.sin(i * 0.4));
    const a = chartOf([...early, ...Array.from({ length: 12 }, (_, i) => 350 + i)], 'auto');
    const b = chartOf([...early, ...Array.from({ length: 12 }, (_, i) => 800 + 20 * i)], 'auto');
    assert.deepEqual(a.modelAssignment.comparedModels, b.modelAssignment.comparedModels);
    assert.equal(a.modelAssignment.assignedModel, b.modelAssignment.assignedModel);
    assert.equal(a.modelAssignment.finalHoldout.independentOfSelection, true);
    assert.ok(a.modelAssignment.selectionWindow.end < a.modelAssignment.finalHoldout.start);
    assert.equal(a.chart.validation.independent, true);
    assert.notEqual(a.chart.validation.mae, b.chart.validation.mae);
});

test('auto candidate selection respects model-specific history and preserves independent evaluation', () => {
    const rows = Array.from({ length: 30 }, (_, i) => 300 + 15 * Math.sin(i / 3));
    const result = chartOf(rows, 'auto');
    const byModel = Object.fromEntries(result.modelAssignment.comparedModels.map(x => [x.model, x]));
    assert.equal(byModel.prophet.eligible, false, 'no two full years before the selection window');
    assert.ok(byModel.arima.eligible);
    assert.ok(result.chart.validation.independent);
});

test('intermittent selection and final evaluation are disjoint and zero-safe', () => {
    const values = Array.from({ length: 36 }, (_, i) => i % 4 === 0 ? 120 + i : 0);
    const result = chartOf(values, 'arima', 'intermittent').chart;
    assert.equal(result.status, 'available');
    assert.equal(result.modelSelection.detectedIntermittentDemand, true);
    assert.equal(result.validation.independent, true);
    assert.ok(result.validation.selectionWindow.end < result.validation.start);
    assert.equal(result.validation.months, 6);
    assert.ok(result.modelSelection.candidates.some(x => x.model === 'croston_sba'));
    assert.ok(result.modelSelection.candidates.some(x => x.model === 'tsb'));
    assert.ok(result.validation.mapeExcludedMonths > 0, 'MAPE safely excludes actual zero-demand months');
    assert.ok(result.forecast.every(point => point.intervalCalibrated === false));
});

test('short intermittent history never reports independent validation', () => {
    const values = Array.from({ length: 17 }, (_, i) => i % 3 ? 0 : 60);
    const result = chartOf(values, 'arima', 'intermittent').chart;
    assert.equal(result.status, 'available');
    assert.equal(result.validation, null);
    assert.equal(result.forecastStatus, 'Available — Exploratory');
    assert.equal(result.modelSelection.independentlyValidated, false);
});

test('adjusted trailing training month cannot interpolate from future holdout', () => {
    const early = Array.from({ length: 30 }, (_, i) => 110 + 2 * i);
    const adjustmentMonth = monthAt(29);
    const adjustment = [{ id: 1, start_date: `${adjustmentMonth}-01`, end_date: lastDay(adjustmentMonth), kind: 'anomaly', exclude_from_training: true }];
    const get = last => {
        const rows = rowsOf([...early, ...last]);
        attachAdjustments(rows, adjustment);
        return predictiveAnalytics(rows, ALL, 3, 'revenue', '', '', 'arima', 'strict', true).chart;
    };
    const flat = get(Array(6).fill(200));
    const surge = get(Array(6).fill(1000));
    assert.equal(flat.validation.points[0].predicted, surge.validation.points[0].predicted);
    assert.ok(flat.validation.points[0].actual !== surge.validation.points[0].actual);
    assert.ok(!flat.validation.points.some(p => p.month === adjustmentMonth));
});

test('short histories reject complex models without replacing the ARIMA fallback', () => {
    const values = Array.from({ length: 15 }, (_, i) => 100 + i);
    assert.equal(MODEL_MINIMUM_OBSERVATIONS.prophet, 24);
    assert.equal(MODEL_MINIMUM_OBSERVATIONS.random_forest, 18);
    const seasonal = chartOf(values, 'prophet').chart;
    const forest = chartOf(values, 'random_forest').chart;
    const fallback = chartOf(values.slice(0, 5), 'arima').chart;
    assert.equal(seasonal.status, 'insufficient');
    assert.match(seasonal.reason, /24 observed months/);
    assert.equal(forest.status, 'insufficient');
    assert.match(forest.reason, /18 observed months/);
    assert.equal(fallback.status, 'available');
    assert.match(fallback.model, /random walk/);
    assert.equal(fallback.forecastStatus, 'Available — Exploratory');
});

test('MAE RMSE and naive benchmark match independently calculated holdout values', () => {
    const values = [...Array(24).fill(100), ...Array(6).fill(160)];
    const chart = chartOf(values).chart;
    const v = chart.validation;
    assert.equal(v.independent, true);
    assert.equal(v.baselineMae, 60);
    assert.equal(v.baselineRmse, 60);
    assert.equal(v.baselineMape, 37.5);
    const mae = v.points.reduce((sum, p) => sum + Math.abs(p.actual - p.predicted), 0) / v.points.length;
    const rmse = Math.sqrt(v.points.reduce((sum, p) => sum + (p.actual - p.predicted) ** 2, 0) / v.points.length);
    assert.ok(Math.abs(v.mae - mae) < 1e-10);
    assert.ok(Math.abs(v.rmse - rmse) < 1e-10);
});

test('percentage error ignores zero-actual months without dividing by zero', () => {
    const values = [...Array(24).fill(100), 0, 100, 0, 120, 0, 110];
    const result = chartOf(values).chart.validation;
    assert.equal(result.mapeExcludedMonths, 3);
    assert.ok(Number.isFinite(result.mape));
    assert.ok(Number.isFinite(result.baselineMae));
});

test('forecast ranges remain explicitly heuristic, never calibrated 95 percent intervals', () => {
    for (const mode of ['strict', 'intermittent']) {
        const vals = Array.from({ length: 36 }, (_, i) => mode === 'intermittent' && i % 4 ? 0 : 150 + i);
        const result = chartOf(vals, 'arima', mode).chart;
        assert.equal(result.status, 'available');
        for (const point of result.forecast) {
            assert.equal(point.intervalCalibrated, false);
            assert.ok(point.lower <= point.value && point.value <= point.upper);
        }
    }
});

test('prescriptive does not use exploratory forecast growth as expansion evidence', () => {
    const rows = rowsOf(Array.from({ length: 12 }, (_, i) => 100 + i * 6));
    const result = prescriptiveAnalytics(rows, ALL, 3, 'revenue', 'arima');
    assert.equal(result.pairs.length, 1);
    const item = result.pairs[0];
    assert.equal(item.forecastAvailable, true);
    assert.equal(item.forecastGrowthUsedForScoring, false);
    assert.match(item.forecastEvidenceNote, /exploratory/);
    assert.equal(item.growthEvidenceAvailable, false);
    assert.equal(item.eligible, false);
});

test('Croston SBA agrees with hand-calculated size and interval smoothing', async () => {
    const { runModel } = await import('./forecasting.js');
    // Events at indices 0, 3 and 5; alpha=0.1; SBA correction=0.95.
    // size: 5 -> 5.5 -> 5.95; interval: 1 -> 1.2 -> 1.28.
    const forecast = runModel([5, 0, 0, 10, 0, 10], 3, 'croston_sba');
    const expected = 0.95 * 5.95 / 1.28;
    assert.ok(forecast.every(value => Math.abs(value - expected) < 1e-10));
});

test('TSB agrees with hand-calculated occurrence probability and demand size', async () => {
    const { runModel } = await import('./forecasting.js');
    // beta=0.1; p: 1 -> .9 -> .81 -> .829 -> .7461 -> .77149
    // alpha=0.1; size: 5 -> 5.5 -> 5.95
    const forecast = runModel([5, 0, 0, 10, 0, 10], 3, 'tsb');
    assert.ok(forecast.every(value => Math.abs(value - 0.77149 * 5.95) < 1e-10));
});

test('seasonal-regression model recovers a known two-cycle trend and yearly harmonic', async () => {
    const { runModel } = await import('./forecasting.js');
    const signal = t => 150 + 2 * t + 15 * Math.sin(t * 2 * Math.PI / 12) + 10 * Math.cos(t * 2 * Math.PI / 12);
    const values = Array.from({ length: 48 }, (_, i) => signal(i));
    const projected = runModel(values, 6, 'prophet');
    for (let i = 0; i < projected.length; i++) {
        assert.ok(Math.abs(projected[i] - signal(48 + i)) < 1.5, `month ${i}: ${projected[i]} vs ${signal(48+i)}`);
    }
});

test('deterministic forest preserves a flat series and never forecasts negative demand', async () => {
    const { runModel } = await import('./forecasting.js');
    const values = Array(30).fill(175);
    const projected = runModel(values, 4, 'random_forest');
    assert.deepEqual(projected, [175, 175, 175, 175]);
    assert.deepEqual(runModel(values, 4, 'random_forest'), projected);
});
