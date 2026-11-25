import { normalizeGeographicScope, hasGeographicRestriction } from "./geographicScope.js";
import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { createAnalyticsCache, analyzeRows } from "./analytics.js";
import { snapshotMemo } from "./cache/snapshotMemo.js";
import { resetPublishedData } from "./resetPublishedData.js";
import { MISSING_MONTH_MODES, prescriptiveAnalytics, forecastScopeOptions } from "./forecasting.js";
import { cachedPredictive, forecastComparisons } from "./forecastComparisons.js";
import { startEtlRun, completeEtlRun, failEtlRun } from "./etlRun.js";
import { sourceCounts, variantFields } from "./rowPayload.js";
import { createLivePreparationService } from "./livePreparation.js";
import { downloadPublishedSnapshot } from "./stagingSync.js";

import {
    createPreparationService
} from "./preparation.js";


/*
==========================================================
SAIPHER CG DSS BACKEND
==========================================================

DATA FLOW

Excel Files
    ↓
Data Management
    ↓
Data Preparation / ETL
    ↓
prepared_master_data.json
    ↓
Supabase master_transactions
    ↓
Descriptive / Predictive / Prescriptive Analytics
==========================================================
*/


/* ======================================================
   BASIC SERVER SETUP
====================================================== */

const __filename =
    fileURLToPath(import.meta.url);

const __dirname =
    path.dirname(__filename);

const app =
    express();

const PORT =
    Number(process.env.PORT) || 4000;


/* ======================================================
   DIRECTORIES
====================================================== */

const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );

const UPLOAD_DIR =
    path.join(
        DATA_DIR,
        "uploads"
    );

const DATABASE_FILE =
    path.join(
        DATA_DIR,
        "database.json"
    );

const PREPARED_FILE =
    path.join(
        DATA_DIR,
        "prepared_master_data.json"
    );

const PREPARED_UPLOAD_STATE_FILE =
    path.join(
        DATA_DIR,
        "prepared_upload_state.json"
    );

let preparedUploadInProgress = false;
let preparationRunInProgress = false;
let stagingSyncInProgress = false;


fs.mkdirSync(
    UPLOAD_DIR,
    {
        recursive: true
    }
);


if (
    !fs.existsSync(
        DATABASE_FILE
    )
) {
    fs.writeFileSync(
        DATABASE_FILE,
        JSON.stringify(
            {
                imports: []
            },
            null,
            2
        ),
        "utf8"
    );
}


/* ======================================================
   SUPABASE
====================================================== */

const SUPABASE_URL =
    process.env.SUPABASE_URL?.trim();

const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY?.trim();

// Dataset publishing and the published-data report require the server-only
// service-role credential. A publishable/anon key can produce misleading empty
// reads under RLS, and cannot insert the ETL-run record.
function isServiceRoleCredential(key) {
    if (!key) return false;
    if (key.startsWith("sb_secret_")) return true;
    if (key.startsWith("sb_publishable_")) return false;
    try {
        const payload = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString("utf8"));
        return payload.role === "service_role";
    } catch { return false; }
}

function requirePrivilegedSupabase() {
    if (!supabase) throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in the backend .env.");
    if (!isServiceRoleCredential(SUPABASE_SECRET_KEY)) {
        throw new Error("The backend SUPABASE_SECRET_KEY is not a service-role/secret key. Use the CLONE project's service_role key or sb_secret_ key in the server-only .env (never in VITE_ variables). Supabase RLS otherwise blocks ETL writes and can hide live records. Restart the backend after updating .env.");
    }
    return supabase;
}

let supabase = null;

if (
    SUPABASE_URL &&
    SUPABASE_SECRET_KEY
) {
    supabase =
        createClient(
            SUPABASE_URL,
            SUPABASE_SECRET_KEY
        );

    console.log(
        "Supabase configuration detected."
    );
} else {
    console.warn(
        "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env."
    );
}


/* ======================================================
   MIDDLEWARE
====================================================== */

const analyticsCache = createAnalyticsCache(supabase, {
    ttl: Number(process.env.ANALYTICS_CACHE_TTL_MS) || undefined,
    maxStaleMs: Number(process.env.ANALYTICS_MAX_STALE_MS) || undefined
});
const livePreparation = createLivePreparationService(supabase);

app.use(
    cors()
);

app.use(
    express.json(
        {
            limit: "10mb"
        }
    )
);


/* ======================================================
   DATABASE HELPERS
====================================================== */

app.get("/api/prescriptive", async (req, res) => {
    let filters;
    const horizon = Number(req.query.horizon || 6);
    const target = req.query.target || "revenue";
    const model = req.query.model || "arima";
    const missingMonthMode = req.query.missingMonthMode || "strict";
    try {
        filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        if (!filters || typeof filters !== "object" || Array.isArray(filters) || ![3, 6, 9, 12].includes(horizon) || !["revenue", "orders", "quantity"].includes(target) || !["arima", "prophet", "random_forest", "auto"].includes(model) || !MISSING_MONTH_MODES.includes(missingMonthMode)) throw new Error();
        filters = normalizeGeographicScope(filters);
        analyzeRows([], filters);
    } catch { return res.status(400).json({ error: "Invalid prescriptive settings or analysis scope." }); }
    try {
        const snapshot = await analyticsCache.get(req.query.refresh === "1");
        res.set("Cache-Control", "no-store");
        const result = snapshotMemo(snapshot.rows, "prescriptive-response",
            JSON.stringify([filters, horizon, target, model, missingMonthMode]), 12,
            () => prescriptiveAnalytics(snapshot.rows, filters, horizon, target, model, missingMonthMode));
        res.json({ ...result, loadedAt: snapshot.loadedAt });
    } catch (error) {
        const status = /prescriptive|selected category|month horizon|forecast metric|forecasting model/i.test(error.message) ? 400 : 503;
        res.status(status).json({ error: error.message });
    }
});

