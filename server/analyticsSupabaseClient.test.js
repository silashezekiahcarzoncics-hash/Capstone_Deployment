import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createAnalyticsCache, loadMasterRows } from "./analytics.js";

// Integration check with the REAL supabase-js client against a local server that behaves like Supabase's REST API
// and can be made slow. It proves that a timeout really arrives as "TimeoutError: The operation was aborted due to
// timeout" (the message users saw) and that the retry / stale-data protection reacts to it.
const row = index => ({ id: String(index), order_id: `order-${index}`, order_creation_date: "2025-01-15", year_month: "2025-01", region: "R", province: "P", category: "C", line_revenue: 10, quantity: 1, net_quantity: 1, returned_quantity: 0, return_refund_status: null, is_included_in_analysis: true, is_exact_duplicate: false });

async function startFakeSupabase({ total = 2500 } = {}) {
    const rows = Array.from({ length: total }, (_, index) => row(index));
    const state = { requests: [], slowOffsets: new Map() }; // offset -> number of requests that should hang
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.endsWith("/data_adjustments")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("[]"); }
        const offset = Number(url.searchParams.get("offset") || 0);
        const limit = Number(url.searchParams.get("limit") || 1000);
        state.requests.push(offset);
        const respond = () => {
            const data = rows.slice(offset, offset + limit);
            res.writeHead(200, { "content-type": "application/json", "content-range": `${offset}-${offset + data.length - 1}/${rows.length}` });
            res.end(JSON.stringify(data));
        };
        const hangsLeft = state.slowOffsets.get(offset) || 0;
        if (hangsLeft > 0) { state.slowOffsets.set(offset, hangsLeft - 1); return; } // never answers: the client's time limit must fire
        respond();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = createClient(`http://127.0.0.1:${server.address().port}`, "test-key", { auth: { persistSession: false } });
    return { client, state, close: () => { server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); } };
}
const FAST = { pageTimeoutMs: 150, timeoutGrowthMs: 150, maxAttempts: 3, retryDelayMs: 5 };

test("real supabase-js: a page that hangs once is retried and the load completes", async () => {
    const fake = await startFakeSupabase();
    try {
        fake.state.slowOffsets.set(1000, 1);
        const rows = await loadMasterRows(fake.client, FAST);
        assert.equal(rows.length, 2500);
        assert.equal(fake.state.requests.filter(offset => offset === 1000).length, 2, "the slow page was requested twice");
    } finally { await fake.close(); }
});

test("real supabase-js: a page that never answers fails with the exact message users saw, after every attempt", async () => {
    const fake = await startFakeSupabase();
    try {
        fake.state.slowOffsets.set(1000, 99);
        await assert.rejects(loadMasterRows(fake.client, FAST),
            /Unable to load Supabase analytics: TimeoutError: The operation was aborted due to timeout/);
        assert.equal(fake.state.requests.filter(offset => offset === 1000).length, 3);
    } finally { await fake.close(); }
});

test("real supabase-js: when Supabase hangs after a good load, users keep getting the last complete data", async t => {
    t.mock.method(console, "warn", () => {});
    const fake = await startFakeSupabase();
    try {
        let time = 1000;
        const cache = createAnalyticsCache(fake.client, { ttl: 1000, now: () => time, staleGraceMs: 2000, loadOptions: FAST });
        assert.equal((await cache.get()).rows.length, 2500);
        time += 1001;
        fake.state.slowOffsets.set(0, 99); // the first page now never answers
        const served = await cache.get();
        assert.equal(served.stale, true);
        assert.equal(served.rows.length, 2500);
        assert.match(served.staleReason, /TimeoutError/);
    } finally { await fake.close(); }
});
