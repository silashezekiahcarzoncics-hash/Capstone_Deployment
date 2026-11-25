import test from "node:test";
import assert from "node:assert/strict";
import { createAnalyticsCache, loadAdjustments, loadMasterRows, isTransientSupabaseError } from "./analytics.js";

// A fake Supabase whose behaviour each test can script: slow pages, errors, hanging requests.
const TIMEOUT = { message: "TimeoutError: The operation was aborted due to timeout" };
const row = index => ({ id: String(index), order_id: `order-${index}`, order_creation_date: "2025-01-15", year_month: "2025-01", region: "R", province: "P", category: "C", line_revenue: 10, quantity: 1, net_quantity: 1, returned_quantity: 0, return_refund_status: null, is_included_in_analysis: true, is_exact_duplicate: false });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeDb(total = 3000) {
    const db = {
        rows: Array.from({ length: total }, (_, index) => row(index)),
        attempts: new Map(), pageCalls: 0, signals: [], adjustmentAttempts: 0, adjustmentRows: [],
        behave: () => null,           // ({ from, attempt }) => null | { error } | Promise<null | { error }>
        behaveAdjustments: () => null, // (attempt) => null | { error }
        from(table) {
            if (table !== "data_adjustments") return db;
            return { select: () => ({ order: () => {
                db.adjustmentAttempts += 1;
                const outcome = db.behaveAdjustments(db.adjustmentAttempts);
                const result = outcome?.error ? { data: null, error: outcome.error } : { data: db.adjustmentRows, error: null };
                const query = Promise.resolve(result);
                query.abortSignal = signal => { db.signals.push(signal); return Promise.resolve(result); };
                return query;
            } }) };
        },
        select() { return db; },
        order() { return db; },
        range(from, to) {
            db.pageCalls += 1;
            return { abortSignal: async signal => {
                db.signals.push(signal);
                const attempt = (db.attempts.get(from) || 0) + 1;
                db.attempts.set(from, attempt);
                const outcome = await db.behave({ from, attempt });
                if (outcome?.error) return { data: null, count: null, error: outcome.error };
                return { data: db.rows.slice(from, to + 1), count: db.rows.length, error: null };
            } };
        }
    };
    return db;
}
const quiet = t => t.mock.method(console, "warn", () => {});
const NO_WAIT = { retryDelayMs: 0 };

// ---------------------------------------------------------------- loading pages
test("a page that times out once is retried and the whole load still completes", async () => {
    const db = fakeDb(3000);
    db.behave = ({ from, attempt }) => from === 2000 && attempt === 1 ? { error: TIMEOUT } : null;
    const rows = await loadMasterRows(db, NO_WAIT);
    assert.equal(rows.length, 3000);
    assert.equal(db.attempts.get(2000), 2);
});

test("after the last attempt the original error is reported, so the message stays recognisable", async () => {
    const db = fakeDb(3000);
    db.behave = ({ from }) => from === 1000 ? { error: TIMEOUT } : null;
    await assert.rejects(loadMasterRows(db, { ...NO_WAIT, maxAttempts: 3 }),
        /Unable to load Supabase analytics: TimeoutError: The operation was aborted due to timeout/);
    assert.equal(db.attempts.get(1000), 3);
});

test("errors that retrying cannot fix are reported at once", async () => {
    const db = fakeDb(3000);
    db.behave = () => ({ error: { message: "permission denied for table master_transactions", code: "42501" } });
    await assert.rejects(loadMasterRows(db, NO_WAIT), /permission denied/);
    assert.equal(db.attempts.get(0), 1);
});

test("every attempt gets its own fresh time limit", async () => {
    const db = fakeDb(500);
    db.behave = ({ attempt }) => attempt === 1 ? { error: TIMEOUT } : null;
    await loadMasterRows(db, NO_WAIT);
    assert.equal(db.signals.length, 2);
    assert.ok(db.signals.every(signal => signal instanceof AbortSignal && !signal.aborted));
    assert.notEqual(db.signals[0], db.signals[1]);
});

test("temporary failures are told apart from permanent ones", () => {
    for (const message of ["TimeoutError: The operation was aborted due to timeout", "TypeError: fetch failed", "Bad Gateway",
        "canceling statement due to statement timeout", "Connection interrupted", "ECONNRESET", "Service Unavailable"]) {
        assert.equal(isTransientSupabaseError({ message }), true, message);
    }
    assert.equal(isTransientSupabaseError({ message: "x", status: 503 }), true);
    assert.equal(isTransientSupabaseError({ message: "x", code: "57014" }), true);
    for (const message of ["permission denied for table master_transactions", "JWT expired", "invalid input syntax for type uuid", "column foo does not exist"]) {
        assert.equal(isTransientSupabaseError({ message }), false, message);
    }
    assert.equal(isTransientSupabaseError(null), false);
});

