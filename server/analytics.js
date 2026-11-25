import { normalizeGeographicScope } from "./geographicScope.js";
import { registerSnapshot, snapshotIndex, snapshotMemo, clearSnapshotMemos } from "./cache/snapshotMemo.js";
import { buildTransactionIndex } from "./cache/transactionIndex.js";

// Only the server holds the Supabase secret. Analytics never falls back to local ETL files.
export const ANALYTICS_COLUMNS = "id,etl_run_id,order_id,order_creation_date,year_month,region,province,category,line_revenue,quantity,net_quantity,returned_quantity,return_refund_status,is_included_in_analysis,is_exact_duplicate";

// Supabase can be briefly slow (cold start, a busy shared instance, a network hiccup). One slow page must
// not fail the whole load, so every request is retried with a longer time limit before giving up.
export const LOAD_DEFAULTS = Object.freeze({ pageTimeoutMs: 20000, timeoutGrowthMs: 10000, maxAttempts: 3, retryDelayMs: 600 });
const TRANSIENT_ERROR = /timeout|timed out|aborted|fetch failed|network|socket|ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|bad gateway|service unavailable|gateway time|temporar|connection (reset|closed|terminated|refused|interrupted)|too many connections|upstream|\b(408|425|429|500|502|503|504|57014|53300)\b/i;

export function isTransientSupabaseError(error) {
    if (!error) return false;
    if ([408, 425, 429, 500, 502, 503, 504].includes(Number(error.status ?? error.statusCode))) return true;
    return TRANSIENT_ERROR.test(`${error.message ?? ""} ${error.details ?? ""} ${error.code ?? ""}`);
}

const sleep = ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
const attemptTimeout = (options, attempt) => AbortSignal.timeout(options.pageTimeoutMs + (attempt - 1) * options.timeoutGrowthMs);

// Runs `run(attempt)` until it succeeds or fails with a non-transient error. Always resolves to { data, error, count }.
async function runWithRetry(run, { maxAttempts, retryDelayMs }) {
    let result;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try { result = await run(attempt); } catch (error) { result = { error }; }
        if (!result?.error || !isTransientSupabaseError(result.error)) return result;
        if (attempt < maxAttempts) await sleep(retryDelayMs * 2 ** (attempt - 1));
    }
    return result;
}

export async function loadMasterRows(client, loadOptions = {}) {
    if (!client) throw new Error("Supabase is not configured on the server.");
    const options = { ...LOAD_DEFAULTS, ...loadOptions };
    const maximumPageSize = 1000;
    const concurrentPages = 6;
    const readPage = async (from, limit = maximumPageSize, expectedCount = null) => {
        const { data, error, count } = await runWithRetry(attempt => client.from("master_transactions")
            .select(ANALYTICS_COLUMNS, { count: "exact" })
            .order("id", { ascending: true }).range(from, from + limit - 1)
            .abortSignal(attemptTimeout(options, attempt)), options);
        if (error) throw new Error(`Unable to load Supabase analytics: ${error.message}`);
        if (!Array.isArray(data) || count === null) throw new Error("Supabase returned an incomplete analytics response.");
        if (expectedCount !== null && expectedCount !== count) throw new Error("The dataset changed while loading. Please retry.");
        return { data, count };
    };

    const first = await readPage(0);
    const expected = first.count;
    // Supabase can enforce a project-level row cap below the requested range.
    // Use the first response's size as the page stride so later ranges do not skip rows.
    const pageSize = first.data.length < maximumPageSize ? first.data.length : maximumPageSize;
    if (expected > 0 && pageSize === 0) throw new Error("Supabase analytics row count does not match.");
    const rows = [...first.data];
    for (let offset = pageSize; offset < expected; offset += pageSize * concurrentPages) {
        const offsets = Array.from(
            { length: Math.min(concurrentPages, Math.ceil((expected - offset) / pageSize)) },
            (_, index) => offset + index * pageSize
        );
        const pages = await Promise.all(offsets.map(pageOffset => readPage(pageOffset, pageSize, expected)));
        pages.forEach(({ data }, index) => {
            const pageOffset = offsets[index];
            const expectedLength = Math.min(pageSize, expected - pageOffset);
            if (data.length !== expectedLength) throw new Error("Supabase analytics row count does not match.");
            rows.push(...data);
        });
    }
    if (rows.length !== expected) throw new Error("Supabase analytics row count does not match.");
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("The dataset changed while paging. Please retry.");
    return rows;
}

