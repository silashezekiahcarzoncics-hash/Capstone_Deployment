import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows, attachAdjustments, prepareAnalyticsSnapshot, shiftMonth } from './analytics.js';
import { predictiveAnalytics, prescriptiveAnalytics, runModel, PRESCRIPTIVE_WEIGHTS } from './forecasting.js';

let id = 0;
const row = (day, extra = {}) => ({ id: String(++id), order_id: `order-${id}`, order_creation_date: day, year_month: day.slice(0, 7), region: 'R', province: 'P', category: 'A', line_revenue: 100, quantity: 10, net_quantity: 10, returned_quantity: 0, is_included_in_analysis: true, is_exact_duplicate: false, ...extra });
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthly = (fn = i => 100 + i * 10) => Array.from({ length: 30 }, (_, i) => {
    const month = shiftMonth('2023-01', i);
    return [row(`${month}-01`, { line_revenue: fn(i) }), row(lastDay(month), { line_revenue: fn(i) })];
}).flat();
const partial = { period: 'Custom Range', start: '2023-01-15', end: '2025-06-15' };

test('partial custom scope compares only full corresponding months and keeps recorded descriptive revenue', () => {
    const rows = prepareAnalyticsSnapshot(monthly());
    const d = analyzeRows(rows, partial);
    assert.equal(d.trend[0].partial, true);
    assert.equal(d.trend.at(-1).partial, true);
    assert.equal(d.summary.revenue, rows.filter(r => r.order_creation_date >= partial.start && r.order_creation_date <= partial.end).reduce((sum, r) => sum + r.line_revenue, 0));
    const p = prescriptiveAnalytics(rows, partial).pairs[0];
    assert.equal(p.yoyMonthsCompared, 11);
    assert.deepEqual(p.yoyMonths, Array.from({ length: 11 }, (_, i) => shiftMonth('2024-07', i)));
    assert.equal(p.yoyGrowth, 57.1);
    assert.equal(predictiveAnalytics(rows, partial).chart.status, 'insufficient');
    assert.deepEqual(PRESCRIPTIVE_WEIGHTS, { demandStrength: .35, growthMomentum: .30, demandConsistency: .20, categoryAffinity: .15 });
});

test('intermittent projections skip excluded trailing periods for values and uncertainty', () => {
    const rows = prepareAnalyticsSnapshot(monthly(i => 100 + i * 20));
    attachAdjustments(rows, [{ id: 1, start_date: '2025-05-01', end_date: '2025-06-30', kind: 'closure', exclude_from_training: true }]);
    const args = [{}, 6, 'revenue', '', '', 'arima'];
    const c = predictiveAnalytics(rows, ...args, 'intermittent').chart;
    assert.equal(c.status, 'available');
    assert.equal(c.forecast[0].month, '2025-07');
    const values = c.history.filter(point => point.value !== null).map(point => point.value);
    assert.deepEqual(c.forecast.map(point => point.value), runModel(values, 8, 'arima').slice(2));
    assert.equal(c.forecast[0].lower, c.forecast[0].value - c.validation.rmse * Math.sqrt(3));
});

for (const exclude_from_training of [false, true]) test(`data gap is unknown in every mode (manual exclusion ${exclude_from_training})`, () => {
    const rows = prepareAnalyticsSnapshot(monthly());
    attachAdjustments(rows, [{ id: 1, start_date: '2025-05-01', end_date: '2025-05-31', kind: 'data_gap', exclude_from_training }]);
    const d = analyzeRows(rows).trend.find(point => point.name === '2025-05');
    assert.equal(d.revenue, 760);
    assert.ok(d.adjustmentKinds.includes('data_gap'));
    for (const mode of ['strict', 'confirmed_zero', 'intermittent']) {
        const c = predictiveAnalytics(rows, {}, 6, 'revenue', '', '', 'arima', mode).chart;
        assert.equal(c.status, 'insufficient');
        assert.match(c.reason, /data-gap adjustment/);
        assert.equal(c.history.find(point => point.month === '2025-05').value, null);
        assert.ok(!c.coverage.imputedMonths.includes('2025-05'));
        assert.equal(c.forecast.length, 0);
        const p = prescriptiveAnalytics(rows, {}, 6, 'revenue', 'arima', mode).pairs[0];
        assert.ok(!p.yoyMonths?.includes('2025-05'));
        assert.equal(p.eligible, false);
        assert.equal(p.opportunityScore, null);
    }
    const a = predictiveAnalytics(rows, {}, 6, 'revenue', '', '', 'auto');
    assert.equal(a.chart.status, 'insufficient');
    assert.equal(a.modelAssignment.finalHoldout, null);
    assert.equal(a.modelAssignment.comparedModels.every(model => model.scoredMonths === 0), true);
    // Changing the adjustment invalidates cached analysis, not the mathematical model.
    attachAdjustments(rows, []);
    assert.equal(predictiveAnalytics(rows).chart.status, 'available');
});