app.get("/api/forecasts", async (req, res) => {
    let filters;
    const horizon = Number(req.query.horizon || 6);
    const target = req.query.target || "revenue";
    const model = req.query.model || "arima";
    const missingMonthMode = req.query.missingMonthMode || "strict";
    const category = req.query.category || "";
    const provinceKey = req.query.provinceKey || "";
    const chartOnly = req.query.chartOnly === "1";
    try {
        filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        if (!filters || typeof filters !== "object" || Array.isArray(filters) || ![3, 6, 9, 12].includes(horizon) || !["revenue", "orders", "quantity"].includes(target) || !["arima", "prophet", "random_forest", "auto"].includes(model) || !["strict", "confirmed_zero", "intermittent"].includes(missingMonthMode)) throw new Error();
        filters = normalizeGeographicScope(filters);
        analyzeRows([], filters);
    } catch { return res.status(400).json({ error: "Invalid forecast settings or analysis scope." }); }
    try {
        const snapshot = await analyticsCache.get(req.query.refresh === "1");
        res.set('Cache-Control', 'no-store');
        const result = cachedPredictive(snapshot.rows, { filters, horizon, target, category, provinceKey, model, missingMonthMode, chartOnly });
        res.json({ ...result, source: "supabase", loadedAt: snapshot.loadedAt });
    } catch (error) {
        const status = /selected category|selected province|predictive selection|month horizon|forecast metric|forecasting model/i.test(error.message) ? 400 : 503;
        res.status(status).json({ error: error.message });
    }
});

// One snapshot and one HTTP response for every selected comparison chart.
app.post("/api/forecasts/comparisons", async (req, res) => {
    let { scope: filters, horizon, target, model, missingMonthMode, comparisons } = req.body || {};
    try {
        if (!filters || typeof filters !== "object" || Array.isArray(filters)
            || ![3, 6, 9, 12].includes(horizon) || !["revenue", "orders", "quantity"].includes(target)
            || !["arima", "prophet", "random_forest", "auto"].includes(model)
            || !["strict", "confirmed_zero", "intermittent"].includes(missingMonthMode)
            || !Array.isArray(comparisons) || comparisons.some(item => !item || typeof item.category !== "string" || typeof item.provinceKey !== "string")) throw new Error();
        filters = normalizeGeographicScope(filters);
        analyzeRows([], filters);
    } catch { return res.status(400).json({ error: "Invalid forecast comparison settings or analysis scope." }); }
    try {
        const snapshot = await analyticsCache.get(false);
        const selections = comparisons.map(({ category, provinceKey }) => ({ category, provinceKey }));
        const series = forecastComparisons(snapshot.rows, { filters, horizon, target, model, missingMonthMode }, selections);
        res.set("Cache-Control", "no-store");
        res.json({ series, loadedAt: snapshot.loadedAt });
    } catch (error) { res.status(503).json({ error: error.message }); }
});

app.get("/api/analytics", async (req, res) => {
    let filters;
    const descriptiveFilters = {
        category: typeof req.query.descriptiveCategory === "string" ? req.query.descriptiveCategory : "",
        categories: [],
        province: typeof req.query.descriptiveProvince === "string" ? req.query.descriptiveProvince : "",
        provinceKeys: []
    };
    if (typeof req.query.descriptiveProvinceKeys === 'string') {
        try {
            const keys = JSON.parse(req.query.descriptiveProvinceKeys);
            if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string' || key.length > 300)) throw new Error();
            descriptiveFilters.provinceKeys = [...new Set(keys)].sort();
        } catch { return res.status(400).json({ error: 'Invalid descriptive province comparison selection.' }); }
    }
    if (typeof req.query.descriptiveCategories === "string") {
        try {
            const categories = JSON.parse(req.query.descriptiveCategories);
            if (!Array.isArray(categories) || categories.some(category => typeof category !== "string")) throw new Error();
            descriptiveFilters.categories = [...new Set(categories.map(category => category.trim()).filter(Boolean))].sort();
            descriptiveFilters.category = "";
        } catch {
            return res.status(400).json({ error: "Invalid descriptive category selection." });
        }
    }
    try {
        filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new Error();
        filters = normalizeGeographicScope(filters);
    } catch {
        return res.status(400).json({ error: "Invalid analysis scope." });
    }
    try {
        const snapshot = await analyticsCache.get(req.query.refresh === "1");
        res.set("Cache-Control", "no-store");
        const result = snapshotMemo(snapshot.rows, "descriptive-response",
            JSON.stringify([filters, descriptiveFilters]), 24,
            () => analyzeRows(snapshot.rows, filters, { descriptiveFilters }));
        const globalRequest = !descriptiveFilters.categories.length && !descriptiveFilters.category && !descriptiveFilters.province && !descriptiveFilters.provinceKeys.length;
        const options = globalRequest && hasGeographicRestriction(filters)
            ? snapshotMemo(snapshot.rows, "forecast-scope-options", JSON.stringify(filters), 24,
                () => forecastScopeOptions(snapshot.rows, filters, result)) : null;
        res.json({ ...result, ...(options ? { forecastScopeOptions: options } : {}), loadedAt: snapshot.loadedAt, source: "supabase" });
    } catch (error) {
        res.status(503).json({ error: error.message });
    }
});

const datasetProfileCache = { key: null, value: null, generation: 0 };
app.get("/api/dataset-profile", async (req, res) => {
    try {
        // Reuses the analytics snapshot so the sync guard and refresh timing match the other pages.
        const snapshot = await analyticsCache.get(req.query.refresh === "1");
        res.set("Cache-Control", "no-store");
        if (datasetProfileCache.key !== snapshot.rows) {
            const generation = datasetProfileCache.generation;
            const { data, error } = await supabase.rpc("dataset_profile");
            if (error) {
                throw new Error(/function|schema cache|does not exist/i.test(error.message)
                    ? "The dataset_profile function is missing in Supabase. Restore the dataset_profile function in your configured Supabase project."
                    : `Unable to load the dataset profile: ${error.message}`);
            }
            if (generation !== datasetProfileCache.generation) throw new Error("Analytics data was reset. Please retry.");
            datasetProfileCache.key = snapshot.rows;
            datasetProfileCache.value = data;
        }
        res.json({ ...datasetProfileCache.value, source: "supabase", loadedAt: snapshot.loadedAt });
    } catch (error) {
        res.status(503).json({ error: error.message });
    }
});