// The dataset only changes when it is published from this app (which refreshes the cache immediately) or edited
// directly in Supabase, so the data is reloaded every few minutes instead of every 30 seconds.
//   ttl           how long a loaded snapshot is considered fresh
//   maxStaleMs    how long the last complete snapshot may still be served when a refresh is failing or slow
//   staleGraceMs  how long a request waits for a refresh before falling back to the last complete snapshot
// A failed or partial load is never served as data: the fallback is always the last COMPLETE snapshot.
export function createAnalyticsCache(client, { ttl = 300000, now = Date.now, maxStaleMs = 900000, staleGraceMs = 3000, loadOptions = {} } = {}) {
    let snapshot = null;
    let loadedAt = 0;
    let pending = null;
    let generation = 0;
    let writing = false;
    let writeError = null;
    let failures = 0;
    let retryNotBefore = 0;
    let lastRefreshError = null;
    const STALE = Symbol("stale");
    const FAILED = Symbol("failed");

    function refresh() {
        if (pending) return pending;
        const startedGeneration = generation;
        const attempt = loadMasterRows(client, loadOptions).then(async rows => {
            attachAdjustments(rows, await loadAdjustments(client, { ...loadOptions, strict: true }));
            if (startedGeneration !== generation) throw new Error("Analytics data was reset. Please retry.");
            prepareAnalyticsSnapshot(rows);
            loadedAt = now();
            snapshot = { rows, loadedAt: new Date(loadedAt).toISOString() };
            failures = 0;
            retryNotBefore = 0;
            lastRefreshError = null;
            return snapshot;
        }).catch(error => {
            if (startedGeneration !== generation) throw new Error("Analytics data was reset. Please retry.");
            failures += 1;
            // Back off so a struggling database is not hit again by every page and window-focus event.
            retryNotBefore = now() + Math.min(60000, 5000 * 2 ** (failures - 1));
            lastRefreshError = error;
            if (snapshot) console.warn("Analytics refresh failed; serving the last complete data:", error.message);
            throw error;
        }).finally(() => { if (pending === attempt) pending = null; });
        pending = attempt;
        return attempt;
    }
    const stale = () => ({ ...snapshot, stale: true, staleReason: lastRefreshError?.message || "Refreshing in the background." });

    async function get(force = false) {
        if (writing) throw new Error("Data Preparation is syncing. Please try again shortly.");
        if (writeError) throw writeError;
        const startedGeneration = generation;
        const age = snapshot ? now() - loadedAt : Infinity;
        if (!force && age < ttl) return snapshot;
        if (!force && age < maxStaleMs && now() < retryNotBefore) return stale();
        const attempt = refresh();
        // Nothing complete to fall back on, an explicit refresh, or data too old to serve: wait and report errors.
        if (force || age >= maxStaleMs) return attempt;
        // A complete older snapshot exists: give the reload a short window, otherwise serve the older data
        // while the reload finishes in the background.
        let timer;
        const grace = new Promise(resolve => { timer = setTimeout(() => resolve(STALE), staleGraceMs); });
        try {
            const outcome = await Promise.race([attempt.catch(() => FAILED), grace]);
            if (startedGeneration !== generation) throw new Error("Analytics data was reset. Please retry.");
            return outcome === STALE || outcome === FAILED ? stale() : outcome;
        } finally { clearTimeout(timer); }
    }
    async function sync(write) {
        if (writing) throw new Error("A Supabase sync is already in progress.");
        writing = true;
        try {
            // Drain an earlier read before replacing the remote dataset.
            if (pending) await pending.catch(() => {});
            const result = await write();
            writeError = null;
            snapshot = null;
            failures = 0;
            retryNotBefore = 0;
            lastRefreshError = null;
            writing = false;
            // A refresh failure is not a publishing failure after the DB commit.
            try { await get(true); } catch (refreshError) { console.error("Post-publish analytics refresh:", refreshError.message); }
            return result;
        } catch (error) {
            // Atomic publishing failures leave the previous live dataset intact.
            // Never poison subsequent reads because a staging attempt failed.
            writeError = null;
            throw error;
        } finally {
            writing = false;
        }
    }
    // A confirmed remote reset must never fall back to a pre-reset snapshot.
    function invalidate() {
        generation += 1;
        snapshot = null;
        loadedAt = 0;
        pending = null;
        writeError = null;
        failures = 0;
        retryNotBefore = 0;
        lastRefreshError = null;
    }
    return { get, sync, invalidate };
}

