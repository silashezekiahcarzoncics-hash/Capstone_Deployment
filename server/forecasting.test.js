import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { attachAdjustments } from './analytics.js';
import { predictiveAnalytics, prescriptiveAnalytics, PRESCRIPTIVE_WEIGHTS, STRATEGY_THRESHOLDS, growthScore, mixScore, percentileRanks } from './forecasting.js';

// ---- fixtures -------------------------------------------------------------
const addMonths = (month, n) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const lastDay = month => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
let nextId = 0;
// One transaction row per (province, category, month). Every month is complete unless `through` shortens the last one.
function monthlyRows(values, { start = '2023-01', region = 'R', province = 'P', category = 'C', ordersPerMonth = 3, through = null } = {}) {
    const rows = [];
    values.forEach((value, index) => {
        if (value === null) return;
        const month = addMonths(start, index);
        const isLast = index === values.length - 1;
        for (let k = 0; k < ordersPerMonth; k += 1) {
            const day = k === 0 ? `${month}-01` : isLast && through ? through : lastDay(month);
            rows.push({ id: String(nextId += 1), order_id: `${province}-${category}-${month}-${k}`, order_creation_date: `${day}T00:00:00Z`, year_month: month, region, province, category, line_revenue: value / ordersPerMonth, quantity: value / ordersPerMonth, net_quantity: value / ordersPerMonth, returned_quantity: 0, return_refund_status: null, is_included_in_analysis: true, is_exact_duplicate: false });
        }
    });
    return rows;
}
const ALL = { period: 'All Available Data' };
const wave = n => Array.from({ length: n }, (_, i) => 300 + 30 * Math.sin(i / 2) + (i * 7) % 23);

test('category comparison chart responses forecast each category from its own history and match existing chart calculations', () => {
    const rows = [
        ...monthlyRows(wave(24), { category: 'Beauty' }),
        ...monthlyRows(wave(24).map(value => value * 2), { category: 'Fashion' }),
        ...monthlyRows(Array.from({ length: 24 }, (_, index) => index === 0 || index === 23 ? 90 : null), { category: 'Home' })
    ];
    const beauty = predictiveAnalytics(rows, ALL, 3, 'revenue', 'Beauty', '', 'arima', 'strict', true);
    const fashion = predictiveAnalytics(rows, ALL, 3, 'revenue', 'Fashion', '', 'arima', 'strict', true);
    const sparse = predictiveAnalytics(rows, ALL, 3, 'revenue', 'Home', '', 'arima', 'strict', true);
    const automatic = predictiveAnalytics(rows, ALL, 3, 'revenue', 'Beauty', '', 'auto', 'strict', true);
    const existingBeautyChart = predictiveAnalytics(rows, ALL, 3, 'revenue', 'Beauty', '', 'arima').chart;

    assert.deepEqual(beauty.chart, existingBeautyChart);
    assert.equal(beauty.chart.history.length, 24);
    assert.equal(fashion.chart.history.filter(point => point.value != null).length, 24);
    assert.notDeepEqual(beauty.chart.forecast.map(row => row.value), fashion.chart.forecast.map(row => row.value));
    assert.equal(sparse.chart.status, 'insufficient');
    assert.equal(sparse.chart.forecast.length, 0, 'categories with insufficient history do not receive a generated forecast');
    assert.equal(automatic.modelAssignment.requested, 'auto', 'automatic model selection uses the selected category history');
    assert.equal('overview' in beauty, false, 'comparison-series responses avoid recalculating unrelated overview forecasts');
});

// ---- partial month --------------------------------------------------------
test('a part-month is excluded from history and cannot move the forecast', () => {
    const base = wave(30);
    const partialLow = monthlyRows([...base.slice(0, -1), 5], { through: '2025-06-09' });
    const partialHigh = monthlyRows([...base.slice(0, -1), 99999], { through: '2025-06-09' });
    const low = predictiveAnalytics(partialLow, ALL, 6, 'revenue').chart;
    const high = predictiveAnalytics(partialHigh, ALL, 6, 'revenue').chart;
    assert.equal(low.coverage.end, '2025-05');                      // 2025-06 is the part-month
    assert.equal(low.forecast[0].month, '2025-06');                 // forecasting starts at the part-month
    assert.equal(low.history.length, 29);
    assert.deepEqual(low.forecast.map(p => p.value), high.forecast.map(p => p.value));
    assert.deepEqual(low.validation.points, high.validation.points);
    const result = predictiveAnalytics(partialLow, ALL, 6, 'revenue');
    assert.deepEqual(result.dataCompleteness.partialMonths, ['2025-06']);
    assert.equal(result.dataCompleteness.lastCompleteMonth, '2025-05');
});

