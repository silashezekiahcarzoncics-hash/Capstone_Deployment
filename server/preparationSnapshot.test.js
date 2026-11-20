import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPreparationService } from "./preparation.js";

function makeRow(id, extra = {}) {
  return { id, etl_run_id: "run-live", source_file_name: "January_2026.xlsx", source_row_number: id,
    order_id: `order-${id}`, order_status: "Completed", return_refund_status: null,
    order_creation_date: "2026-01-10", year: 2026, month: 1, month_name: "January",
    month_number: 1, year_month: "2026-01", quarter: "Q1", raw_province: "Visayas",
    raw_city: "Leyte", region: "Visayas", province: "Leyte", raw_product_name: "Bottle",
    category: "Bottle / Container", quantity: 1, returned_quantity: 0, net_quantity: 1,
    line_revenue: 100, is_exact_duplicate: false, is_included_in_analysis: true, ...extra };
}

test("replaces the existing prepared staging file and serves the synchronized rows through existing preparation APIs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saipher-snapshot-stage-"));
  try {
    const uploadDir = path.join(dir, "uploads"); fs.mkdirSync(uploadDir);
    const databaseFile = path.join(dir, "database.json");
    fs.writeFileSync(databaseFile, JSON.stringify({ imports: [{ fileName: "kept.xlsx", status: "Ready" }] }));
    fs.writeFileSync(path.join(dir, "prepared_master_data.json"), JSON.stringify([{ id: "old-row" }]));
    const service = createPreparationService({ uploadDir, dataDir: dir, databaseFile });
    service.replaceWithSupabaseSnapshot({
      syncedAt: "2026-01-12T00:00:00.000Z",
      latestRun: { run_id: "run-live" },
      mappingCounts: { products: 1, geography: 1 },
      summary: {},
      transactions: [makeRow(1, { subcategory: "legacy" }), makeRow(2, { id: 2, order_id: "order-2", is_exact_duplicate: true, is_included_in_analysis: false })],
      productMapping: [{ raw_product_name: "Bottle", category: "Bottle / Container", mapping_status: "Mapped" }],
      geographicMapping: [{ raw_province: "Visayas", raw_city: "Leyte", region: "Visayas", province: "Leyte" }]
    });

    const stored = JSON.parse(fs.readFileSync(path.join(dir, "prepared_master_data.json"), "utf8"));
    assert.equal(stored.length, 2);
    assert.ok(stored.every(row => !Object.hasOwn(row, "subcategory")));
    assert.deepEqual(JSON.parse(fs.readFileSync(databaseFile, "utf8")).imports.map(item => item.fileName), ["kept.xlsx"]);
    assert.equal(service.profile().source.transactionLines, 2);
    assert.equal(service.profile().source.uniqueOrders, 2);
    assert.equal(service.products().records[0].category, "Bottle / Container");
    assert.equal(service.geography().records[0].province, "Leyte");
    assert.equal(service.duplicates().total, 1);
    assert.equal(service.masterSummary().records, 2);
    assert.equal(service.masterSummary().prepared, false);
    assert.equal(service.status().readOnlySnapshot, true);
    assert.equal(service.timeSummary().periods[0].yearMonth, "2026-01");
    assert.throws(() => service.run(), /read-only in Staging Data/);
    // Synchronized data supports category-only editing without reconstructing
    // missing source-workbook fields or touching Supabase.
    service.saveProductMapping({ rawProductName: "Bottle", category: "Other / Unclassified" });
    assert.equal(service.products().records[0].category, "Other / Unclassified");
    assert.equal(service.products().records[0].status, "Review");
    assert.equal(service.listCategories().categories.find(x => x.name === "Other / Unclassified").productCount, 1);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "prepared_master_data.json"), "utf8"))
      .every(row => row.category === "Other / Unclassified"));
    service.saveProductMapping({ rawProductName: "Bottle", category: "Plastic Bags" });
    assert.equal(service.products().records[0].status, "Mapped");
    assert.equal(service.listCategories().categories.find(x => x.name === "Plastic Bags").productCount, 1);
    service.addCategory("Gift Packaging");
    assert.ok(service.listCategories().categories.some(x => x.name === "Gift Packaging"));
    service.saveProductMapping({ rawProductName: "Bottle", category: "Gift Packaging" });
    assert.equal(service.listCategories().categories.find(x => x.name === "Gift Packaging").productCount, 1);
    assert.throws(() => service.deleteCategory("Gift Packaging"), /currently assigned/);
    service.renameCategory("Gift Packaging", "Gifts & Wrapping");
    assert.equal(service.products().records[0].category, "Gifts & Wrapping");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "prepared_master_data.json"), "utf8"))[0].category, "Gifts & Wrapping");
    const reopened = createPreparationService({ uploadDir, dataDir: dir, databaseFile });
    assert.equal(reopened.products().records[0].category, "Gifts & Wrapping");
    reopened.saveProductMapping({ rawProductName: "Bottle", category: "Plastic Bags" });
    reopened.deleteCategory("Gifts & Wrapping");
    assert.ok(!reopened.listCategories().categories.some(x => x.name === "Gifts & Wrapping"));
    assert.equal(reopened.status().readOnlySnapshot, true);
    assert.equal(reopened.masterSummary().prepared, false);
    assert.equal(service.activateLocalImports(), true);
    assert.equal(fs.existsSync(path.join(dir, "prepared_master_data.json")), false);
    assert.equal(service.status().readOnlySnapshot, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
