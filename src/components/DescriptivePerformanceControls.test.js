import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("geographic controls expose map and heatmap views with all three shared metric choices", async () => {
    const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
    try {
        const { default: DescriptivePerformanceControls } = await vite.ssrLoadModule("/src/components/DescriptivePerformanceControls.jsx");
        const labels = ["Revenue", "Order Count", "Units Sold"];
        const views = ["Geographic Performance", "Province × Category Heatmap"];

        for (const view of ["geography", "heatmap"]) {
            for (const metric of ["revenue", "orders", "quantity"]) {
                const html = renderToStaticMarkup(React.createElement(DescriptivePerformanceControls, {
                    view,
                    metric,
                    onViewChange() {},
                    onMetricChange() {}
                }));
                for (const label of [...labels, ...views]) assert.ok(html.includes(label), `control is available: ${label}`);
                assert.ok(!html.includes("Product Category Performance"), "the category drill-down is not a geographic view toggle");
                assert.match(html, new RegExp(`aria-pressed="true"[^>]*>${metric === "revenue" ? "Revenue" : metric === "orders" ? "Order Count" : "Units Sold"}`));
                assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2, "one view and one metric are selected");
            }
        }
    } finally {
        await vite.close();
    }
});