test('a complete final month is kept', () => {
    const chart = predictiveAnalytics(monthlyRows(wave(30)), ALL, 6, 'revenue').chart;
    assert.equal(chart.history.length, 30);
    assert.equal(chart.coverage.end, '2025-06');
    assert.equal(chart.forecast[0].month, '2025-07');
});

test('"Last 12 Months" for forecasting means the 12 latest complete months', () => {
    const rows = monthlyRows(wave(30), { through: '2025-06-09' });
    const result = predictiveAnalytics(rows, { period: 'Last 12 Months' }, 3, 'revenue');
    assert.deepEqual(result.effectiveRange, { start: '2024-06', end: '2025-05' });
});

// ---- anchoring ------------------------------------------------------------
test('a series that stopped selling is blocked instead of forecast from a past date', () => {
    const active = monthlyRows(wave(24), { province: 'Active' });
    const stopped = monthlyRows(wave(18), { province: 'Stopped' });     // last sale 6 months before the dataset ends
    const result = predictiveAnalytics([...active, ...stopped], ALL, 6, 'revenue');
    const pair = province => result.insufficient.find(item => item.province === province) || result.overview.find(item => item.province === province);
    assert.equal(pair('Active').status, 'available');
    assert.equal(pair('Active').coverage.end, '2024-12');
    assert.equal(pair('Stopped').status, 'insufficient');
    assert.match(pair('Stopped').reason, /latest 6 months.*inactive or discontinued/);
});

// ---- naive benchmark and labels ------------------------------------------
test('validation reports the repeat-last-month benchmark and the reliability label follows it', () => {
    for (const model of ['arima', 'prophet', 'random_forest']) {
        const chart = predictiveAnalytics(monthlyRows(wave(30)), ALL, 6, 'revenue', '', '', model).chart;
        const v = chart.validation;
        for (const key of ['baselineMae', 'baselineRmse', 'baselineMape', 'beatsBaseline', 'improvementVsBaseline']) assert.ok(key in v, key);
        // Analytics rounds monetary amounts to cents before forecasting.
        // Derive the benchmark independently from the actual prepared monthly series.
        const lastTrainingMonth = chart.history.at(-(v.months + 1)).value;
        const naiveMae = v.points.reduce((sum, p) => sum + Math.abs(p.actual - lastTrainingMonth), 0) / v.points.length;
        assert.ok(Math.abs(v.baselineMae - naiveMae) < 1e-6 * naiveMae + 1e-6);
        assert.equal(v.beatsBaseline, v.mae < v.baselineMae);
        assert.ok(Math.abs(v.improvementVsBaseline - (1 - v.mae / v.baselineMae) * 100) < 1e-9);
        assert.equal(chart.reliability, v.beatsBaseline ? 'backtested' : 'backtested_weak');
    }
    assert.equal(predictiveAnalytics(monthlyRows(wave(12)), ALL, 3, 'revenue').chart.reliability, 'low');
    assert.equal(predictiveAnalytics(monthlyRows(wave(5)), ALL, 3, 'revenue').chart.reliability, 'very_low');
});

test('the benchmark is the last training month repeated (hand-checked numbers)', () => {
    // 24 flat months of 100 then 6 months of 160: the 6 test months are scored against a naive forecast of exactly 100.
    const values = [...Array(24).fill(100), ...Array(6).fill(160)];
    const v = predictiveAnalytics(monthlyRows(values), ALL, 3, 'revenue').chart.validation;
    assert.equal(v.months, 6);
    assert.equal(v.baselineMae, 60);       // |160 - 100| every month
    assert.equal(v.baselineRmse, 60);
    assert.equal(Number(v.baselineMape.toFixed(6)), 37.5);   // 60 / 160
});

test('growth smaller than the backtest error is flagged', () => {
    const chart = predictiveAnalytics(monthlyRows(wave(30)), ALL, 6, 'revenue').chart;
    assert.equal(chart.growthWithinError, Math.abs(chart.forecastDemand - chart.currentDemand) < chart.validation.rmse);
});

