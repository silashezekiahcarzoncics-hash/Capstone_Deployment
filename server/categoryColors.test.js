import test from 'node:test';
import assert from 'node:assert/strict';
import { categorySeriesColor } from '../src/utils/categorySeriesColor.js';

test('category colors stay stable across chart selections and remain distinct', () => {
    const categories = ['Beauty', 'Fashion', 'Electronics', 'Home', 'Sports'];
    assert.equal(categorySeriesColor('Beauty', categories), '#286be3');
    assert.equal(categorySeriesColor('Fashion', categories), '#e88924');
    assert.equal(categorySeriesColor('Electronics', categories), '#169b72');
    assert.equal(categorySeriesColor('Fashion', categories), categorySeriesColor('Fashion', ['Fashion', 'Home']));
    assert.equal(new Set(categories.map(category => categorySeriesColor(category, categories))).size, categories.length);
});
