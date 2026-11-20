import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProvinceTrendSeries, provinceComparisonKey } from '../src/utils/provinceComparison.js';
import { predictiveAnalytics } from './forecasting.js';

test('province comparisons keep a shared month axis and leave unrecorded periods unavailable', () => {
    const months = [
        { name: '2024-01', partial: false },
        { name: '2024-02', partial: false }
    ];
    const regions = [
        { name: 'Central Visayas', provinces: [{
            name: 'Cebu',
            monthly: [{ name: '2024-01', revenue: 120, orders: 4, quantity: 8, rows: 4 }]
        }] },
        { name: 'CALABARZON', provinces: [{
            name: 'Cavite',
            monthly: [
                { name: '2024-01', revenue: 80, orders: 2, quantity: 3, rows: 2 },
                { name: '2024-02', revenue: 90, orders: 3, quantity: 4, rows: 3 }
            ]
        }] }
    ];
    const selected = [provinceComparisonKey('Central Visayas', 'Cebu'), provinceComparisonKey('CALABARZON', 'Cavite')];
    const series = buildProvinceTrendSeries({ regions, months, selected });

    assert.deepEqual(series.map(item => item.name), ['Cebu · Central Visayas', 'Cavite · CALABARZON']);
    assert.deepEqual(series.map(item => item.rows.map(row => row.name)), [months.map(row => row.name), months.map(row => row.name)]);
    assert.equal(series[0].rows[0].revenue, 120);
    assert.equal(series[0].rows[1].rows, 0);
    assert.equal(series[0].rows[1].partial, false);
    assert.equal(series[1].rows[1].revenue, 90);
});

test('province colors stay stable when the selected subset changes', () => {
    const regions = [{ name: 'Region', provinces: [{ name: 'A', monthly: [] }, { name: 'B', monthly: [] }, { name: 'C', monthly: [] }] }];
    const available = ['A · Region', 'B · Region', 'C · Region'];
    const keyA = provinceComparisonKey('Region', 'A');
    const keyB = provinceComparisonKey('Region', 'B');
    const all = buildProvinceTrendSeries({ regions, selected: [keyA, keyB], available });
    const subset = buildProvinceTrendSeries({ regions, selected: [keyB], available });
    assert.equal(all[1].color, subset[0].color);
});

test('province chart forecasts use each province history and honor the selected category filter', () => {
    const rows = [];
    for (let monthIndex = 0; monthIndex < 24; monthIndex += 1) {
        const date = new Date(Date.UTC(2023, monthIndex, 1));
        const month = date.toISOString().slice(0, 7);
        for (const [province, multiplier] of [['Cebu', 1], ['Cavite', 3]]) {
            for (const category of ['Beauty', 'Fashion']) {
                const value = (100 + monthIndex * 5) * multiplier * (category === 'Beauty' ? 1 : 10);
                rows.push({
                    id: `${province}-${category}-${month}`,
                    order_id: `${province}-${category}-${month}`,
                    order_creation_date: `${month}-01T00:00:00Z`,
                    year_month: month,
                    region: province === 'Cebu' ? 'Central Visayas' : 'CALABARZON',
                    province,
                    category,
                    line_revenue: value,
                    quantity: 1,
                    net_quantity: 1,
                    returned_quantity: 0,
                    return_refund_status: null,
                    is_included_in_analysis: true,
                    is_exact_duplicate: false
                });
            }
        }
    }
    const filters = { period: 'All Available Data', categories: ['Beauty'] };
    const cebu = predictiveAnalytics(rows, filters, 3, 'revenue', '', provinceComparisonKey('Central Visayas', 'Cebu'), 'arima', 'strict', true).chart;
    const cavite = predictiveAnalytics(rows, filters, 3, 'revenue', '', provinceComparisonKey('CALABARZON', 'Cavite'), 'arima', 'strict', true).chart;

    assert.equal(cebu.history[0].value, 100);
    assert.equal(cavite.history[0].value, 300);
    assert.notDeepEqual(cebu.forecast.map(point => point.value), cavite.forecast.map(point => point.value));
});