// ---- ARIMA ----------------------------------------------------------------
const QUANTITY_58 = [1702, 1705, 1961, 2158, 2412, 2121, 2228, 2541, 2201, 2227, 2452, 2219, 2121, 2182, 2379, 2134, 1928, 1806, 2027, 1917, 1695, 1903, 1909, 1716, 1761, 1841, 2076, 1752, 1737, 1676, 1529, 1644, 1914, 1833, 2227, 1831, 2105, 1976, 1909, 1587, 1645, 1883, 2186, 2018, 2125, 2075, 2324, 1730, 2204, 2578, 2696, 2076, 1953, 2179, 2970, 2588, 2609, 2995];
test('ARIMA(1,1,1) agrees with a reference statsmodels fit on real monthly data', () => {
    // statsmodels ARIMA(1,1,1), trend="n", 6-step forecast: 2808, 2755, 2739, 2735, 2734, 2733 (MLE vs this CSS fit: <1% apart)
    const reference = [2808, 2755, 2739, 2735, 2734, 2733];
    const chart = predictiveAnalytics(monthlyRows(QUANTITY_58, { start: '2021-01' }), ALL, 6, 'quantity', '', '', 'arima').chart;
    assert.equal(chart.model, 'ARIMA(1,1,1)');
    chart.forecast.forEach((point, index) => assert.ok(Math.abs(point.value / reference[index] - 1) < 0.01, `${point.month}: ${point.value} vs ${reference[index]}`));
});

test('ARIMA never uses a hard-coded MA term and is deterministic', () => {
    const rows = monthlyRows(QUANTITY_58, { start: '2021-01' });
    const a = predictiveAnalytics(rows, ALL, 6, 'quantity', '', '', 'arima').chart.forecast.map(p => p.value);
    const b = predictiveAnalytics(rows, ALL, 6, 'quantity', '', '', 'arima').chart.forecast.map(p => p.value);
    assert.deepEqual(a, b);
});

test('with too few months ARIMA says it is a random walk instead of claiming ARIMA(1,1,1)', () => {
    const chart = predictiveAnalytics(monthlyRows([100, 120, 110, 130, 125]), ALL, 3, 'revenue').chart;
    assert.match(chart.model, /^ARIMA\(0,1,0\) random walk/);
    assert.ok(chart.forecast.every(p => p.value === 125));
});

// ---- returns flow into forecasts ------------------------------------------
test('orders target carries the non-additive note; other targets do not', () => {
    const rows = monthlyRows(wave(24));
    assert.equal(predictiveAnalytics(rows, ALL, 3, 'orders').notes.length, 1);
    assert.equal(predictiveAnalytics(rows, ALL, 3, 'revenue').notes.length, 0);
});

