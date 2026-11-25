import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { buildProvinceCategoryHeatmap } from "../utils/provinceCategoryHeatmap.js";

test("province-category heatmap renders actual values, metric tooltips, and missing data neutrally", async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    try {
        const { default: ProvinceCategoryHeatmap } = await vite.ssrLoadModule("/src/components/ProvinceCategoryHeatmap.jsx");
        const regions = [{ name: "North", provinces: [{
            name: "Alpha", revenue: 20, orders: 2, quantity: 4,
            categories: [
                { name: "Wrap", revenue: 20, orders: 2, quantity: 4 },
                { name: "Tape", revenue: 0, orders: 0, quantity: 0 }
            ]
        }, {
            name: "Beta", revenue: 8, orders: 1, quantity: 2,
            categories: [{ name: "Wrap", revenue: 8, orders: 1, quantity: 2 }]
        }] }];
        const categories = [
            { name: "Wrap", revenue: 28, orders: 3, quantity: 6 },
            { name: "Tape", revenue: 0, orders: 0, quantity: 0 }
        ];
        const heatmap = buildProvinceCategoryHeatmap(regions, categories, "revenue");
        const html = renderToStaticMarkup(React.createElement(ProvinceCategoryHeatmap, { heatmap, metric: "revenue", onSelectCell() {} }));

        assert.match(html, /Alpha/);
        assert.match(html, /Wrap/);
        assert.match(html, /Revenue: \u20b120\.00/);
        assert.match(html, /Revenue: unavailable/);
        assert.match(html, /class="descriptive-heatmap-cell missing"/);
        assert.match(html, />\u20b10\.00</);
        assert.match(html, /color:#[^;]+/);
        assert.match(html, /Select to inspect this province and category/);
    } finally {
        await vite.close();
    }
});

test("empty heatmap shows a filtered empty state instead of invented cells", async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    try {
        const { default: ProvinceCategoryHeatmap } = await vite.ssrLoadModule("/src/components/ProvinceCategoryHeatmap.jsx");
        const html = renderToStaticMarkup(React.createElement(ProvinceCategoryHeatmap, {
            heatmap: buildProvinceCategoryHeatmap([], [], "orders"),
            metric: "orders"
        }));
        assert.match(html, /No province and category results match the current filters/);
        assert.doesNotMatch(html, /<table/);
    } finally {
        await vite.close();
    }
});

test("the selected metric changes heatmap values and labels for revenue, orders, and units", async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    try {
        const { default: ProvinceCategoryHeatmap } = await vite.ssrLoadModule("/src/components/ProvinceCategoryHeatmap.jsx");
        const regions = [{ name: "North", provinces: [{
            name: "Alpha", revenue: 25, orders: 3, quantity: 7,
            categories: [{ name: "Wrap", revenue: 25, orders: 3, quantity: 7 }]
        }] }];
        const categories = [{ name: "Wrap", revenue: 25, orders: 3, quantity: 7 }];
        for (const [metric, label, value] of [["revenue", "Revenue", "25.00"], ["orders", "Order Count", ">3<"], ["quantity", "Units Sold", ">7<"]]) {
            const heatmap = buildProvinceCategoryHeatmap(regions, categories, metric);
            const html = renderToStaticMarkup(React.createElement(ProvinceCategoryHeatmap, { heatmap, metric }));
            assert.match(html, new RegExp(`${label}:`));
            assert.ok(html.includes(value), `${metric} cell value is shown`);
        }
    } finally {
        await vite.close();
    }
});