// ---------------------------------------------------------------- the cache
test("with nothing loaded yet a failing database reports the error, then recovers on the next request", async () => {
    const db = fakeDb(1500);
    db.behave = () => ({ error: TIMEOUT });
    const cache = createAnalyticsCache(db, { loadOptions: NO_WAIT });
    await assert.rejects(cache.get(), /TimeoutError/);
    db.behave = () => null;
    assert.equal((await cache.get()).rows.length, 1500);
});

test("when a refresh fails the last COMPLETE data is served, flagged stale, instead of an error", async t => {
    quiet(t);
    let time = 1000;
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, loadOptions: NO_WAIT });
    assert.equal((await cache.get()).rows.length, 3000);
    time += 1001;
    db.behave = () => ({ error: TIMEOUT });
    const served = await cache.get();
    assert.equal(served.stale, true);
    assert.equal(served.rows.length, 3000);
    assert.match(served.staleReason, /TimeoutError/);
});

test("a struggling database is not hit again for every request, and fresh data returns once it recovers", async t => {
    quiet(t);
    let time = 1000;
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, loadOptions: NO_WAIT });
    await cache.get();
    time += 1001;
    db.behave = () => ({ error: TIMEOUT });
    await cache.get();
    const callsAfterFailure = db.pageCalls;
    assert.equal((await cache.get()).stale, true);
    assert.equal((await cache.get()).stale, true);
    assert.equal(db.pageCalls, callsAfterFailure, "no new database calls during the back-off window");
    db.behave = () => null;
    time += 5001;
    const recovered = await cache.get();
    assert.ok(!recovered.stale);
    assert.ok(db.pageCalls > callsAfterFailure);
});

test("a slow refresh does not make the request wait: the last complete data is served and the reload finishes in the background", async () => {
    let time = 1000;
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, staleGraceMs: 25, loadOptions: NO_WAIT });
    await cache.get();
    time += 1001;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    db.rows = Array.from({ length: 3100 }, (_, index) => row(index));
    db.behave = () => gate.then(() => null);
    const startedAt = Date.now();
    const served = await cache.get();
    assert.equal(served.stale, true);
    assert.equal(served.rows.length, 3000);
    assert.ok(Date.now() - startedAt < 1000, "answered after the short grace period, not after the slow reload");
    release();
    let latest = served;
    for (let i = 0; i < 100 && latest.stale; i += 1) { latest = await cache.get(); if (latest.stale) await sleep(10); }
    assert.ok(!latest.stale);
    assert.equal(latest.rows.length, 3100, "the background reload completed and replaced the data");
});

test("an explicit refresh reports the failure, while ordinary reads keep the last complete data", async t => {
    quiet(t);
    const time = 1000;
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, loadOptions: NO_WAIT });
    await cache.get();
    db.behave = () => ({ error: TIMEOUT });
    await assert.rejects(cache.get(true), /TimeoutError/);
    assert.equal((await cache.get()).rows.length, 3000);
});

test("data older than the stale limit is never served silently", async t => {
    quiet(t);
    let time = 1000;
    const db = fakeDb(1200);
    const cache = createAnalyticsCache(db, { ttl: 1000, maxStaleMs: 5000, now: () => time, loadOptions: NO_WAIT });
    await cache.get();
    time += 6000;
    db.behave = () => ({ error: TIMEOUT });
    await assert.rejects(cache.get(), /TimeoutError/);
});

test("simultaneous requests share a single reload", async () => {
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { loadOptions: NO_WAIT });
    const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.equal(db.pageCalls, 3, "three pages of 1000 rows, loaded once");
    assert.ok(results.every(result => result === results[0]));
});

test("publishing replaces the data immediately and clears any back-off", async t => {
    quiet(t);
    let time = 1000;
    const db = fakeDb(3000);
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, loadOptions: NO_WAIT });
    await cache.get();
    time += 1001;
    db.behave = () => ({ error: TIMEOUT });
    assert.equal((await cache.get()).stale, true);
    db.behave = () => null;
    await cache.sync(async () => { db.rows = Array.from({ length: 5 }, (_, index) => row(index)); });
    const after = await cache.get();
    assert.equal(after.rows.length, 5);
    assert.ok(!after.stale);
});

test("the cache lasts minutes, not seconds, by default (the whole table is not reloaded on every window focus)", async () => {
    let time = 1000;
    const db = fakeDb(2000);
    const cache = createAnalyticsCache(db, { now: () => time });
    await cache.get();
    const calls = db.pageCalls;
    time += 120000; // two minutes later
    await cache.get();
    assert.equal(db.pageCalls, calls, "still served from memory after 2 minutes");
});