const clean = value => String(value ?? "").trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const eligible = row => row.is_included_in_analysis === true && row.is_exact_duplicate !== true;
const regionName = row => clean(row.region) || "Unknown Region";
const provinceName = row => clean(row.province) || "Unknown Province";
const categoryName = row => clean(row.category) || "Other / Unclassified";
const monthOf = row => clean(row.year_month) || clean(row.order_creation_date).slice(0, 7);
const approvedReturn = row => /^(request approved|approved|refunded|returned)$/i.test(clean(row.return_refund_status));
// A return approval alone does not establish the returned quantity or amount.
// Unknown/refund-only records require reconciliation before entering return metrics.
const verifiedReturnQuantity = row => {
    const sold = number(row.quantity) || number(row.net_quantity) + Math.max(0, number(row.returned_quantity));
    const returned = row.returned_quantity == null || row.returned_quantity === '' ? NaN : Number(row.returned_quantity);
    return Number.isFinite(returned) && returned > 0 && sold > 0 && returned <= sold ? returned : 0;
};
const hasReturn = row => verifiedReturnQuantity(row) > 0;
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));

// ---------------------------------------------------------------------------
// Dataset completeness. Transaction dates do not prove a boundary month is fully
// uploaded, but a month whose last record is before the calendar month-end is
// demonstrably incomplete. Such months are flagged so that trends, growth
// comparisons and forecasts never treat a part-month as a full month.
// ---------------------------------------------------------------------------
const lastDayOfMonth = month => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return date.toISOString().slice(0, 10);
};
export const shiftMonth = (month, offset) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 7);
};
const addDays = (day, count) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ADJUSTMENT_KINDS = new Set(["no_sales", "closure", "data_gap", "anomaly"]);
const adjustmentRegistry = new WeakMap();
const adjustmentWarningRegistry = new WeakMap();
const boundsCache = new WeakMap();
export const isIsoDay = value => {
    if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export function normalizeAdjustments(list) {
    const invalid = [];
    const normalized = [];
    for (const item of Array.isArray(list) ? list : []) {
        const start = clean(item?.start_date).slice(0, 10);
        const end = clean(item?.end_date).slice(0, 10);
        if (!isIsoDay(start) || !isIsoDay(end) || end < start || !ADJUSTMENT_KINDS.has(item?.kind) || typeof item?.exclude_from_training !== "boolean") {
            invalid.push({ type: "invalid_row", id: item?.id ?? null });
            continue;
        }
        normalized.push({ id: item.id ?? null, start, end, kind: item.kind, reason: clean(item.reason), exclude_from_training: item.exclude_from_training });
    }
    normalized.sort((a, b) => a.start.localeCompare(b.start));
    Object.defineProperty(normalized, "warnings", { value: invalid, enumerable: false });
    return normalized;
}
export function attachAdjustments(masterRows, adjustments) {
    const normalized = normalizeAdjustments(adjustments);
    adjustmentRegistry.set(masterRows, normalized);
    adjustmentWarningRegistry.set(masterRows, normalized.warnings || []);
    boundsCache.delete(masterRows);
    clearSnapshotMemos(masterRows);
    return masterRows;
}
export async function loadAdjustments(client, { strict = false, ...loadOptions } = {}) {
    const options = { ...LOAD_DEFAULTS, ...loadOptions };
    let failure = null;
    try {
        const { data, error } = await runWithRetry(attempt => {
            let query = client.from("data_adjustments").select("id,start_date,end_date,kind,reason,exclude_from_training").order("start_date");
            if (typeof query?.abortSignal === "function") query = query.abortSignal(attemptTimeout(options, attempt));
            return query;
        }, options);
        if (!error) return data || [];
        failure = error;
    } catch (error) { failure = error; }
    if (/does not exist|schema cache/i.test(failure?.message || "")) return [];
    // While building the shared analytics snapshot, a temporary outage must fail the reload (the previous complete
    // snapshot keeps being served) instead of producing numbers that silently ignore closures and other adjustments.
    if (strict && isTransientSupabaseError(failure)) throw new Error(`Unable to load Supabase analytics: data adjustments could not be loaded (${failure?.message || failure})`);
    console.warn("Data adjustments could not be loaded:", failure?.message || failure);
    return [];
}

// ---------------------------------------------------------------------------
// Dataset completeness. Transaction dates do not prove a boundary month is fully
// uploaded, but a month whose coverage ends before the calendar month-end is
// demonstrably incomplete. Coverage ends at the last transaction, extended through
// any explicit known-zero period that starts right after it. Part-months are flagged so that
// trends, growth comparisons and forecasts never treat them as full months.
// ---------------------------------------------------------------------------
export function datasetBounds(masterRows, { now = new Date() } = {}) {
    const today = new Date(now).toISOString().slice(0, 10);
    const cacheMap = Array.isArray(masterRows) ? boundsCache.get(masterRows) : null;
    if (cacheMap?.has(today)) return cacheMap.get(today);
    const adjustments = (Array.isArray(masterRows) && adjustmentRegistry.get(masterRows)) || [];
    const warnings = [...((Array.isArray(masterRows) && adjustmentWarningRegistry.get(masterRows)) || [])];
    let dateMin = null;
    let dateMax = null;
    for (const row of masterRows || []) {
        if (!eligible(row)) continue;
        const day = clean(row.order_creation_date).slice(0, 10);
        if (!day) continue;
        if (!dateMin || day < dateMin) dateMin = day;
        if (!dateMax || day > dateMax) dateMax = day;
    }
    let coverageEnd = dateMax && dateMax > today ? today : dateMax;
    const knownZero = adjustments.filter(item => item.kind === "no_sales" || item.kind === "closure");
    for (let changed = !!coverageEnd; changed;) {
        changed = false;
        for (const adjustment of knownZero) {
            const boundedEnd = adjustment.end > today ? today : adjustment.end;
            if (adjustment.start <= addDays(coverageEnd, 1) && boundedEnd > coverageEnd) { coverageEnd = boundedEnd; changed = true; }
        }
    }
    for (const adjustment of knownZero) {
        if (dateMax && adjustment.start > addDays(coverageEnd || dateMax, 1)) warnings.push({ type: "not_contiguous", id: adjustment.id });
        const hits = (masterRows || []).filter(row => eligible(row) && clean(row.order_creation_date).slice(0, 10) >= adjustment.start && clean(row.order_creation_date).slice(0, 10) <= adjustment.end);
        if (hits.length) warnings.push({ type: "sales_inside", id: adjustment.id, kind: adjustment.kind, lines: hits.length, firstSale: hits.map(row => clean(row.order_creation_date).slice(0, 10)).sort()[0], lastSale: hits.map(row => clean(row.order_creation_date).slice(0, 10)).sort().at(-1) });
    }
    for (const adjustment of adjustments) if (adjustment.end > today) warnings.push({ type: "ends_in_future", id: adjustment.id, end: adjustment.end });
    const adjustedDays = new Map();
    const adjustmentKinds = new Map();
    const adjustmentReasons = new Map();
    for (const adjustment of adjustments) {
        if (!adjustment.exclude_from_training) continue;
        for (let day = adjustment.start; day <= adjustment.end && day <= (coverageEnd || "0000-00-00"); day = addDays(day, 1)) {
            const month = day.slice(0, 7);
            if (!adjustedDays.has(month)) adjustedDays.set(month, new Set());
            adjustedDays.get(month).add(day);
            if (!adjustmentKinds.has(month)) adjustmentKinds.set(month, new Set());
            adjustmentKinds.get(month).add(adjustment.kind);
            if (!adjustmentReasons.has(month) && adjustment.reason) adjustmentReasons.set(month, adjustment.reason);
        }
    }
    // A declared data gap is unknown demand even when it was not manually
    // excluded from training. Keep the descriptive marker separate from exclusions.
    const dataGapMonths = new Set();
    for (const adjustment of adjustments.filter(item => item.kind === "data_gap")) {
        for (let month = adjustment.start.slice(0, 7); month <= adjustment.end.slice(0, 7); month = shiftMonth(month, 1)) {
            dataGapMonths.add(month);
            if (!adjustmentKinds.has(month)) adjustmentKinds.set(month, new Set());
            adjustmentKinds.get(month).add("data_gap");
            if (!adjustmentReasons.has(month) && adjustment.reason) adjustmentReasons.set(month, adjustment.reason);
        }
    }
    const adjustedMonths = new Set(adjustedDays.keys());
    for (const [month, days] of adjustedDays) adjustedDays.set(month, days.size);
    const partialMonths = new Set();
    if (coverageEnd && coverageEnd < lastDayOfMonth(coverageEnd.slice(0, 7))) partialMonths.add(coverageEnd.slice(0, 7));
    if (dateMin && dateMin.slice(8, 10) !== "01") partialMonths.add(dateMin.slice(0, 7));
    const firstMonth = dateMin?.slice(0, 7) ?? null;
    const lastMonth = coverageEnd?.slice(0, 7) ?? null;
    let lastCompleteMonth = lastMonth;
    while (lastCompleteMonth && partialMonths.has(lastCompleteMonth)) lastCompleteMonth = shiftMonth(lastCompleteMonth, -1);
    if (lastCompleteMonth && firstMonth && lastCompleteMonth < firstMonth) lastCompleteMonth = null;
    const bounds = {
        dateMin, dateMax, coverageEnd, partialMonths, lastCompleteMonth, adjustments, adjustedMonths, adjustedDays, dataGapMonths,
        adjustmentKinds: new Map([...adjustmentKinds].map(([month, kinds]) => [month, [...kinds].sort()])), adjustmentReasons, warnings,
        latestMonthComplete: !!lastMonth && !partialMonths.has(lastMonth)
    };
    if (Array.isArray(masterRows)) {
        const entries = cacheMap || new Map();
        entries.set(today, bounds);
        boundsCache.set(masterRows, entries);
    }
    return bounds;
}
export const completenessNote = bounds => ({
    dataThrough: bounds.dateMax,
    coverageEnd: bounds.coverageEnd,
    partialMonths: [...bounds.partialMonths].sort(),
    adjustedMonths: [...bounds.adjustedMonths].sort(),
    adjustments: bounds.adjustments,
    adjustmentWarnings: bounds.warnings,
    lastCompleteMonth: bounds.lastCompleteMonth,
    latestMonthComplete: bounds.latestMonthComplete
});

// ---------------------------------------------------------------------------
// Return treatment. Revenue and units are put on the same net basis: a line that
// had 2 of 10 units returned keeps 80% of its revenue and 8 units.
// ---------------------------------------------------------------------------
const returnShare = row => {
    const returned = verifiedReturnQuantity(row);
    const quantity = number(row.quantity) || number(row.net_quantity) + returned;
    return quantity > 0 && returned > 0 ? returned / quantity : 0;
};
const fullyReturned = row => returnShare(row) >= 1;
const netView = row => {
    const share = returnShare(row);
    return share > 0 ? { ...row, line_revenue: number(row.line_revenue) * (1 - share) } : row;
};
const returnedView = row => ({ ...row, line_revenue: number(row.line_revenue) * returnShare(row), net_quantity: verifiedReturnQuantity(row) });
function applyReturnTreatment(rows, treatment) {
    if (treatment === "Returned / Refunded Only") return rows.filter(hasReturn).map(returnedView);
    if (treatment === "Exclude Approved Returns") return rows.filter(row => !fullyReturned(row)).map(netView);
    return rows.map(netView);
}

export const ORDER_COUNT_NOTE = "Orders are distinct order IDs. An order spanning multiple categories, provinces or months is counted once per group; grouped counts may exceed the overall distinct-order total.";

function totals(rows) {
    return {
        revenue: Math.round(rows.reduce((sum, row) => sum + number(row.line_revenue), 0) * 100) / 100,
        orders: new Set(rows.map(row => clean(row.order_id)).filter(Boolean)).size,
        quantity: rows.reduce((sum, row) => sum + number(row.net_quantity), 0),
        rows: rows.length
    };
}

function group(rows, key) {
    const groups = new Map();
    for (const row of rows) {
        const name = key(row);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(row);
    }
    return [...groups].map(([name, items]) => ({ name, ...totals(items), items }));
}

// Only called for a complete server-owned snapshot; never mutate its rows in place.
export function prepareAnalyticsSnapshot(masterRows) {
    registerSnapshot(masterRows, buildTransactionIndex(masterRows, { eligible, regionName, provinceName, categoryName }));
    return masterRows;
}

// Shared date validation and calendar coverage for descriptive and prescriptive comparisons.
export function validateCustomRange(filters) {
    if (filters.period === "Custom Range" && (!isIsoDay(filters.start) || !isIsoDay(filters.end) || filters.start > filters.end)) {
        throw new Error("Choose a valid start and end date for the custom range.");
    }
}
export function scopePartialMonths(filters, bounds) {
    const partial = new Set(bounds.partialMonths);
    if (filters.period === "Custom Range") {
        validateCustomRange(filters);
        if (filters.start.slice(8) !== "01") partial.add(filters.start.slice(0, 7));
        if (filters.end !== lastDayOfMonth(filters.end.slice(0, 7))) partial.add(filters.end.slice(0, 7));
    }
    return partial;
}
export function selectAnalyticsRows(masterRows, filters = {}, { summaryOnly = false, descriptiveFilters = null, includeQuality = !summaryOnly } = {}) {
    validateCustomRange(filters);
    filters = normalizeGeographicScope(filters);
    const index = snapshotIndex(masterRows);
    const rows = index?.eligibleRows || masterRows.filter(eligible);
    let scope;
    if (summaryOnly) {
        const needsDateMax = filters.period === "Last 12 Months" || filters.period === "Last 24 Months";
        scope = { dateMax: needsDateMax ? datasetBounds(masterRows).dateMax : null };
    } else {
        scope = snapshotMemo(masterRows, "scope", "all", 1, () => {
            const dates = sorted(rows.map(row => clean(row.order_creation_date).slice(0, 10)).filter(Boolean));
            return {
                regions: sorted(rows.map(regionName)),
                geography: group(rows, regionName).map(region => ({ region: region.name, provinces: sorted(region.items.map(provinceName)) })),
                categories: sorted(rows.map(categoryName)),
                dateMin: dates[0] || null, dateMax: dates.at(-1) || null,
                preparedRecords: masterRows.length, eligibleRecords: rows.length,
                completeness: completenessNote(datasetBounds(masterRows))
            };
        });
    }
    let start = filters.start || "";
    let end = filters.end || "";
    if (filters.period === "Last 12 Months" || filters.period === "Last 24 Months") {
        if (scope.dateMax) {
            const date = new Date(`${scope.dateMax}T00:00:00Z`);
            date.setUTCDate(1);
            date.setUTCMonth(date.getUTCMonth() - (filters.period === "Last 12 Months" ? 11 : 23));
            start = date.toISOString().slice(0, 10);
            end = scope.dateMax;
        }
    } else if (filters.period !== "Custom Range") {
        start = "";
        end = "";
    }
    const category = clean(descriptiveFilters?.category);
    const categories = Array.isArray(descriptiveFilters?.categories)
        ? [...new Set(descriptiveFilters.categories.map(clean).filter(Boolean))]
        : [];
    const province = clean(descriptiveFilters?.province);
    const provinceKeys = Array.isArray(descriptiveFilters?.provinceKeys)
        ? [...new Set(descriptiveFilters.provinceKeys.filter(key => typeof key === 'string'))]
        : [];
    const specific = (value, all) => value && value !== all ? [value] : null;
    const globalRegions = Array.isArray(filters.regions) ? new Set(filters.regions) : null;
    const globalProvinces = Array.isArray(filters.provinceKeys) ? new Set(filters.provinceKeys) : null;
    const globalCategories = Array.isArray(filters.categories) ? new Set(filters.categories) : null;
    const localProvinces = new Set(provinceKeys);
    const localCategories = new Set(categories);
    const candidates = index ? index.candidates([
        ["region", specific(filters.region, "All Regions")],
        ["region", filters.regions],
        ["province", specific(filters.province, "All Provinces")],
        ["provinceKey", filters.provinceKeys],
        ["category", filters.categories],
        ["category", categories.length ? categories : specific(category, "All Categories")],
        ["province", specific(province, "All Provinces")],
        ["provinceKey", provinceKeys.length ? provinceKeys : null]
    ]) : rows;
    const inGlobalScope = candidates.filter(row => {
        const day = clean(row.order_creation_date).slice(0, 10);
        return (!start || day >= start) && (!end || day <= end)
            && (!filters.region || filters.region === "All Regions" || regionName(row) === filters.region)
            && (!filters.province || filters.province === "All Provinces" || provinceName(row) === filters.province)
            && (!globalRegions || globalRegions.has(regionName(row)))
            && (!globalProvinces || globalProvinces.has(JSON.stringify([regionName(row), provinceName(row)])))
            && (!globalCategories || globalCategories.has(categoryName(row)));
    });
    const selected = inGlobalScope.filter(row => {
        const categoryMatches = categories.length
            ? localCategories.has(categoryName(row))
            : !category || category === "All Categories" || categoryName(row) === category;
        return categoryMatches && (!province || province === "All Provinces" || provinceName(row) === province)
            && (!localProvinces.size || localProvinces.has(JSON.stringify([regionName(row), provinceName(row)])));
    });
    // Some legacy published records store unknown returned units as zero. An
    // approved status without a verified positive quantity needs reconciliation.
    // Count before return treatment so returns-only does not hide the warning.
    const unresolvedReturns = includeQuality ? selected.filter(row => approvedReturn(row) && !hasReturn(row)).length : 0;
    const qualityWarnings = unresolvedReturns ? [`${unresolvedReturns} approved return/refund line(s) have no verified returned quantity. Return values and net sales may be unreconciled; no missing quantities were assumed.`] : [];
    return { rows, selected: applyReturnTreatment(selected, filters.returns), scope, qualityWarnings };
}

export function analyzeRows(masterRows, filters = {}, { summaryOnly = false, descriptiveFilters = null } = {}) {
    const { rows, selected, scope, qualityWarnings } = selectAnalyticsRows(masterRows, filters, { summaryOnly, descriptiveFilters });
    const summary = totals(selected);
    const bounds = datasetBounds(masterRows);
    const partialMonths = scopePartialMonths(filters, bounds);
    const { adjustedMonths, adjustedDays, adjustmentKinds, adjustmentReasons } = bounds;
    const adjustmentFlags = name => ({ partial: partialMonths.has(name), adjusted: adjustedMonths.has(name), adjustedDays: adjustedDays.get(name) || 0, adjustmentKinds: adjustmentKinds.get(name) || [], adjustmentReason: adjustmentReasons.get(name) || "" });
    if (summaryOnly) {
        const monthly = new Map();
        for (const row of selected) {
            const name = monthOf(row);
            if (!/^\d{4}-\d{2}$/.test(name)) continue;
            if (!monthly.has(name)) monthly.set(name, { name, revenue: 0, orders: new Set(), quantity: 0, rows: 0 });
            const month = monthly.get(name);
            month.revenue += number(row.line_revenue);
            const orderId = clean(row.order_id);
            if (orderId) month.orders.add(orderId);
            month.quantity += number(row.net_quantity);
            month.rows += 1;
        }
        const names = [...monthly.keys()].sort();
        const trend = [];
        if (names.length) {
            const cursor = new Date(`${names[0]}-01T00:00:00Z`);
            while (cursor.toISOString().slice(0, 7) <= names.at(-1)) {
                const name = cursor.toISOString().slice(0, 7);
                const month = monthly.get(name);
                trend.push(month ? {
                    ...month,
                    revenue: Math.round(month.revenue * 100) / 100,
                    orders: month.orders.size,
                    quantity: month.quantity,
                    ...adjustmentFlags(name)
                } : { name, revenue: 0, orders: 0, quantity: 0, rows: 0, ...adjustmentFlags(name) });
                cursor.setUTCMonth(cursor.getUTCMonth() + 1);
            }
        }
        return { scope, summary, trend };
    }
    const monthlyTotals = items => group(items, monthOf)
        .filter(item => /^\d{4}-\d{2}$/.test(item.name))
        .map(({ items: ignored, ...month }) => month)
        .sort((a, b) => a.name.localeCompare(b.name));
    const share = value => summary.revenue ? value / summary.revenue * 100 : 0;
    const categories = items => {
        const revenue = totals(items).revenue;
        return group(items, categoryName).map(({ items: categoryRows, ...category }) => ({
            ...category,
            monthly: monthlyTotals(categoryRows),
            share: revenue ? category.revenue / revenue * 100 : 0
        })).sort((a, b) => b.revenue - a.revenue);
    };
    const regions = group(selected, regionName).map(({ items, ...region }) => ({
        ...region, share: share(region.revenue),
        provinces: group(items, provinceName).map(({ items: provinceRows, ...province }) => ({
            ...province,
            region: region.name,
            monthly: monthlyTotals(provinceRows),
            categories: categories(provinceRows)
        })).sort((a, b) => b.revenue - a.revenue)
    })).sort((a, b) => b.revenue - a.revenue);
    const monthly = new Map(group(selected, monthOf).filter(item => /^\d{4}-\d{2}$/.test(item.name)).map(({ items, ...month }) => [month.name, month]));
    const months = [...monthly.keys()].sort();
    const trend = [];
    if (months.length) {
        const cursor = new Date(`${months[0]}-01T00:00:00Z`);
        while (cursor.toISOString().slice(0, 7) <= months.at(-1)) {
            const name = cursor.toISOString().slice(0, 7);
            trend.push({ ...(monthly.get(name) || { name, revenue: 0, orders: 0, quantity: 0, rows: 0 }), ...adjustmentFlags(name) });
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
    }
    return { scope, summary, regions, categories: categories(selected), trend, empty: masterRows.length === 0, definitions: { orders: ORDER_COUNT_NOTE }, ...(qualityWarnings.length ? { qualityWarnings } : {}) };
}