function readDatabase() {
    // Never interpret a damaged registry as an empty installation: that could
    // overwrite the list of imported files during the next upload.
    try {
        const db = JSON.parse(fs.readFileSync(DATABASE_FILE, "utf8"));
        if (!db || !Array.isArray(db.imports)) throw new Error("imports must be an array");
        return db;
    } catch (cause) {
        const error = new Error(
            "Local dataset registry (server/data/database.json) is damaged or unreadable. " +
            "Restore it from a backup before importing or deleting files. No registry changes were made."
        );
        error.status = 500;
        error.cause = cause;
        throw error;
    }
}

function writeDatabase(database) {
    // Atomic metadata update: if writing fails, the previous database.json
    // stays intact instead of becoming truncated or partially written.
    const temporary = `${DATABASE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(database, null, 2), "utf8");
        fs.renameSync(temporary, DATABASE_FILE);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}


/* ======================================================
   REQUIRED EXCEL COLUMNS
====================================================== */

const REQUIRED_COLUMNS = [

    "Order ID",

    "Order Status",

    "Product Name",

    "Quantity",

    "Total Buyer Payment",

    "Deal Price",

    "Order Creation Date",

    "Return / Refund Status",

    "Returned quantity",

    "Province",

    "City"
];


/* ======================================================
   DATE HELPERS
====================================================== */

function parseDate(
    value
) {

    if (!value) {
        return null;
    }

    if (
        value instanceof Date &&
        !Number.isNaN(
            value.getTime()
        )
    ) {

        return value;
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return null;
    }

    return date;
}


function getMonthFromDate(
    dateString
) {

    const date =
        parseDate(
            dateString
        );

    if (!date) {
        return "-";
    }

    return date.toLocaleString(
        "en-US",
        {
            month: "long"
        }
    );
}


function getYearFromDate(
    dateString
) {

    const date =
        parseDate(
            dateString
        );

    if (!date) {
        return "-";
    }

    return date.getFullYear();
}


/* ======================================================
   WORKBOOK ANALYSIS
====================================================== */

function analyzeWorkbook(
    filePath
) {

    const workbook =
        XLSX.readFile(
            filePath,
            {
                cellDates: true
            }
        );


    if (
        !workbook.SheetNames.includes(
            "orders"
        )
    ) {

        throw new Error(
            'The workbook does not contain an "orders" sheet.'
        );
    }


    const worksheet =
        workbook.Sheets.orders;


    const rows =
        XLSX.utils.sheet_to_json(
            worksheet,
            {
                defval: null,
                raw: false
            }
        );


    /* Empty workbook */

    if (
        rows.length === 0
    ) {
        throw new Error("The orders sheet has no transaction rows. This file was not imported.");
    }


    const columns =
        Object.keys(
            rows[0]
        );


    const missingColumns =
        REQUIRED_COLUMNS.filter(
            column =>
                !columns.includes(
                    column
                )
        );


    if (
        missingColumns.length > 0
    ) {

        throw new Error(
            `Missing required columns: ${missingColumns.join(", ")}`
        );
    }


    // Keep import and preparation validation consistent. A completed order
    // with unusable financial values cannot be prepared safely; reject the
    // workbook at import instead of causing a later ETL failure.
    const parseMoney = value => {
        if (value == null || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        let text = String(value).trim();
        const negative = /^\(.*\)$/.test(text);
        text = text.replace(/PHP/gi, "").replace(/₱/g, "")
            .replace(/,/g, "").replace(/[()\s]/g, "");
        const n = Number(text);
        return Number.isFinite(n) ? (negative ? -n : n) : null;
    };
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (String(row["Order Status"] ?? "").trim().toLowerCase() !== "completed") continue;
        const dealPrice = parseMoney(row["Deal Price"]);
        if (dealPrice == null || dealPrice < 0) {
            throw new Error(`Row ${i + 2}: missing or invalid Deal Price for a completed order.`);
        }
        const quantity = parseMoney(row["Quantity"]);
        const returned = parseMoney(row["Returned quantity"]);
        if (quantity == null || quantity < 0 ||
            (returned != null && (returned < 0 || returned > quantity))) {
            throw new Error(`Row ${i + 2}: invalid sold or returned quantity for a completed order.`);
        }
        const voucher = parseMoney(row["Seller Voucher(PHP)"]);
        if (voucher != null && voucher < 0) {
            throw new Error(`Row ${i + 2}: invalid seller voucher for a completed order.`);
        }
    }

    /* Unique orders */

    const orders =
        new Set();

    rows.forEach(
        row => {

            if (
                row["Order ID"]
            ) {

                orders.add(
                    String(
                        row["Order ID"]
                    ).trim()
                );
            }
        }
    );


    /* Unique products */

    const products =
        new Set();

    rows.forEach(
        row => {

            if (
                row["Product Name"]
            ) {

                products.add(
                    String(
                        row["Product Name"]
                    ).trim()
                );
            }
        }
    );


    /*
      Actual dataset interpretation:

      Shopee Province = Region
      Shopee City = Province
    */

    const provinces =
        new Set();

    rows.forEach(
        row => {

            if (
                row["City"]
            ) {

                provinces.add(
                    String(
                        row["City"]
                    ).trim()
                );
            }
        }
    );


    /* Exact duplicate detection */

    const hashes =
        new Set();

    let duplicateRows =
        0;

    rows.forEach(
        row => {

            const hash =
                JSON.stringify(
                    row
                );

            if (
                hashes.has(hash)
            ) {

                duplicateRows++;

            } else {

                hashes.add(hash);
            }
        }
    );


    /* Date range */

    const dates =
        rows
            .map(
                row =>
                    parseDate(
                        row[
                            "Order Creation Date"
                        ]
                    )
            )
            .filter(Boolean)
            .sort(
                (a, b) =>
                    a - b
            );


    return {

        valid: true,

        empty: false,

        records:
            rows.length,

        columns,

        uniqueOrders:
            orders.size,

        uniqueProducts:
            products.size,

        uniqueProvinces:
            provinces.size,

        duplicateRows,

        minDate:
            dates.length
                ? dates[0].toISOString()
                : null,

        maxDate:
            dates.length
                ? dates[
                    dates.length - 1
                ].toISOString()
                : null
    };
}


/* ======================================================
   PREPARATION SERVICE
====================================================== */

const preparation =
    createPreparationService({

        uploadDir:
            UPLOAD_DIR,

        dataDir:
            DATA_DIR,

        databaseFile:
            DATABASE_FILE
    });


/* ======================================================
   APPLICATION DATA RESET
   Local-only and optional Supabase reset. This endpoint is
   NEVER called automatically on startup or deployment.
   Uses the same hardcoded password as the existing login.
====================================================== */

const CURRENT_LOGIN_PASSWORD = "saiphercg123";
let resetInProgress = false;
const RESET_LOCAL_FILES = [
    "database.json",
    "prepared_master_data.json",
    "preparation_state.json",
    "prepared_upload_state.json",
    "product_mapping_overrides.json",
    "product_categories.json"
];

function clearImportedLocalData() {
    // Only known application-owned data files are removed. Never delete .env,
    // SQL migrations, application source files or directories outside DATA_DIR.
    for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
        const target = path.join(UPLOAD_DIR, entry.name);
        // Avoid following symlinks outside the upload directory.
        if (entry.isSymbolicLink()) { fs.unlinkSync(target); continue; }
        if (entry.isFile()) fs.unlinkSync(target);
        if (entry.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    }
    for (const fileName of RESET_LOCAL_FILES) {
        const target = path.join(DATA_DIR, fileName);
        if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    fs.writeFileSync(DATABASE_FILE, JSON.stringify({ imports: [] }, null, 2), "utf8");
    preparation.clearCache();
}

app.post("/api/application/reset", async (req, res) => {
    const { password, mode } = req.body || {};
    if (typeof password !== "string" || password !== CURRENT_LOGIN_PASSWORD) {
        return res.status(403).json({ success: false, error: "Incorrect login password." });
    }
    if (mode !== "local" && mode !== "local_supabase") {
        return res.status(400).json({ success: false, error: "Choose a valid reset option." });
    }
    if (resetInProgress || preparedUploadInProgress || preparationRunInProgress || stagingSyncInProgress) {
        return res.status(409).json({ success: false, error: "A reset or publication is already in progress." });
    }
    if (mode === "local_supabase" && !supabase) {
        return res.status(503).json({ success: false, error: "Supabase is not configured. No data was cleared." });
    }
    resetInProgress = true;
    let remoteCleared = false;
    try {
        if (mode === "local_supabase") {
            // A dedicated RPC is required for atomic remote deletion.
            // If the SQL has not been applied, fail without clearing local files.
            await resetPublishedData(supabase, () => {
                remoteCleared = true;
                analyticsCache.invalidate();
                livePreparation.invalidate();
                datasetProfileCache.generation += 1;
                datasetProfileCache.key = null;
                datasetProfileCache.value = null;
            });
        }
        clearImportedLocalData();
        // The UI reload clears its in-memory analytics cache. Local-only reset
        // intentionally keeps the published Supabase analytics snapshot.
        res.json({ success: true, mode, localCleared: true, supabaseCleared: remoteCleared });
    } catch (error) {
        console.error("Application reset error:", error);
        res.status(500).json({ success: false, localCleared: false,
            supabaseCleared: remoteCleared,
            error: remoteCleared
                ? "Supabase data was cleared, but local cleanup failed. Please retry the local-only reset."
                : error.message });
    } finally {
        resetInProgress = false;
    }
});

/* ======================================================
   HEALTH CHECK
====================================================== */

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok: true,

            message:
                "Saipher CG DSS backend is running."
        });
    }
);


/* ======================================================
   MULTER
====================================================== */

const upload =
    multer({

        dest:
            UPLOAD_DIR,

        limits: {

            fileSize:
                50 * 1024 * 1024
        },

        // Validate file extensions independently inside the import loop so one
        // invalid selection does not abort all other files in the batch.
        fileFilter: (req, file, callback) => callback(null, true)
    });


/* ======================================================
   DATA MANAGEMENT
====================================================== */

app.get(
    "/api/datasets",
    (req, res) => {

        const database =
            readDatabase();

        res.json(
            database.imports || []
        );
    }
);


/* ======================================================
   DATASET SUMMARY
====================================================== */

app.get(
    "/api/datasets/summary",
    (req, res) => {

        try {

            const database =
                readDatabase();

            const imports =
                database.imports || [];


            const ready =
                imports.filter(
                    item =>
                        item.status ===
                        "Ready"
                );


            const totalRecords =
                ready.reduce(
                    (
                        sum,
                        item
                    ) =>
                        sum +
                        Number(
                            item.records || 0
                        ),
                    0
                );


            const uniqueProducts =
                new Set();

            const uniqueProvinces =
                new Set();


            ready.forEach(
                item => {

                    if (
                        Array.isArray(
                            item.productValues
                        )
                    ) {

                        item.productValues.forEach(
                            value =>
                                uniqueProducts.add(
                                    value
                                )
                        );
                    }


                    if (
                        Array.isArray(
                            item.provinceValues
                        )
                    ) {

                        item.provinceValues.forEach(
                            value =>
                                uniqueProvinces.add(
                                    value
                                )
                        );
                    }
                }
            );


            res.json({

                filesImported:
                    ready.length,

                totalRecords,

                uniqueProducts:
                    uniqueProducts.size,

                provincesCovered:
                    uniqueProvinces.size
            });

        } catch (error) {

            console.error(
                "Dataset summary error:",
                error
            );

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   IMPORT EXCEL FILES
====================================================== */

app.post(
    "/api/datasets/import",

    upload.array(
        "files",
        100
    ),

    (req, res) => {

        try {

            const database =
                readDatabase();


            if (
                !Array.isArray(
                    database.imports
                )
            ) {

                database.imports =
                    [];
            }


            const imported =
                [];


            const existingNames =
                new Set(

                    database.imports.map(
                        item =>
                            String(
                                item.fileName ||
                                ""
                            ).toLowerCase()
                    )
                );


            for (
                const file
                of req.files || []
            ) {

                let finalizedPath = null;
                try {

                    const originalName =
                        file.originalname;
                    if (![".xls", ".xlsx"].includes(path.extname(originalName).toLowerCase())) {
                        throw new Error("Only .xls and .xlsx Excel files are supported.");
                    }


                    /*
                      Prevent duplicate
                      monthly files.
                    */

                    if (
                        existingNames.has(
                            originalName.toLowerCase()
                        )
                    ) {

                        if (
                            fs.existsSync(
                                file.path
                            )
                        ) {

                            fs.unlinkSync(
                                file.path
                            );
                        }


                        imported.push({

                            fileName:
                                originalName,

                            status:
                                "Already Imported",

                            message:
                                "This file is already present in Data Management and was not imported again."
                        });

                        continue;
                    }


                    const analysis =
                        analyzeWorkbook(
                            file.path
                        );


                    const importId =
                        `${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2, 8)}`;


                    const extension =
                        path.extname(
                            originalName
                        );


                    const storedFileName =
                        `${importId}${extension}`;


                    const finalPath =
                        path.join(
                            UPLOAD_DIR,
                            storedFileName
                        );


                    fs.renameSync(
                        file.path,
                        finalPath
                    );
                    finalizedPath = finalPath;


                    const record = {

                        id:
                            importId,

                        fileName:
                            originalName,

                        storedFileName,

                        month:
                            getMonthFromDate(
                                analysis.minDate
                            ),

                        year:
                            getYearFromDate(
                                analysis.minDate
                            ),

                        records:
                            analysis.records,

                        fileSize:
                            file.size,

                        importDate:
                            new Date().toISOString(),

                        status: "Ready",
                        uploadStatus: "Accepted",

                        duplicateRows:
                            analysis.duplicateRows,

                        uniqueOrders:
                            analysis.uniqueOrders,

                        uniqueProducts:
                            analysis.uniqueProducts,

                        uniqueProvinces:
                            analysis.uniqueProvinces,

                        minDate:
                            analysis.minDate,

                        maxDate:
                            analysis.maxDate,

                        columns:
                            analysis.columns
                    };


                    database.imports.push(
                        record
                    );


                    existingNames.add(
                        originalName.toLowerCase()
                    );


                    imported.push(
                        record
                    );


                } catch (error) {
                    if (finalizedPath && fs.existsSync(finalizedPath)) fs.unlinkSync(finalizedPath);
                    if (
                        fs.existsSync(
                            file.path
                        )
                    ) {

                        fs.unlinkSync(
                            file.path
                        );
                    }


                    imported.push({

                        fileName:
                            file.originalname,

                        status: "Rejected",
                        error:
                            error.message
                    });
                }
            }


            writeDatabase(
                database
            );


            /*
              New Data Management data means
              the preparation cache is no longer valid.
            */

            preparation.clearCache();
            if (imported.some(item => item.status === "Ready")) preparation.activateLocalImports();


            res.json({

                success: true,

                imported
            });


        } catch (error) {

            console.error(
                "Import error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   DELETE DATASET
====================================================== */

app.delete(
    "/api/datasets/:id",

    (req, res) => {

        try {

            const database =
                readDatabase();


            const index =
                (
                    database.imports || []
                ).findIndex(
                    item =>
                        item.id ===
                        req.params.id
                );


            if (
                index === -1
            ) {

                return res.status(
                    404
                ).json({

                    error:
                        "Dataset not found."
                });
            }


            const dataset =
                database.imports[index];


            if (
                dataset.storedFileName
            ) {

                const filePath =
                    path.join(
                        UPLOAD_DIR,
                        dataset.storedFileName
                    );


                if (
                    fs.existsSync(
                        filePath
                    )
                ) {

                    fs.unlinkSync(
                        filePath
                    );
                }
            }


            database.imports.splice(
                index,
                1
            );


            writeDatabase(
                database
            );


            preparation.clearCache();


            res.json({

                success: true
            });

        } catch (error) {

            console.error(
                "Delete dataset error:",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   DATA PREPARATION API
====================================================== */

app.get(
    "/api/preparation/status",

    (req, res) => {

        try {

            const status = preparation.status();
            let lastUpload = {};
            try {
                lastUpload = JSON.parse(fs.readFileSync(PREPARED_UPLOAD_STATE_FILE, "utf8"));
            } catch {
                // No successful upload has been recorded yet.
            }

            res.json({
                ...status,
                uploadedToSupabase: Boolean(status.prepared && status.runId && lastUpload.runId === status.runId),
                lastPublishedAt: lastUpload.uploadedAt || null,
                lastPublishedRecords: lastUpload.preparedRecords ?? null
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);

app.post("/api/preparation/sync-supabase", async (req, res) => {
    if (stagingSyncInProgress || preparationRunInProgress || preparedUploadInProgress || resetInProgress) {
        return res.status(409).json({ error: "A preparation, publication, or synchronization operation is already running." });
    }
    stagingSyncInProgress = true;
    try {
        requirePrivilegedSupabase();
        const snapshot = await downloadPublishedSnapshot(supabase);
        const saved = preparation.replaceWithSupabaseSnapshot(snapshot);
        try { fs.unlinkSync(path.join(DATA_DIR, "supabase_staging_snapshot.json")); }
        catch (cleanupError) { if (cleanupError.code !== "ENOENT") console.warn("Old snapshot cleanup failed:", cleanupError.message); }
        livePreparation.invalidate();
        res.json({ success: true, records: saved.records, syncedAt: saved.syncedAt, readOnlySnapshot: true });
    } catch (error) {
        console.error("Supabase to local staging sync failed:", error.message);
        res.status(503).json({ error: error.message });
    } finally {
        stagingSyncInProgress = false;
    }
});


// Complete read-only presentation of the published transaction dataset.
app.get("/api/preparation/live-report", async (req, res) => {
    try {
        requirePrivilegedSupabase();
        const report = await livePreparation.load(req.query.refresh === "1");
        res.json(report);
    } catch (error) {
        res.status(503).json({ error: `Live preparation data could not be loaded: ${error.message}` });
    }
});

app.get("/api/preparation/live-status", async (req, res) => {
    try {
        requirePrivilegedSupabase();
        const { count, error } = await supabase.from("master_transactions")
            .select("id", { count: "exact", head: true });
        if (error) throw error;
        let upload = {};
        try { upload = JSON.parse(fs.readFileSync(PREPARED_UPLOAD_STATE_FILE, "utf8")); } catch {}
        res.json({ status: "Live", records: count, lastPublishedAt: upload.uploadedAt || null,
            lastPublishedRecords: upload.preparedRecords ?? null });
    } catch (error) { res.status(503).json({ error: `Live data could not be verified: ${error.message}` }); }
});

app.get(
    "/api/preparation/profile",

    (req, res) => {

        try {

            res.json(
                preparation.profile()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.get(
    "/api/preparation/duplicates",

    (req, res) => {

        try {

            res.json(
                preparation.duplicates()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.get(
    "/api/preparation/status-review",

    (req, res) => {

        try {

            res.json(
                preparation.statuses()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.get(
    "/api/preparation/returns",

    (req, res) => {

        try {

            res.json(
                preparation.returns()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.get(
    "/api/preparation/geography",

    (req, res) => {

        try {

            res.json(
                preparation.geography()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.get(
    "/api/preparation/products",

    (req, res) => {

        try {

            res.json(
                preparation.products(
                    req.query.search || ""
                )
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.patch(
    "/api/preparation/products",

    (req, res) => {

        try {

            const mapping =
                preparation.saveProductMapping(
                    req.body
                );


            res.json({

                success: true,

                mapping
            });


        } catch (error) {

            console.error(error);

            res.status(400).json({

                error:
                    error.message
            });
        }
    }
);


// Primary-category definitions are persisted locally; no Supabase schema migration is required.
app.get('/api/preparation/categories', (req, res) => {
    try { res.json(preparation.listCategories()); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/preparation/categories', (req, res) => {
    try { res.json(preparation.addCategory(req.body?.name)); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.patch('/api/preparation/categories', (req, res) => {
    try { res.json(preparation.renameCategory(req.body?.oldName, req.body?.newName)); }
    catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete('/api/preparation/categories', (req, res) => {
    try { res.json(preparation.deleteCategory(req.body?.name)); }
    catch (error) { res.status(400).json({ error: error.message }); }
});

app.get(
    "/api/preparation/time-fields",

    (req, res) => {

        try {

            res.json({

                fields:
                    preparation.timeFields(),

                summary:
                    preparation.timeSummary()
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


app.post(
    "/api/preparation/run",

    (req, res) => {
        if (stagingSyncInProgress || preparationRunInProgress || preparedUploadInProgress || resetInProgress) return res.status(409).json({ error: "Another preparation, publication, synchronization, or reset operation is in progress." });
        preparationRunInProgress = true;
        try {
            const result =
                preparation.run();


            res.json({

                success: true,

                ...result
            });


        } catch (error) {

            console.error(
                "Preparation error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message
            });
        } finally { preparationRunInProgress = false; }
    }
);


app.post(
    "/api/preparation/upload",
    async (req, res) => {
        if (req.body?.confirmReplace !== true) {
            return res.status(400).json({ error: "Confirm that the existing Supabase master dataset should be replaced." });
        }

        if (preparedUploadInProgress || preparationRunInProgress || stagingSyncInProgress || resetInProgress) {
            return res.status(409).json({ error: "A preparation, publication, synchronization, or reset operation is already in progress." });
        }

        const state = preparation.status();
        const summary = preparation.masterSummary();

        if (!state.prepared || !state.runId || !summary.prepared || summary.records < 1) {
            return res.status(409).json({ error: "Run Data Preparation successfully before uploading prepared data." });
        }

        if (!req.body?.runId || req.body.runId !== state.runId) {
            return res.status(409).json({ error: "The confirmed preparation version is outdated. Refresh and confirm the current dataset." });
        }
        // Mapping validity is a server-side readiness rule; the fallback
        // category is valid and deliberately does not block publishing.
        try {
            const mapping = preparation.products();
            const taxonomy = mapping.taxonomy || {};
            const invalid = (mapping.records || []).filter(row =>
                !taxonomy[row.category]
            );
            if (invalid.length) return res.status(409).json({
                error: `${invalid.length} product mappings have invalid category references. Review Product Categorization before publishing.`
            });
        } catch (error) {
            return res.status(409).json({ error: `Unable to validate product mappings: ${error.message}` });
        }
        let preparedRows;
        try {
            preparedRows = JSON.parse(fs.readFileSync(PREPARED_FILE, "utf8"));
        } catch {
            return res.status(409).json({ error: "The prepared dataset could not be read. Run Data Preparation again before uploading." });
        }

        if (!Array.isArray(preparedRows) || preparedRows.length < 1 || preparedRows.some(row => row?.etl_run_id !== state.runId)) {
            return res.status(409).json({ error: "The prepared dataset does not match the last successful preparation run. Run Data Preparation again before uploading." });
        }

        let previousUpload = {};
        try {
            previousUpload = JSON.parse(fs.readFileSync(PREPARED_UPLOAD_STATE_FILE, "utf8"));
        } catch {
            // No successful upload has been recorded yet.
        }

        if (previousUpload.runId === state.runId) {
            return res.status(409).json({ error: "This prepared dataset has already been uploaded. Run Data Preparation again before uploading a new dataset." });
        }

        preparedUploadInProgress = true;

        try {
            const result = await syncPreparedMasterData();
            const uploadState = {
                runId: state.runId,
                uploadedAt: new Date().toISOString(),
                preparedRecords: result.preparedRecords
            };
            const temporaryStateFile = `${PREPARED_UPLOAD_STATE_FILE}.tmp`;
            fs.writeFileSync(temporaryStateFile, JSON.stringify(uploadState, null, 2), "utf8");
            fs.renameSync(temporaryStateFile, PREPARED_UPLOAD_STATE_FILE);
            res.json({ success: true, ...result });
        } catch (error) {
            console.error("Prepared data upload error:", error);
            res.status(500).json({ error: error.message || "Prepared data upload failed." });
        } finally {
            preparedUploadInProgress = false;
        }
    }
);


app.get(
    "/api/preparation/master-summary",

    (req, res) => {

        try {

            res.json(
                preparation.masterSummary()
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   SUPABASE HELPERS
====================================================== */


/*
   Convert a prepared row into the exact structure
   used by master_transactions.
*/

function prepareSupabaseRow(
    row,
    syncRunId
) {

    return {

        etl_run_id:
            syncRunId,

        source_file_name:
            row.source_file_name ?? null,

        source_row_number:
            row.source_row_number ?? null,

        order_id:
            row.order_id ?? null,

        order_status:
            row.order_status ?? null,

        return_refund_status:
            row.return_refund_status ?? null,

        order_creation_date:
            row.order_creation_date ?? null,

        order_paid_time:
            row.order_paid_time ?? null,

        ship_time:
            row.ship_time ?? null,

        order_complete_time:
            row.order_complete_time ?? null,

        year:
            row.year ?? null,

        month:
            row.month ?? null,

        month_name:
            row.month_name ?? null,

        month_number:
            row.month_number ?? null,

        year_month:
            row.year_month ?? null,

        quarter:
            row.quarter ?? null,

        raw_province:
            row.raw_province ?? null,

        raw_city:
            row.raw_city ?? null,

        region:
            row.region ?? null,

        province:
            row.province ?? null,

        raw_product_name:
            row.raw_product_name ?? null,

        ...variantFields(row),

        category:
            row.category ?? null,

        quantity:
            row.quantity ?? 0,

        returned_quantity:
            row.returned_quantity ?? 0,

        net_quantity:
            row.net_quantity ?? 0,

        line_revenue:
            row.line_revenue ?? 0,

        total_discount:
            row.total_discount ?? 0,

        seller_price_discount:
            row.seller_price_discount ?? 0,

        shopee_rebate:
            row.shopee_rebate ?? 0,

        service_fee:
            row.service_fee ?? 0,

        is_exact_duplicate:
            Boolean(
                row.is_exact_duplicate
            ),

        is_included_in_analysis:
            Boolean(
                row.is_included_in_analysis
            ),

        exclusion_reason:
            row.exclusion_reason ?? null
    };
}


/*
   Convert a unique product classification record
   (from preparation.products()) into the row shape
   used by the product_mapping dimension table.
*/

function prepareProductMappingRow(product) {

    return {

        raw_product_name:
            product.rawProductName,

        category:
            product.category,

        mapping_status:
            product.status,

        updated_at:
            new Date().toISOString()
    };
}


/*
   Convert a unique province/city combination
   (from preparation.geography()) into the row shape
   used by the geographic_mapping dimension table.
*/

function prepareGeographicMappingRow(geo) {

    return {

        raw_province:
            geo.rawProvince || null,

        raw_city:
            geo.rawCity || null,

        region:
            geo.region,

        province:
            geo.province,

        updated_at:
            new Date().toISOString()
    };
}


/*
   Upsert the current unique product and geography
   mappings into their dimension tables. These are
   reference/lookup tables, so they are reconciled by
   unique key (upsert) rather than fully replaced like
   master_transactions.

   Failures here are returned rather than thrown, since
   master_transactions is the primary single source of
   truth and may already have synced successfully by the
   time this runs.
*/

async function syncDimensionTables() {

    const warnings = [];


    const productRecords =
        preparation.products().records ||
        [];

    if (
        productRecords.length > 0
    ) {

        const rows =
            productRecords.map(
                prepareProductMappingRow
            );

        const {
            error
        } =
            await supabase
                .from(
                    "product_mapping"
                )
                .upsert(
                    rows,
                    {
                        onConflict:
                            "raw_product_name"
                    }
                );

        if (error) {

            console.error(
                "product_mapping sync error:",
                error
            );

            warnings.push(
                `product_mapping sync failed: ${error.message}`
            );
        }
    }


    const geographyRecords =
        preparation.geography().records ||
        [];

    if (
        geographyRecords.length > 0
    ) {

        const rows =
            geographyRecords.map(
                prepareGeographicMappingRow
            );

        const {
            error
        } =
            await supabase
                .from(
                    "geographic_mapping"
                )
                .upsert(
                    rows,
                    {
                        onConflict:
                            "raw_province,raw_city"
                    }
                );

        if (error) {

            console.error(
                "geographic_mapping sync error:",
                error
            );

            warnings.push(
                `geographic_mapping sync failed: ${error.message}`
            );
        }
    }


    return warnings;
}


/* ======================================================
   SUPABASE SYNC
====================================================== */

async function syncPreparedMasterData() {
    return analyticsCache.sync(uploadPreparedMasterData);
}

async function uploadPreparedMasterData() {
    requirePrivilegedSupabase();
    if (!fs.existsSync(PREPARED_FILE)) throw new Error("Run Data Preparation before publishing.");
    const prepared = JSON.parse(fs.readFileSync(PREPARED_FILE, "utf8"));
    if (!Array.isArray(prepared) || !prepared.length) throw new Error("Prepared Master Data is empty or invalid.");
    const state = preparation.status();
    if (!state.prepared || prepared.some(row => row?.etl_run_id !== state.runId)) {
        throw new Error("The prepared dataset is stale. Run Data Preparation again.");
    }

    // IMPORTANT: This path intentionally has NO delete-then-insert fallback.
    // The SQL migration must be manually applied by the owner first.
    const stageToken = crypto.randomUUID();
    const syncRunId = crypto.randomUUID();
    const BATCH_SIZE = 500;
    let published = false;
    let runRegistered = false;
    try {
        // The live table has foreign keys to etl_runs, product_mapping, and
        // geographic_mapping. Satisfy these dependencies BEFORE publication.
        await startEtlRun(supabase, syncRunId);
        runRegistered = true;
        const dimensionWarnings = await syncDimensionTables();
        if (dimensionWarnings.length) {
            throw new Error(`Required mapping synchronization failed. ${dimensionWarnings.join(" | ")}`);
        }
        for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
            const batch = prepared.slice(i, i + BATCH_SIZE).map(row => ({
                ...prepareSupabaseRow(row, syncRunId), stage_token: stageToken
            }));
            const { error } = await supabase.from("saipher_master_stage").insert(batch);
            if (error) throw new Error(`Staging failed at rows ${i + 1}-${Math.min(i + BATCH_SIZE, prepared.length)}. Live data was not changed. ${error.message}`);
        }
        const { data, error } = await supabase.rpc("saipher_publish_master", {
            p_stage_token: stageToken,
            p_expected_count: prepared.length
        });
        if (error) {
            const hint = /statement timeout|canceling statement due to statement timeout|code.*57014/i.test(error.message || "")
                ? " The atomic publishing RPC exceeded its database time limit. Verify the atomic publishing timeout configuration in the CLONED Supabase project, then retry; no live dataset replacement was committed."
                : "";
            throw new Error(`Atomic publication failed; existing master data was not replaced. ${error.message}${hint}`);
        }
        if (Number(data?.published_count) !== prepared.length) {
            // RPC may have committed. Never assert rollback after a response mismatch.
            throw new Error("Publication returned an unexpected count; inspect the live dataset before retrying.");
        }
        published = true;
        livePreparation.invalidate();
    } catch (error) {
        if (runRegistered && !published) await failEtlRun(supabase, syncRunId, error);
        throw error;
    } finally {
        if (!published) {
            // Only remove this run's staging rows; never delete live master data.
            const { error: cleanupError } = await supabase.from("saipher_master_stage")
                .delete().eq("stage_token", stageToken);
            if (cleanupError) console.error("Staging cleanup failed:", cleanupError.message);
        }
    }

    // The live replacement is committed at this point. Log summary separately.
    // Logging failures are warnings rather than an attempted live-data rollback.
    const warnings = [];
    try {
        await completeEtlRun(supabase, syncRunId, {
            source_file_count: new Set(prepared.map(row => row.source_file_name).filter(Boolean)).size,
            source_row_count: prepared.length,
            unique_orders: new Set(prepared.map(row => row.order_id).filter(Boolean)).size,
            unique_products: new Set(prepared.map(row => row.raw_product_name).filter(Boolean)).size,
            region_count: new Set(prepared.map(row => row.region).filter(Boolean)).size,
            province_count: new Set(prepared.map(row => row.province).filter(Boolean)).size,
            duplicate_rows: Number(state.quality?.duplicateRows) || 0,
            eligible_orders: new Set(prepared.filter(row => row.is_included_in_analysis).map(row => row.order_id).filter(Boolean)).size,
            included_rows: prepared.filter(row => row.is_included_in_analysis).length,
            excluded_rows: prepared.filter(row => !row.is_included_in_analysis).length,
            date_min: prepared.map(row => row.order_creation_date).filter(Boolean).sort()[0] || null,
            date_max: prepared.map(row => row.order_creation_date).filter(Boolean).sort().at(-1) || null
        });
    } catch (error) { warnings.push(`ETL run logging: ${error.message}`); }
    return {
        success: true, runId: syncRunId, preparedRecords: prepared.length,
        insertedRecords: prepared.length, databaseRecords: prepared.length,
        includedRecords: prepared.filter(row => row.is_included_in_analysis).length,
        excludedRecords: prepared.filter(row => !row.is_included_in_analysis).length,
        warning: warnings.length ? warnings.join(" | ") : null
    };
}


/* ======================================================
   SUPABASE CONNECTION TEST
====================================================== */

app.get(
    "/api/supabase/test",

    async (req, res) => {

        try {

            if (!supabase) {

                return res.status(
                    503
                ).json({

                    success: false,

                    connected: false,

                    error:
                        "Supabase is not configured. Check your .env file."
                });
            }


            const {
                data,
                error
            } =
                await supabase
                    .from(
                        "etl_runs"
                    )
                    .select(
                        "run_id"
                    )
                    .limit(
                        1
                    );


            if (
                error
            ) {

                return res.status(
                    500
                ).json({

                    success: false,

                    connected: false,

                    error:
                        error.message
                });
            }


            res.json({

                success: true,

                connected: true,

                message:
                    "Supabase connection is working.",

                etlRuns:
                    data || []
            });

        } catch (error) {

            console.error(
                "Supabase test error:",
                error
            );


            res.status(
                500
            ).json({

                success: false,

                connected: false,

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   SUPABASE MASTER DATA SYNC
====================================================== */

app.post(
    "/api/supabase/sync",
    (req, res) => {
        res.status(410).json({
            success: false,
            error: "Direct sync is disabled. Use Push Prepared Data to Supabase in Data Preparation."
        });
    }
);


/* ======================================================
   SUPABASE MASTER DATA COUNT
====================================================== */

app.get(
    "/api/supabase/master-count",

    async (req, res) => {

        try {

            if (!supabase) {

                return res.status(
                    503
                ).json({

                    success: false,

                    error:
                        "Supabase is not configured."
                });
            }


            const {
                count,
                error
            } =
                await supabase
                    .from(
                        "master_transactions"
                    )
                    .select(
                        "id",
                        {
                            count: "exact",
                            head: true
                        }
                    );


            if (
                error
            ) {

                return res.status(
                    500
                ).json({

                    success: false,

                    error:
                        error.message
                });
            }


            res.json({

                success: true,

                masterRecords:
                    count
            });


        } catch (error) {

            console.error(
                "Master count error:",
                error
            );


            res.status(
                500
            ).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);


/* ======================================================
   ERROR HANDLER
====================================================== */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            error
        );


        res.status(error.status || 400).json({
            error: error.message || "Something went wrong."
        });
    }
);


/* ======================================================
   START SERVER
====================================================== */

// Warm the same cache used by scope options and descriptive aggregates.
await analyticsCache.get().catch(error => console.error("Analytics startup:", error.message));

app.listen(
    PORT,
    () => {

        console.log(
            "=============================================="
        );

        console.log(
            "SAIPHER CG DSS BACKEND"
        );

        console.log(
            `Running on http://localhost:${PORT}`
        );

        console.log(
            "=============================================="
        );

        console.log(
            `Supabase: ${
                supabase
                    ? isServiceRoleCredential(SUPABASE_SECRET_KEY)
                        ? "Configured (server-side service credential)"
                        : "Configured with a non-service key — ETL publishing and live reporting require the clone service credential"
                    : "NOT CONFIGURED"
            }`
        );
    }
);