// ---------------------------------------------------------------- data adjustments
test("a temporary failure loading adjustments is retried", async () => {
    const db = fakeDb(10);
    db.adjustmentRows = [{ id: "a1", start_date: "2025-01-01", end_date: "2025-01-31", kind: "closure", reason: "Typhoon", exclude_from_training: true }];
    db.behaveAdjustments = attempt => attempt === 1 ? { error: TIMEOUT } : null;
    const adjustments = await loadAdjustments(db, NO_WAIT);
    assert.equal(adjustments.length, 1);
    assert.equal(db.adjustmentAttempts, 2);
});

test("while building the shared snapshot a persistent outage never silently drops the adjustments", async t => {
    quiet(t);
    const db = fakeDb(10);
    db.behaveAdjustments = () => ({ error: TIMEOUT });
    await assert.rejects(loadAdjustments(db, { ...NO_WAIT, strict: true }), /data adjustments could not be loaded/);
    assert.deepEqual(await loadAdjustments(db, NO_WAIT), [], "the standalone call keeps its original never-throws behaviour");
    const cache = createAnalyticsCache(db, { loadOptions: NO_WAIT });
    await assert.rejects(cache.get(), /data adjustments could not be loaded/);
});

test("with an older complete snapshot, an adjustments outage keeps serving it instead of unadjusted numbers", async t => {
    quiet(t);
    let time = 1000;
    const db = fakeDb(50);
    db.adjustmentRows = [{ id: "a1", start_date: "2025-01-01", end_date: "2025-01-31", kind: "closure", reason: "Typhoon", exclude_from_training: true }];
    const cache = createAnalyticsCache(db, { ttl: 1000, now: () => time, loadOptions: NO_WAIT });
    await cache.get();
    time += 1001;
    db.behaveAdjustments = () => ({ error: TIMEOUT });
    const served = await cache.get();
    assert.equal(served.stale, true);
    assert.equal(served.rows.length, 50);
});

test("a missing adjustments table is still treated as 'no adjustments'", async () => {
    const db = fakeDb(10);
    db.behaveAdjustments = () => ({ error: { message: 'relation "public.data_adjustments" does not exist' } });
    assert.deepEqual(await loadAdjustments(db, { ...NO_WAIT, strict: true }), []);
});

// A successful remote reset is a hard invalidation, not a routine TTL refresh.
test("reset drops cached rows immediately, refuses stale fallback, and reloads empty or republished data", async () => {
    const db = fakeDb(20);
    const cache = createAnalyticsCache(db, { now: () => 1000, loadOptions: NO_WAIT });
    assert.equal((await cache.get()).rows.length, 20);
    db.rows = [];
    cache.invalidate();
    db.behave = () => ({ error: TIMEOUT });
    await assert.rejects(cache.get(), /TimeoutError/);
    db.behave = () => null;
    assert.equal((await cache.get()).rows.length, 0);
    await cache.sync(async () => { db.rows = [row(100)]; });
    assert.deepEqual((await cache.get()).rows.map(r => r.id), ['100']);
});

test("reset rejects an old in-flight refresh and cannot overwrite a new empty snapshot", async () => {
    const db = fakeDb(20);
    const cache = createAnalyticsCache(db, { loadOptions: NO_WAIT });
    await cache.get();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    const originalFrom = db.from.bind(db);
    let block = true;
    db.from = table => {
        if (table === 'data_adjustments' && block) return { select: () => ({ order: () => ({ abortSignal: async () => { started(); await gate; return { data: [], error: null }; } }) }) };
        return originalFrom(table);
    };
    const old = cache.get(true);
    const rejected = assert.rejects(old, /data was reset/);
    await ready;
    block = false;
    db.rows = [];
    cache.invalidate();
    const fresh = await cache.get();
    assert.equal(fresh.rows.length, 0);
    release();
    await rejected;
    assert.strictEqual(await cache.get(), fresh);
});

test("reset during stale grace cannot serve an invalidated snapshot", async () => {
    let now = 1000;
    const db = fakeDb(20);
    const cache = createAnalyticsCache(db, { now: () => now, ttl: 10, staleGraceMs: 10, loadOptions: NO_WAIT });
    await cache.get();
    now += 20;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    db.behave = () => gate;
    const old = cache.get();
    const rejected = assert.rejects(old, /data was reset/);
    cache.invalidate();
    await rejected;
    db.rows = [];
    db.behave = () => null;
    release();
    assert.equal((await cache.get()).rows.length, 0);
});
