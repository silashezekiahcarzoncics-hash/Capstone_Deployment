import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { predictiveAnalytics, prescriptiveAnalytics } from './forecasting.js';

// ---- fixtures: one transaction row per order, per (province, category, month) ----
const addMonths = (month, n) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const lastDay = month => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
let nextId = 0;
function monthlyRows(values, { start = '2023-01', region = 'R', province = 'P', category = 'C' } = {}) {
    const rows = [];
    values.forEach((value, index) => {
        const month = addMonths(start, index);
        for (let k = 0; k < 3; k += 1) {
            rows.push({
                id: String(nextId += 1), order_id: `${province}-${category}-${month}-${k}`,
                order_creation_date: `${k === 0 ? `${month}-01` : lastDay(month)}T00:00:00Z`, year_month: month,
                region, province, category, line_revenue: value / 3, quantity: value / 3, net_quantity: value / 3,
                returned_quantity: 0, return_refund_status: null, is_included_in_analysis: true, is_exact_duplicate: false
            });
        }
    });
    return rows;
}
const ALL = { period: 'All Available Data' };
const series = (n, base, slope, amplitude) => Array.from({ length: n }, (_, i) => base + slope * i + amplitude * Math.sin(i / 2) + (i * 7) % 23);
const rows = [
    ...monthlyRows(series(30, 300, 4, 30), { province: 'Bulacan', region: 'III', category: 'Beauty' }),
    ...monthlyRows(series(30, 900, -3, 60), { province: 'Bulacan', region: 'III', category: 'Home' }),
    ...monthlyRows(series(30, 150, 9, 15), { province: 'Cavite', region: 'IV-A', category: 'Beauty' }),
    ...monthlyRows(series(30, 500, 1, 80), { province: 'Cavite', region: 'IV-A', category: 'Home' }),
    ...monthlyRows(series(30, 220, 2, 20), { province: 'Cebu', region: 'VII', category: 'Beauty' })
];

test('Prescriptive accepts the "auto" model and reports which model it assigned', () => {
    const result = prescriptiveAnalytics(rows, ALL, 6, 'revenue', 'auto');
    assert.ok(result.pairs.length >= 5, 'pairs are produced');
    assert.equal(result.modelAssignment.requested, 'auto');
    assert.ok(['arima', 'prophet', 'random_forest'].includes(result.modelAssignment.assignedModel));
    assert.equal(result.model, result.modelAssignment.assignedModelName, 'the displayed model is the assigned model');
});

test('Prescriptive "auto" gives the same forecasts as Predictive "auto" for every pair', () => {
    const presc = prescriptiveAnalytics(rows, ALL, 6, 'revenue', 'auto');
    const pred = predictiveAnalytics(rows, ALL, 6, 'revenue', '', '', 'auto');
    assert.equal(presc.modelAssignment.assignedModel, pred.modelAssignment.assignedModel, 'both pages resolve auto to the same model');
    const predByKey = new Map(pred.overview.map(item => [item.key, item]));
    let compared = 0;
    for (const pair of presc.pairs.filter(item => item.forecastAvailable)) {
        const match = predByKey.get(pair.key);
        assert.ok(match, `Predictive overview has ${pair.key}`);
        assert.ok(Math.abs(pair.forecastDemand - match.forecastDemand) < 0.01, `${pair.key}: forecast per month`);
        assert.equal(pair.forecastBeatsBenchmark, match.validation?.beatsBaseline ?? null, `${pair.key}: benchmark result`);
        const mape = match.validation?.mape ?? null;
        if (mape === null) assert.equal(pair.forecastMape, null);
        else assert.equal(pair.forecastMape, Math.round(mape * 10) / 10, `${pair.key}: forecast accuracy (Prescriptive shows MAPE to 1 decimal)`);
        compared += 1;
    }
    assert.ok(compared >= 5, 'at least five pairs were compared');
});

test('Prescriptive "auto" equals running the assigned model explicitly', () => {
    const auto = prescriptiveAnalytics(rows, ALL, 6, 'revenue', 'auto');
    const explicit = prescriptiveAnalytics(rows, ALL, 6, 'revenue', auto.modelAssignment.assignedModel);
    assert.deepEqual(auto.pairs, explicit.pairs);
    assert.deepEqual(auto.categories, explicit.categories);
});

test('unsupported model names are still rejected', () => {
    assert.throws(() => prescriptiveAnalytics(rows, ALL, 6, 'revenue', 'neural'), /supported forecasting model/);
    assert.throws(() => prescriptiveAnalytics(rows, ALL, 6, 'revenue', ''), /supported forecasting model/);
    assert.throws(() => prescriptiveAnalytics(rows, ALL, 4, 'revenue', 'auto'), /3, 6, 9, or 12/);
});

test('the returns-only scope is unchanged when the model is "auto"', () => {
    const result = prescriptiveAnalytics(rows, { ...ALL, returns: 'Returned / Refunded Only' }, 6, 'revenue', 'auto');
    assert.equal(result.status, 'returns_scope_not_supported');
});

test('every forecast route accepts the same model names (guards against the two allow-lists drifting apart)', () => {
    const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
    const lists = [...source.matchAll(/\[((?:"[a-z_]+",?\s*)+)\]\.includes\(model\)/g)]
        .map(match => match[1].match(/"([a-z_]+)"/g).map(item => item.replaceAll('"', '')).sort());
    assert.ok(lists.length >= 2, 'found the model allow-lists of the predictive and prescriptive routes');
    for (const list of lists) assert.deepEqual(list, ['arima', 'auto', 'prophet', 'random_forest']);
});
