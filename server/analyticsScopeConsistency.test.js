import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows } from './analytics.js';
import { predictiveAnalytics, prescriptiveAnalytics } from './forecasting.js';
import { narrowScope, provinceKey, scopeSelectionLabel } from '../src/utils/analyticsFilterScope.js';

const row = (id, region, province, category, revenue = 10, orderId = `o${id}`) => ({
    id: String(id), order_id: orderId, order_creation_date: '2025-01-31T00:00:00Z', year_month: '2025-01',
    region, province, category, line_revenue: revenue, quantity: 1, net_quantity: 1,
    returned_quantity: 0, is_included_in_analysis: true, is_exact_duplicate: false
});
const fixture = [row(1, 'R1', 'Cebu', 'Beauty', 10, 'shared'), row(2, 'R1', 'Cebu', 'Fashion', 20, 'shared'),
    row(3, 'R1', 'Cavite', 'Beauty', 30), row(4, 'R2', 'Cavite', 'Beauty', 40), row(5, 'R2', 'Laguna', 'Fashion', 50)];
const B = provinceKey('R1', 'Cebu');
const C = provinceKey('R1', 'Cavite');

test('global category scope can only be narrowed, never widened by predictive choices', () => {
    const global = { period: 'All Available Data', categories: ['Beauty'] };
    const narrowed = narrowScope(global, { categories: ['Fashion', 'Beauty'], provinceKeys: [B] });
    assert.deepEqual(narrowed.categories, ['Beauty']);
    assert.deepEqual(narrowed.provinceKeys, [B]);
    assert.equal(analyzeRows(fixture, narrowed).summary.revenue, 10);
    assert.equal(analyzeRows(fixture, narrowScope(global, { categories: ['Fashion'] })).summary.rows, 0);
    assert.deepEqual(global.categories, ['Beauty']);
});

test('global geographical scope intersects multiple local province selections', () => {
    const global = { period: 'All Available Data', region: 'R1', categories: ['Beauty'] };
    const local = narrowScope(global, { provinceKeys: [B, C, provinceKey('R2', 'Laguna')] });
    assert.equal(analyzeRows(fixture, local).summary.revenue, 40);
    assert.equal(analyzeRows(fixture, narrowScope(global, { provinceKeys: [C] })).summary.revenue, 30);
});

test('descriptive multiple-province comparisons constrain KPIs and distinct orders', () => {
    const result = analyzeRows(fixture, { period: 'All Available Data' }, {
        descriptiveFilters: { categories: ['Beauty', 'Fashion'], provinceKeys: [B] }
    });
    assert.equal(result.summary.revenue, 30);
    assert.equal(result.summary.orders, 1);
    assert.equal(result.summary.rows, 2);
    assert.equal(result.regions.length, 1);
    assert.equal(result.regions[0].provinces.length, 1);
    assert.equal(analyzeRows(fixture, { categories: ['Beauty'] }, { descriptiveFilters: { categories: ['Fashion'] } }).summary.rows, 0);
});

test('repeated place names in different regions remain separate', () => {
    const result = analyzeRows(fixture, {}, { descriptiveFilters: { provinceKeys: [C] } });
    assert.equal(result.summary.revenue, 30);
});

test('prescriptive returns-only mode produces no growth recommendations', () => {
    const result = prescriptiveAnalytics(fixture, { returns: 'Returned / Refunded Only' });
    assert.equal(result.status, 'returns_scope_not_supported');
    assert.deepEqual(result.pairs, []);
    assert.match(result.message, /cannot be used/);
    // Descriptive still supports legitimate return analysis independently.
    assert.equal(analyzeRows(fixture, { returns: 'Returned / Refunded Only' }).summary.rows, 0);
});

test('selected-series labels express the effective overview filters', () => {
    assert.match(scopeSelectionLabel(['Beauty', 'Fashion'], [B, C]), /2 selected categories/);
    assert.match(scopeSelectionLabel(['Beauty'], [B]), /1 selected province/);
});