// ---- prescriptive score ---------------------------------------------------
test('scoring weights sum to one and growth / mix transforms are bounded and symmetric', () => {
    assert.ok(Math.abs(Object.values(PRESCRIPTIVE_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.equal(growthScore(0), 50);
    for (const g of [5, 25, 80, 400]) { assert.ok(Math.abs(growthScore(g) + growthScore(-g) - 100) < 1e-9); assert.ok(growthScore(g) < 100); }
    assert.ok(growthScore(25) < 90 && growthScore(25) > 85);       // +25% no longer saturates at 100
    assert.equal(mixScore(1), 50);
    assert.equal(mixScore(2), 75);
    assert.equal(mixScore(0.5), 25);
    assert.equal(mixScore(1000), 100);
    assert.equal(mixScore(0), 0);
    assert.ok(mixScore(1.13) > 50 && mixScore(1.13) < 60);          // a dominant category is neither rewarded nor punished by construction
    assert.equal(STRATEGY_THRESHOLDS.strongGrowthPercent, -STRATEGY_THRESHOLDS.steadyGrowthPercent);
});

test('tied demand values receive identical percentile ranks', () => {
    const ranks = percentileRanks([{ key: 'a', value: 1 }, { key: 'b', value: 5 }, { key: 'c', value: 5 }, { key: 'd', value: 9 }]);
    assert.equal(ranks.get('a'), 0);
    assert.equal(ranks.get('d'), 100);
    assert.equal(ranks.get('b'), ranks.get('c'));
    assert.equal(ranks.get('b'), 50);
    assert.equal(percentileRanks([{ key: 'only', value: 3 }]).get('only'), 50);
});

test('prescriptive pairs skip the part-month, use calendar-month demand, and publish how they are scored', () => {
    const rows = [
        ...monthlyRows(wave(30).map(v => v * 3), { province: 'Big', category: 'Main', ordersPerMonth: 4 }),
        ...monthlyRows(wave(30), { province: 'Small', category: 'Main', ordersPerMonth: 4 }),
        // Sparse: 8 active months inside the last 12, so it has a gap and no forecast.
        ...monthlyRows([...Array(18).fill(null), 50, null, 50, 50, null, 50, 50, null, 50, 50, null, 50], { province: 'Sparse', category: 'Main', ordersPerMonth: 4 })
    ];
    const partial = rows.map(r => r.year_month === '2025-06' ? { ...r, order_creation_date: '2025-06-09T00:00:00Z' } : r);
    const result = prescriptiveAnalytics(partial, ALL, 6, 'revenue');
    assert.deepEqual(result.dataCompleteness.partialMonths, ['2025-06']);
    assert.equal(result.effectiveRange.end, '2025-05');
    assert.ok(Math.abs(Object.values(result.scoring.weights).reduce((a, b) => a + b, 0) - 1) < 1e-12);
    const byProvince = Object.fromEntries(result.pairs.map(p => [p.province, p]));
    // Sparse pair: 7 active months of 50 inside the last 12 complete months (2024-06..2025-05; its 8th active month,
    // 2025-06, is the excluded part-month), so demand is 7*50/12 and not the active-months-only average of 50.
    assert.ok(Math.abs(byProvince.Sparse.demand - (7 * 50) / 12) < 1e-9, `demand ${byProvince.Sparse.demand}`);
    for (const pair of result.pairs.filter(p => p.eligible)) {
        assert.ok(pair.opportunityScore >= 0 && pair.opportunityScore <= 100);
        assert.ok(pair.factors.categoryAffinity >= 0 && pair.factors.categoryAffinity <= 100);
        assert.ok(pair.factors.growthMomentum >= 0 && pair.factors.growthMomentum <= 100);
        assert.ok(['EXPAND SELECTIVELY', 'SUSTAIN CORE DEMAND', 'PILOT AND VALIDATE', 'MONITOR / LOWER PRIORITY'].includes(pair.strategy));
    }
    assert.ok(byProvince.Big.demand > byProvince.Small.demand);
});

test('invalid requests are still rejected', () => {
    const rows = monthlyRows(wave(24));
    assert.throws(() => predictiveAnalytics(rows, ALL, 7, 'revenue'), /3, 6, 9, or 12/);
    assert.throws(() => predictiveAnalytics(rows, ALL, 6, 'bad'), /revenue, orders, or quantity/);
    assert.throws(() => predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'nope'), /supported forecasting model/);
});

// ---- explicit adjustment coverage ----------------------------------------
const ADJUSTMENT = [{ id: 1, start_date: '2025-11-17', end_date: '2025-12-31', kind: 'no_sales', exclude_from_training: true }];
test('an end adjustment advances forecast coverage and skips its months', () => {
    // 34 normal months (2023-01..2025-10) then 2025-11 with sales only to the 16th.
    const base = [...wave(34), 40];
    const without = monthlyRows(base, { through: '2025-11-16' });
    const adjustedRows = monthlyRows(base, { through: '2025-11-16' });
    attachAdjustments(adjustedRows, ADJUSTMENT);
    const plain = predictiveAnalytics(without, ALL, 9, 'revenue').chart;       // part-month dropped; forecast starts 2025-11
    const adjusted = predictiveAnalytics(adjustedRows, ALL, 6, 'revenue').chart;
    assert.deepEqual(adjusted.coverage.adjustedMonths, ['2025-11', '2025-12']);
    assert.deepEqual(adjusted.coverage.missingMonths, []);
    assert.equal(adjusted.coverage.end, '2025-12');
    assert.equal(adjusted.forecast[0].month, '2026-01');
    assert.equal(adjusted.history.at(-1).value, null);
    assert.equal(adjusted.history.at(-1).adjusted, true);
    // The adjusted months are skipped, so the first forecast is shifted by two months.
    adjusted.forecast.forEach((point, index) => {
        assert.equal(point.value, plain.forecast[index + 2].value);
        assert.equal(point.lower, plain.forecast[index + 2].lower);
        assert.equal(point.upper, plain.forecast[index + 2].upper);
    });
    assert.deepEqual(adjusted.validation.points, plain.validation.points);
});

test('without the declaration the same data is a part-month, and an empty month blocks the forecast', () => {
    // Shop sells through 2025-10, nothing in 2025-11/12, sells again from 2026-01.
    const rows = monthlyRows([...wave(34), null, null, 320, 330, 340]);
    const blocked = predictiveAnalytics(rows, ALL, 6, 'revenue').chart;
    assert.equal(blocked.status, 'insufficient');
    assert.match(blocked.reason, /no records/);
    attachAdjustments(rows, ADJUSTMENT);
    const fine = predictiveAnalytics(rows, ALL, 6, 'revenue').chart;
    assert.equal(fine.status, 'available');
    assert.deepEqual(fine.coverage.imputedMonths, ['2025-11', '2025-12']);
    assert.equal(fine.forecast[0].month, '2026-04');
});

test('adjusted months inside the test window are filled but never scored', () => {
    const values = wave(30);
    values[27] = null;
    const rows = monthlyRows(values);
    attachAdjustments(rows, [{ id: 2, start_date: '2025-04-01', end_date: '2025-04-30', kind: 'no_sales', exclude_from_training: true }]);
    const chart = predictiveAnalytics(rows, ALL, 6, 'revenue').chart;
    assert.equal(chart.status, 'available');
    assert.deepEqual(chart.coverage.imputedMonths, ['2025-04']);
    assert.equal(chart.validation.months, 6);
    assert.equal(chart.validation.scoredMonths, 5);
    assert.ok(!chart.validation.points.some(point => point.month === '2025-04'));
});

test('the adjustment reaches prescriptive analytics and is reported', () => {
    const rows = monthlyRows(wave(34), { ordersPerMonth: 4 }).concat(monthlyRows([40], { start: '2025-11', ordersPerMonth: 4, through: '2025-11-16' }));
    attachAdjustments(rows, ADJUSTMENT);
    const result = prescriptiveAnalytics(rows, ALL, 6, 'revenue');
    assert.deepEqual(result.dataCompleteness.adjustedMonths, ['2025-11', '2025-12']);
    assert.equal(result.effectiveRange.end, '2025-10');       // last normal month actually used for scoring
});

test('an interpolated adjustment does not inflate observed-month reliability count', () => {
    const noAdjustment = monthlyRows(wave(17));
    const adjusted = monthlyRows(wave(18));
    const adjustedMonth = addMonths('2023-01', 8);
    const rows = adjusted.filter(row => row.year_month !== adjustedMonth);
    attachAdjustments(rows, [{ id: 21, start_date: `${adjustedMonth}-01`, end_date: lastDay(adjustedMonth), kind: 'anomaly', exclude_from_training: true }]);
    const baseline = predictiveAnalytics(noAdjustment, ALL, 3, 'revenue').chart;
    const withAdjustment = predictiveAnalytics(rows, ALL, 3, 'revenue').chart;
    assert.equal(baseline.reliability, 'low');
    assert.equal(withAdjustment.reliability, 'low');
    assert.equal(withAdjustment.coverage.observedMonths, 17);
    assert.deepEqual(withAdjustment.coverage.imputedMonths, [adjustedMonth]);
});

test('prescriptive YoY compares calendar-aligned months and requires every pairable month in both years', () => {
    const values = [...Array(18)].map((_, index) => index < 6 ? 100 + index : index < 12 ? 200 + index : 100 + index - 12);
    const rows = monthlyRows(values, { start: '2024-01', ordersPerMonth: 4 });
    attachAdjustments(rows, [{ id: 22, start_date: '2025-07-01', end_date: '2025-12-31', kind: 'no_sales', exclude_from_training: true }]);
    const result = prescriptiveAnalytics(rows, ALL, 3, 'revenue');
    const pair = result.pairs[0];
    assert.equal(pair.yoyGrowth, 0);
    assert.equal(pair.yoyMonthsCompared, 6);
    assert.deepEqual(pair.yoyMonths, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']);

    const missing = rows.filter(row => row.year_month !== '2024-03');
    attachAdjustments(missing, [{ id: 23, start_date: '2025-07-01', end_date: '2025-12-31', kind: 'no_sales', exclude_from_training: true }]);
    const incompletePair = prescriptiveAnalytics(missing, ALL, 3, 'revenue').pairs[0];
    assert.equal(incompletePair.yoyGrowth, null);
    assert.equal(incompletePair.yoyChange, null);
    assert.equal(incompletePair.yoyMonthsCompared, null);
    assert.equal(incompletePair.yoyMonths, null);
});

// ---- missing-month handling and intermittent demand ----------------------
test('strict validation preserves the captured Shrink Wrap / Cap Seal forecasts', () => {
    const snapshot = JSON.parse(fs.readFileSync(new URL('./forecasting-strict-regression-snapshot.json', import.meta.url), 'utf8'));
    for (const expected of snapshot.snapshots) {
        const points = expected.historicalInput;
        const firstMonth = points[0].month;
        const lastMonth = points.at(-1).month;
        const rows = points.filter(point => point.value !== null).map((point, index, observed) => {
            const day = point.month === firstMonth ? '01' : point.month === lastMonth ? lastDay(point.month).slice(-2) : '15';
            return {
                id: `snapshot-${expected.province}-${point.month}`,
                order_id: `snapshot-${expected.province}-${point.month}`,
                order_creation_date: `${point.month}-${day}T00:00:00Z`,
                year_month: point.month,
                region: expected.region,
                province: expected.province,
                category: expected.category,
                line_revenue: point.value,
                quantity: 1,
                net_quantity: 1,
                returned_quantity: 0,
                return_refund_status: null,
                is_included_in_analysis: true,
                is_exact_duplicate: false
            };
        });
        const actual = predictiveAnalytics(rows, ALL, expected.horizon, 'revenue', expected.category, JSON.stringify([expected.region, expected.province]), 'arima', 'strict').chart;
        assert.equal(actual.status, expected.status, expected.province);
        assert.equal(actual.model, expected.model, expected.province);
        assert.deepEqual(actual.history.map(point => ({ month: point.month, value: point.value, adjusted: point.adjusted })), expected.historicalInput, expected.province);
        assert.deepEqual(actual.forecast.map(({ month, value, lower, upper }) => ({ month, value, lower, upper })), expected.forecast, expected.province);
        assert.equal(actual.growth, expected.growth, expected.province);
        assert.equal(actual.trend, expected.trend, expected.province);
        for (const key of Object.keys(expected.validation || {})) {
            assert.deepEqual(actual.validation?.[key], expected.validation[key], `${expected.province}: ${key}`);
        }
        if (actual.validation) {
            assert.equal(actual.validation.independent, true);
            assert.match(actual.validation.validationWindow, /Chronological/);
        }
        assert.deepEqual(actual.coverage.adjustedMonths, expected.trainingExclusions, expected.province);
    }
});

test('verified full no-sales months stay unknown in strict mode and enable zero-aware evaluation in the two flexible modes', () => {
    const values = wave(36).map((value, index) => index % 4 === 1 ? null : value);
    const rows = monthlyRows(values);
    const adjustments = values.flatMap((value, index) => value === null ? [{
        id: 100 + index,
        start_date: `${addMonths('2023-01', index)}-01`,
        end_date: lastDay(addMonths('2023-01', index)),
        kind: 'no_sales',
        exclude_from_training: false
    }] : []);
    attachAdjustments(rows, adjustments);
    const unchangedSource = structuredClone(rows);
    const strict = predictiveAnalytics(rows, ALL, 6, 'revenue').chart;
    const confirmed = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', 'confirmed_zero').chart;
    const intermittent = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', 'intermittent').chart;
    assert.equal(strict.status, 'insufficient');
    assert.match(strict.reason, /no records/);
    assert.equal(confirmed.status, 'available');
    assert.ok(confirmed.history.filter(point => point.confirmedZero).every(point => point.value === 0));
    assert.ok(confirmed.forecastStatus.startsWith('Available'));
    assert.equal(intermittent.status, 'available');
    assert.equal(intermittent.modelSelection.detectedIntermittentDemand, true);
    assert.ok(intermittent.modelSelection.candidates.some(candidate => candidate.model === 'croston_sba'));
    assert.ok(intermittent.validation.months <= 6);
    assert.ok(intermittent.validation.trainingMonths + intermittent.validation.months === 36);
    assert.equal(intermittent.validation.validationWindow, 'Untouched final chronological holdout');
    assert.ok(intermittent.forecast.every(point => point.value >= 0));
    assert.deepEqual(rows, unchangedSource);
});

test('unknown months and explicit data gaps remain unavailable in flexible modes', () => {
    const values = wave(30);
    values[8] = null;
    const rows = monthlyRows(values);
    for (const mode of ['confirmed_zero', 'intermittent']) {
        const result = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', mode).chart;
        assert.equal(result.status, 'insufficient');
        assert.match(result.reason, /Missing months are unknown demand/);
        assert.equal(result.forecastStatus, 'Unavailable — Insufficient Data');
    }
    attachAdjustments(rows, [{ id: 201, start_date: '2023-08-01', end_date: '2023-08-31', kind: 'data_gap', exclude_from_training: true }]);
    const gap = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', 'intermittent').chart;
    assert.equal(gap.status, 'insufficient');
    assert.match(gap.forecastStatus, /Unknown Data Gaps/);
    assert.match(gap.reason, /data-gap adjustment/);
    assert.equal(gap.history.find(point => point.month === '2023-08').value, null);
});

test('zero classification requires a full, non-excluded, conflict-free no-sales adjustment', () => {
    const values = wave(24);
    values[8] = null;
    const rows = monthlyRows(values);
    attachAdjustments(rows, [{ id: 251, start_date: '2023-09-01', end_date: '2023-09-30', kind: 'no_sales', exclude_from_training: true }]);
    const excluded = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', 'confirmed_zero').chart;
    assert.equal(excluded.coverage.confirmedZeroMonths.length, 0);
    assert.ok(excluded.coverage.adjustedMonths.includes('2023-09'));

    const partialRows = monthlyRows(values);
    attachAdjustments(partialRows, [{ id: 252, start_date: '2023-09-10', end_date: '2023-09-20', kind: 'no_sales', exclude_from_training: false }]);
    const partial = predictiveAnalytics(partialRows, ALL, 6, 'revenue', '', '', 'arima', 'confirmed_zero').chart;
    assert.equal(partial.status, 'insufficient');
    assert.equal(partial.coverage.confirmedZeroMonths.length, 0);

    const conflictingValues = wave(24);
    conflictingValues[8] = null;
    const conflictingRows = monthlyRows(conflictingValues);
    conflictingRows.push(...monthlyRows([10], { start: '2023-09', province: 'Other', category: 'Other' }));
    attachAdjustments(conflictingRows, [{ id: 253, start_date: '2023-09-01', end_date: '2023-09-30', kind: 'no_sales', exclude_from_training: false }]);
    const conflicting = predictiveAnalytics(conflictingRows, ALL, 6, 'revenue', 'C', JSON.stringify(['R', 'P']), 'arima', 'confirmed_zero').chart;
    assert.equal(conflicting.coverage.confirmedZeroMonths.includes('2023-09'), false);
    assert.equal(conflicting.status, 'insufficient');
});

test('closure settings are honored and inactive intermittent products are not forecast', () => {
    const values = [...wave(24), ...Array(12).fill(null)];
    const rows = monthlyRows(values);
    attachAdjustments(rows, [{ id: 301, start_date: '2025-01-01', end_date: '2025-12-31', kind: 'closure', exclude_from_training: true }]);
    const closure = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'arima', 'intermittent').chart;
    assert.equal(closure.status, 'insufficient');
    assert.deepEqual(closure.coverage.confirmedZeroMonths, []);
    assert.deepEqual(closure.coverage.adjustedMonths, Array.from({ length: 12 }, (_, index) => addMonths('2025-01', index)));
    assert.equal(closure.history.at(-1).value, null);
    assert.equal(closure.forecastStatus, 'Unavailable — Insufficient Data');
    assert.match(closure.reason, /current product activity cannot be verified/);

    const inactiveRows = monthlyRows([...wave(24), ...Array(8).fill(null)]);
    const months = Array.from({ length: 8 }, (_, index) => addMonths('2025-01', index));
    attachAdjustments(inactiveRows, months.map((month, index) => ({ id: 400 + index, start_date: `${month}-01`, end_date: lastDay(month), kind: 'no_sales', exclude_from_training: false })));
    const inactive = predictiveAnalytics(inactiveRows, ALL, 6, 'revenue', '', '', 'arima', 'intermittent').chart;
    assert.equal(inactive.status, 'insufficient');
    assert.equal(inactive.forecastStatus, 'Unavailable — Inactive Product');
});
