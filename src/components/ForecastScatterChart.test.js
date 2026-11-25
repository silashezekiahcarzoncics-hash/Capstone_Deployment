import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('scatter chart mounts with accuracy tooltips and an empty state without throwing', async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
    try {
        const { default: ForecastScatterChart } = await vite.ssrLoadModule('/src/components/ForecastScatterChart.jsx');
        const rows = Array.from({ length: 12 }, (_, index) => ({
            key: `pair-${index}`,
            province: `Province ${index}`,
            region: 'Region',
            category: index % 2 ? 'Bottle' : 'Mailer',
            forecastDemand: 100 + index * 10,
            growth: index === 11 ? 400 : index * 2 - 8,
            validation: { mape: index * 5 },
            forecastStatus: index % 2 ? 'Available — Validated' : 'Available — Exploratory',
            reliability: index % 2 ? 'backtested' : 'backtested_weak',
            status: 'available',
            model: 'ARIMA'
        }));
        const props = {
            rows,
            target: 'revenue',
            onSelect() {},
            highlightedKey: 'pair-0',
            formatValue: value => `₱${value}`,
            formatPercent: value => `${value}%`
        };
        const html = renderToString(React.createElement(ForecastScatterChart, props));
        assert.match(html, /Scatter plot of forecast per month versus growth/);
        assert.match(html, /Forecast accuracy:/);
        assert.match(html, /shown at the edge/);
        assert.match(html, /Product category/);

        const emptyHtml = renderToString(React.createElement(ForecastScatterChart, { ...props, rows: [
            { ...rows[0], growth: null },
            { ...rows[1], forecastDemand: null }
        ] }));
        assert.match(emptyHtml, /Not enough pairs with forecast and growth values/);
    } finally {
        await vite.close();
    }
});

test('scatter chart uses plain-language wording, an explain button, and undistorted drawing', async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
    try {
        const { default: ForecastScatterChart } = await vite.ssrLoadModule('/src/components/ForecastScatterChart.jsx');
        const { default: ForecastScatterExplainer } = await vite.ssrLoadModule('/src/components/ForecastScatterExplainer.jsx');
        const { buildScatterInsights, calculateForecastScatter } = await vite.ssrLoadModule('/src/utils/forecastScatter.js');
        const make = (index, category) => ({
            key: `p-${index}`, province: `Province ${index}`, region: 'Region', category,
            forecastDemand: 1000 + index * 300, growth: index % 2 ? 12 + index : -6 - index,
            validation: { mape: 8 + index * 4 }, forecastStatus: 'Available — Validated', reliability: 'backtested', status: 'available', model: 'ARIMA'
        });
        const base = { target: 'revenue', onSelect() {}, highlightedKey: '', formatValue: value => `₱${value}`, formatPercent: value => `${value}%` };

        const oneCategory = renderToString(React.createElement(ForecastScatterChart, { ...base, rows: Array.from({ length: 8 }, (_, i) => make(i, 'Shrink Wrap')) }));
        assert.doesNotMatch(oneCategory, /Color by/, 'no product coloring choice when there is a single category');
        assert.match(oneCategory, /Explain this chart/);
        assert.match(oneCategory, /Spread out small values/);
        assert.match(oneCategory, /Typical forecast/);
        assert.match(oneCategory, /Expected growth vs\. recent months/);
        assert.match(oneCategory, /Each dot is one province and product/);
        assert.match(oneCategory, /Smaller &amp; growing|Bigger &amp; growing|Bigger but shrinking|Smaller &amp; shrinking/);
        assert.doesNotMatch(oneCategory, /preserveAspectRatio="none"/, 'drawing must not be stretched');
        assert.doesNotMatch(oneCategory, /<title>/, 'no native tooltip on top of the custom tooltip');
        assert.doesNotMatch(oneCategory, /Log scale|Median forecast|vs\. baseline/, 'old jargon removed');

        const twoCategories = renderToString(React.createElement(ForecastScatterChart, { ...base, rows: Array.from({ length: 8 }, (_, i) => make(i, i % 2 ? 'Bottle' : 'Mailer')) }));
        assert.match(twoCategories, /Color by/);

        const insights = buildScatterInsights(calculateForecastScatter(Array.from({ length: 8 }, (_, i) => make(i, 'Shrink Wrap'))).points);
        const explainer = renderToString(React.createElement(ForecastScatterExplainer, { insights, target: 'revenue', formatValue: base.formatValue, formatPercent: base.formatPercent, showSpreadHint: true, onClose() {} }));
        assert.match(explainer, /How to read this chart/);
        assert.doesNotMatch(explainer, /A plain-language guide\. No statistics background needed\.|What am I looking at\?/);
        assert.match(explainer, /role="dialog"/);
        assert.match(explainer, /What it says about your data right now/);
        assert.match(explainer, /<strong>8<\/strong>/);
        assert.match(explainer, /Spread out small values/);
        const emptyExplainer = renderToString(React.createElement(ForecastScatterExplainer, { insights: buildScatterInsights([]), target: 'orders', formatValue: base.formatValue, formatPercent: base.formatPercent, onClose() {} }));
        assert.match(emptyExplainer, /no pairs with both a forecast and a growth value/);
    } finally {
        await vite.close();
    }
});