test('unknown demand is not substituted with zero or used for ranking', () => {
    const rows = monthly().filter(r => r.year_month !== '2025-05');
    const p = prescriptiveAnalytics(rows).pairs[0];
    const recent = rows.filter(r => r.year_month >= '2024-07');
    assert.equal(p.demand, recent.reduce((sum, r) => sum + r.line_revenue, 0) / 11);
    assert.match(p.demandBasis, /Observed-month average/);
    assert.equal(p.eligible, false);
    assert.equal(p.opportunityScore, null);
});

test('verified no-sales is zero, not unknown, in flexible modes', () => {
    const rows = monthly().filter(r => r.year_month !== '2025-05');
    attachAdjustments(rows, [{ id: 1, start_date: '2025-05-01', end_date: '2025-05-31', kind: 'no_sales', exclude_from_training: false }]);
    assert.equal(predictiveAnalytics(rows).chart.status, 'insufficient');
    for (const mode of ['confirmed_zero', 'intermittent']) {
        const c = predictiveAnalytics(rows, {}, 6, 'revenue', '', '', 'arima', mode).chart;
        assert.equal(c.history.find(point => point.month === '2025-05').value, 0);
        assert.equal(c.status, 'available');
    }
});

test('unresolved approved returns warn in each module without changing known sales', () => {
    const rows = [row('2024-01-01', { returned_quantity: null, return_refund_status: 'Request Approved' }), row('2024-01-31', { returned_quantity: 0, return_refund_status: 'Approved', category: 'B' }), row('2024-01-31', { returned_quantity: 2, net_quantity: 8, return_refund_status: 'Approved' }), row('2024-01-31', { returned_quantity: null, return_refund_status: 'Approved', is_exact_duplicate: true })];
    const d = analyzeRows(rows, { categories: ['A'], returns: 'Exclude Approved Returns' });
    assert.equal(d.summary.revenue, 180);
    assert.match(d.qualityWarnings[0], /^1 approved/);
    assert.match(analyzeRows(rows, { returns: 'Returned / Refunded Only' }).qualityWarnings[0], /^2 approved/);
    assert.match(predictiveAnalytics(rows).qualityWarnings[0], /^2 approved/);
    assert.match(predictiveAnalytics(rows, {}, 6, 'revenue', '', '', 'arima', 'strict', true).qualityWarnings[0], /^2 approved/);
    assert.match(prescriptiveAnalytics(rows).qualityWarnings[0], /^2 approved/);
});

test('invalid calendar dates rejected across all analytics, valid leap dates accepted', () => {
    for (const day of ['2024-02-30', '2023-02-29', '2024-13-01', '2024-00-01', '2024-04-31']) {
        const filters = { period: 'Custom Range', start: day, end: '2025-01-01' };
        for (const fn of [analyzeRows, predictiveAnalytics, prescriptiveAnalytics]) assert.throws(() => fn(monthly(), filters), /valid start and end date/);
    }
    assert.doesNotThrow(() => analyzeRows(monthly(), { period: 'Custom Range', start: '2024-02-29', end: '2024-03-31' }));
});

test('distinct-order definition does not claim province or month counts are additive', () => {
    const rows = [row('2024-01-01', { order_id: 'shared' }), row('2024-02-29', { order_id: 'shared', province: 'Q' })];
    const d = analyzeRows(rows);
    assert.equal(d.summary.orders, 1);
    assert.equal(d.trend.reduce((n, month) => n + month.orders, 0), 2);
    assert.match(d.definitions.orders, /grouped counts may exceed/);
});
