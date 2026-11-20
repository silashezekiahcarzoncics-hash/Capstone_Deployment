import test from "node:test";
import assert from "node:assert/strict";
import { downloadPublishedSnapshot } from "./stagingSync.js";

const transaction = id => ({ id, etl_run_id: "run-1", order_id: `order-${id}`,
  order_status: "Completed", return_refund_status: null, order_creation_date: "2026-01-10",
  year_month: "2026-01", region: "Visayas", province: "Leyte", raw_province: "Visayas",
  raw_city: "Leyte", raw_product_name: "Bottle", category: "Bottle / Container",
  quantity: 1, returned_quantity: 0, net_quantity: 1, line_revenue: 100,
  is_exact_duplicate: false, is_included_in_analysis: true });

function fakeClient(tables, { pageCap = 1000, errorAt = null, emptyAt = null } = {}) {
  const writes = [];
  const client = { writes, from(table) {
    const query = { range: null, filters: [], limit: null };
    const builder = {
      select(_columns, options) { query.count = Boolean(options?.count); return builder; },
      order() { return builder; },
      range(from, to) { query.range = [from, to]; return builder; },
      eq(key, value) { query.filters.push([key, value]); return builder; },
      limit(limit) { query.limit = limit; return builder; },
      abortSignal() { return builder; },
      insert() { writes.push("insert"); return builder; },
      update() { writes.push("update"); return builder; },
      delete() { writes.push("delete"); return builder; },
      then(resolve, reject) {
        if (table === errorAt) return reject(new Error("network interrupted"));
        let rows = tables[table] || [];
        for (const [key, value] of query.filters) rows = rows.filter(row => row[key] === value);
        const count = query.count ? (tables[table] || []).length : null;
        if (query.range) {
          if (query.range[0] === emptyAt) rows = [];
          else rows = rows.slice(query.range[0], Math.min(query.range[1] + 1, query.range[0] + pageCap));
        }
        if (query.limit !== null) rows = rows.slice(0, query.limit);
        resolve({ data: rows, count, error: null });
      }
    };
    return builder;
  } };
  return client;
}

test("downloads a full 60,000-row dataset in batches and never writes to Supabase", async () => {
  const client = fakeClient({
    master_transactions: Array.from({ length: 60000 }, (_, index) => transaction(index + 1)),
    product_mapping: [{ id: 1, raw_product_name: "Bottle", category: "Bottle / Container", mapping_status: "Mapped" }],
    geographic_mapping: [{ id: 1, raw_province: "Visayas", raw_city: "Leyte", region: "Visayas", province: "Leyte" }],
    etl_runs: [{ run_id: "run-1", created_at: "2026-01-11", status: "completed", source_row_count: 60000 }]
  }, { pageCap: 500 });
  const result = await downloadPublishedSnapshot(client);
  assert.equal(result.records, 60000);
  assert.equal(result.transactions.length, 60000);
  assert.equal(result.transactions.at(-1).id, 60000);
  assert.equal(result.productMapping.length, 1);
  assert.equal(result.geographicMapping.length, 1);
  assert.equal(result.latestRun.run_id, "run-1");
  assert.deepEqual(client.writes, []);
});

test("rejects empty, incomplete, duplicate, invalid, and interrupted downloads", async () => {
  const dimensions = { product_mapping: [], geographic_mapping: [], etl_runs: [] };
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: [] })), /no published transactions/);
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: [transaction(1), transaction(1)] })), /duplicate transaction ID/);
  const missingField = transaction(1); delete missingField.raw_city;
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: [missingField] })), /missing required fields: raw_city/);
  const invalidNumber = transaction(1); invalidNumber.line_revenue = "unknown";
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: [invalidNumber] })), /invalid line_revenue/);
  const pages = Array.from({ length: 1001 }, (_, index) => transaction(index + 1));
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: pages }, { pageCap: 1000, emptyAt: 1000 })), /download is incomplete/);
  await assert.rejects(downloadPublishedSnapshot(fakeClient({ ...dimensions, master_transactions: [transaction(1)] }, { errorAt: "master_transactions" })), /network interrupted/);
  await assert.rejects(downloadPublishedSnapshot(null), /not configured/);
});
