import test from "node:test";
import assert from "node:assert/strict";
import { buildProvinceCategoryHeatmap, provinceCategorySelectionFilters } from "./provinceCategoryHeatmap.js";

const categories = [
    { name: "X", revenue: 60, orders: 10, quantity: 45 },
    { name: "Y", revenue: 120, orders: 3, quantity: 100 }
];
const regions = [{ name: "North", provinces: [
    { name: "Alpha", revenue: 100, orders: 3, quantity: 50, categories: [
        { name: "X", revenue: 50, orders: 2, quantity: 40 },
        { name: "Y", revenue: 50, orders: 1, quantity: 10 }
    ] },
    { name: "Beta", revenue: 80, orders: 10, quantity: 95, categories: [
        { name: "X", revenue: 10, orders: 8, quantity: 5 },
        { name: "Y", revenue: 70, orders: 2, quantity: 90 }
    ] },
    { name: "Gamma", revenue: 20, orders: 1, quantity: 0, categories: [
        { name: "Y", revenue: 20, orders: 1, quantity: 0 }
    ] }
] }];

test("province and category rankings are independent and follow the selected metric", () => {
    const revenue = buildProvinceCategoryHeatmap(regions, categories, "revenue");
    assert.deepEqual(revenue.provinces.map(item => item.name), ["Alpha", "Beta", "Gamma"]);
    assert.deepEqual(revenue.categories.map(item => item.name), ["Y", "X"]);
    assert.deepEqual(revenue.cells, [[50, 50], [70, 10], [20, null]]);

    const orders = buildProvinceCategoryHeatmap(regions, categories, "orders");
    assert.deepEqual(orders.provinces.map(item => item.name), ["Beta", "Alpha", "Gamma"]);
    assert.deepEqual(orders.categories.map(item => item.name), ["X", "Y"]);

    const quantity = buildProvinceCategoryHeatmap(regions, categories, "quantity");
    assert.deepEqual(quantity.provinces.map(item => item.name), ["Beta", "Alpha", "Gamma"]);
    assert.deepEqual(quantity.categories.map(item => item.name), ["Y", "X"]);
    assert.equal(quantity.cells[2][0], 0, "a recorded zero stays available instead of becoming missing");
    assert.equal(revenue.cells[2][1], null, "an absent category combination stays unavailable");
});

test("heatmap limits the independently ranked province and category lists to ten", () => {
    const manyCategories = Array.from({ length: 12 }, (_, index) => ({ name: `Category ${index}`, revenue: index + 1, orders: index + 1, quantity: index + 1 }));
    const manyProvinces = [{ name: "Region", provinces: Array.from({ length: 13 }, (_, index) => ({
        name: `Province ${index}`,
        revenue: index + 1,
        orders: index + 1,
        quantity: index + 1,
        categories: manyCategories.map(category => ({ ...category }))
    })) }];

    const heatmap = buildProvinceCategoryHeatmap(manyProvinces, manyCategories, "revenue", 15);
    assert.equal(heatmap.provinces.length, 10);
    assert.equal(heatmap.categories.length, 10);
    assert.equal(heatmap.cells.length * heatmap.categories.length, 100);
    assert.equal(heatmap.provinces[0].name, "Province 12");
    assert.equal(heatmap.categories[0].name, "Category 11");
});

test("heatmap cell selection targets one province and category without changing global scope", () => {
    assert.deepEqual(provinceCategorySelectionFilters(
        { name: "Alpha", region: "North" },
        { name: "Y" }
    ), {
        compareBy: "category",
        categories: ["Y"],
        province: "Alpha",
        provinceKey: '["North","Alpha"]',
        provinces: []
    });
});
