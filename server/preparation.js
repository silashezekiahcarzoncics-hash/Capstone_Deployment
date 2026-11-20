import fs from "fs";
import path from "path";
import crypto from "crypto";
import XLSX from "xlsx";
import { exclusionReasonForStatus } from "./rowPayload.js";

/*
==========================================================
SAIPHER CG DSS
DATA PREPARATION / ETL ENGINE
==========================================================

RAW DATA
    ↓
Profile
    ↓
Quality Checks
    ↓
Geographic Standardization
    ↓
Product Classification
    ↓
Time Feature Engineering
    ↓
Analytical Measures
    ↓
Validation
    ↓
Prepared Master Dataset

PRODUCT CLASSIFICATION:
Raw Product Name → Category

Classification uses one category per product.
==========================================================
*/

const TAXONOMY = [
    "Shrink Wrap / Cap Seal",
    "Bottle / Container",
    "Tape / Adhesive",
    "Label / Sticker",
    "Mailer / Shipping Packaging",
    "Protective Packaging",
    "Plastic Bags",
    "Packaging Accessories",
    "Packaging / General Supplies",
    "Other / Unclassified"
];

const PREPARED_FILE = "prepared_master_data.json";
const STATE_FILE = "preparation_state.json";
const OVERRIDES_FILE = "product_mapping_overrides.json";
const CATEGORIES_FILE = "product_categories.json";
const FALLBACK_CATEGORY = "Other / Unclassified";

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
   BASIC HELPERS
====================================================== */

function clean(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function lower(value) {
    return clean(value).toLowerCase();
}

function number(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    if (typeof value === "number") {
        return Number.isFinite(value)
            ? value
            : null;
    }

    let text = String(value).trim();

    const negativeParentheses =
        /^\(.*\)$/.test(text);

    text = text
        .replace(/PHP/gi, "")
        .replace(/₱/g, "")
        .replace(/,/g, "")
        .replace(/[()\s]/g, "");

    const parsed = Number(text);

    if (!Number.isFinite(parsed)) {
        return null;
    }

    return negativeParentheses
        ? -parsed
        : parsed;
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    if (
        value instanceof Date &&
        !Number.isNaN(value.getTime())
    ) {
        return value;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function dateFields(value) {

    const date = parseDate(value);

    if (!date) {
        return {
            orderCreationDate: null,
            year: null,
            month: null,
            monthName: null,
            monthNumber: null,
            yearMonth: null,
            quarter: null
        };
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return {
        orderCreationDate:
            `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,

        year,

        month,

        monthName:
            date.toLocaleString("en-US", {
                month: "long"
            }),

        monthNumber: month,

        yearMonth:
            `${year}-${String(month).padStart(2, "0")}`,

        quarter:
            `Q${Math.ceil(month / 3)}`
    };
}

/* ======================================================
   FILE HELPERS
====================================================== */

function readJson(file) {

    try {

        if (!fs.existsSync(file)) {
            return {};
        }

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    } catch {

        return {};
    }
}

function writeJson(file, data) {

    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

/* ======================================================
   PRODUCT CLASSIFICATION
====================================================== */

function classifyProduct(rawProductName) {

    const text = lower(rawProductName);

    const mapped = (category) => ({ category, status: "Mapped" });

    if (!text) {

        return {
            category: "Other / Unclassified",
            status: "Unmapped"
        };
    }

    /* Shrink Wrap / Cap Seal */

    if (
        /cap\s*seal|pvc\s*seal|shrink\s*cap/.test(text)
    ) {
        return mapped("Shrink Wrap / Cap Seal");
    }

    if (
        /shrink\s*(film|wrap)|plastic\s*shrink/.test(text)
    ) {
        return mapped("Shrink Wrap / Cap Seal");
    }

    if (
        /cling\s*(wrap|film)|food\s*(wrap|film)/.test(text)
    ) {
        return mapped("Shrink Wrap / Cap Seal");
    }

    if (
        /shrink\s*sleeve/.test(text)
    ) {
        return mapped("Shrink Wrap / Cap Seal");
    }

    /* Bottle / Container */

    if (/\bjar\b/.test(text)) {
        return mapped("Bottle / Container");
    }

    if (/\bbottle\b/.test(text)) {
        return mapped("Bottle / Container");
    }

    if (/\bcontainer\b/.test(text)) {
        return mapped("Bottle / Container");
    }

    /* Tape */

    if (
        /double\s*sided|double\s*tape/.test(text)
    ) {
        return mapped("Tape / Adhesive");
    }

    if (
        /packaging\s*tape|packing\s*tape|carton\s*tape|brown\s*tape/.test(text)
    ) {
        return mapped("Tape / Adhesive");
    }

    if (
        /adhesive\s*tape|masking\s*tape|foam\s*tape/.test(text)
    ) {
        return mapped("Tape / Adhesive");
    }

    /* Label / Sticker */

    if (/\bsticker\b/.test(text)) {
        return mapped("Label / Sticker");
    }

    if (/\blabel\b/.test(text)) {
        return mapped("Label / Sticker");
    }

    /* Mailer */

    if (
        /poly\s*mailer|mailer\s*bag/.test(text)
    ) {
        return mapped("Mailer / Shipping Packaging");
    }

    if (
        /courier\s*bag/.test(text)
    ) {
        return mapped("Mailer / Shipping Packaging");
    }

    if (
        /shipping\s*bag/.test(text)
    ) {
        return mapped("Mailer / Shipping Packaging");
    }

    /* Protective Packaging */

    if (
        /bubble\s*wrap|bubble\s*film|air\s*bubble/.test(text)
    ) {
        return mapped("Protective Packaging");
    }

    if (
        /protective\s*film|protection\s*film|surface\s*film/.test(text)
    ) {
        return mapped("Protective Packaging");
    }

    /* Plastic Bags */

    if (/sando\s*bag/.test(text)) {
        return mapped("Plastic Bags");
    }

    if (/labo\s*bag/.test(text)) {
        return mapped("Plastic Bags");
    }

    if (
        /trash\s*bag|garbage\s*bag|basura\s*bag/.test(text)
    ) {
        return mapped("Plastic Bags");
    }

    if (/ice\s*bag/.test(text)) {
        return mapped("Plastic Bags");
    }

    if (/sandwich\s*bag/.test(text)) {
        return mapped("Plastic Bags");
    }

    if (/counter\s*bag/.test(text)) {
        return mapped("Plastic Bags");
    }

    if (
        /printed\s*(plastic\s*)?bag|custom\s*printed\s*bag/.test(text)
    ) {
        return mapped("Plastic Bags");
    }

    /* Accessories */

    if (
        /rubber\s*band|elastic\s*band/.test(text)
    ) {
        return mapped("Packaging Accessories");
    }

    if (/\bgloves?\b/.test(text)) {
        return mapped("Packaging Accessories");
    }

    if (
        /silica\s*gel|desiccant/.test(text)
    ) {
        return mapped("Packaging Accessories");
    }

    if (
        /cutter|cutting\s*tool|utility\s*knife|box\s*cutter/.test(text)
    ) {
        return mapped("Packaging Accessories");
    }

    if (
        /packaging\s*tool|packing\s*tool|heat\s*gun/.test(text)
    ) {
        return mapped("Packaging Accessories");
    }

    /* General Supplies */

    if (
        /tissue|kitchen\s*towel|cleaning\s*material|cleaning\s*cloth/.test(text)
    ) {
        return mapped("Packaging / General Supplies");
    }

    if (
        /\brags?\b|wiping\s*cloth/.test(text)
    ) {
        return mapped("Packaging / General Supplies");
    }

    if (/toothpick/.test(text)) {
        return mapped("Packaging / General Supplies");
    }

    if (
        /naphthalene|moth\s*ball/.test(text)
    ) {
        return mapped("Packaging / General Supplies");
    }

    if (
        /money\s*envelope|cash\s*envelope|ang\s*pao/.test(text)
    ) {
        return mapped("Packaging / General Supplies");
    }

    return {
        category: "Other / Unclassified",
        status: "Review"
    };
}

/* ======================================================
   GEOGRAPHIC STANDARDIZATION
====================================================== */

function standardizeGeography(
    rawProvince,
    rawCity
) {

    const sourceRegion = clean(rawProvince);
    const sourceProvince = clean(rawCity);

    let region =
        sourceRegion || "Unclassified";

    let province =
        sourceProvince || "Unclassified";

    /*
      Actual dataset interpretation:

      Shopee Province → Region
      Shopee City     → Province
    */

    if (
        lower(province) === "aurora"
    ) {
        region = "North Luzon";
    }

    return {
        rawProvince: sourceRegion,
        rawCity: sourceProvince,
        region,
        province,

        status:
            sourceRegion && sourceProvince
                ? "Mapped"
                : "Review"
    };
}

/* ======================================================
   READ UNIQUE READY IMPORTS
====================================================== */

function getReadyImports(
    databaseFile
) {

    const database =
        readJson(databaseFile);

    const imports =
        Array.isArray(database.imports)
            ? database.imports
            : [];

    const ready =
        imports.filter(
            item =>
                item.status === "Ready" &&
                item.storedFileName
        );

    /*
      Prevent duplicate database records from causing
      the same physical file to be processed twice.
    */

    const unique = [];
    const seen = new Set();

    for (const item of ready) {

        const key =
            item.storedFileName ||
            item.fileName;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        unique.push(item);
    }

    return unique;
}

/* ======================================================
   READ ALL SOURCE ROWS
====================================================== */

function readSourceRows(
    imports,
    uploadDir
) {

    const rows = [];
    const columns = new Set();

    const missingFiles = [];
    const invalidFiles = [];

    for (const item of imports) {

        const filePath =
            path.join(
                uploadDir,
                item.storedFileName
            );

        if (!fs.existsSync(filePath)) {

            missingFiles.push({
                fileName: item.fileName,
                storedFileName: item.storedFileName
            });

            continue;
        }

        try {

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

                invalidFiles.push({
                    fileName: item.fileName,
                    reason:
                        'Missing "orders" sheet.'
                });

                continue;
            }

            const worksheet =
                workbook.Sheets.orders;

            const data =
                XLSX.utils.sheet_to_json(
                    worksheet,
                    {
                        defval: null,
                        raw: false
                    }
                );

            for (
                let index = 0;
                index < data.length;
                index++
            ) {

                const row =
                    data[index];

                Object.keys(row).forEach(
                    column =>
                        columns.add(column)
                );

                rows.push({
                    item,
                    row,
                    sourceRow:
                        index + 2
                });
            }

        } catch (error) {

            invalidFiles.push({
                fileName: item.fileName,
                reason: error.message
            });
        }
    }

    return {
        rows,
        columns: [...columns].sort(),
        missingFiles,
        invalidFiles
    };
}

/* ======================================================
   SERVICE
====================================================== */

export function createPreparationService({
    uploadDir,
    dataDir,
    databaseFile
}) {

    const preparedFile =
        path.join(
            dataDir,
            PREPARED_FILE
        );

    const stateFile =
        path.join(
            dataDir,
            STATE_FILE
        );

    const overridesFile =
        path.join(
            dataDir,
            OVERRIDES_FILE
        );

    const categoriesFile = path.join(dataDir, CATEGORIES_FILE);

    // Fingerprint only the inputs that affect the prepared dataset. A reverted edit
    // matches the previous preparation without relying on a sticky dirty flag.
    function preparationInputs() {
        const db = readJson(databaseFile);
        const files = (Array.isArray(db.imports) ? db.imports : [])
            .filter(item => item.status === "Ready" && item.storedFileName)
            .map(item => ({ id: item.id, name: item.storedFileName, records: item.records, size: item.fileSize }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            files,
            products: readJson(overridesFile),
            categories: categoryConfiguration(),
            // Geographic normalization is defined in the existing ETL source.
            rulesVersion: "saipher-preparation-v1"
        };
    }
    function inputFingerprint(snapshot = preparationInputs()) {
        return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    }
    // Stable built-in rule keys are retained even after display-name changes.
    function categoryConfiguration() {
        const stored = readJson(categoriesFile);
        return {
            renamed: stored.renamed && typeof stored.renamed === 'object' && !Array.isArray(stored.renamed) ? stored.renamed : {},
            added: Array.isArray(stored.added) ? stored.added : [],
            deleted: Array.isArray(stored.deleted) ? stored.deleted : []
        };
    }

    function categoryDefinitions(configuration = categoryConfiguration()) {
        const result = {};
        for (const key of TAXONOMY) {
            if (configuration.deleted.includes(key)) continue;
            result[configuration.renamed[key] || key] = true;
        }
        for (const category of configuration.added) {
            result[category] = true;
        }
        return result;
    }

    function resolveCategory(raw, configuration = categoryConfiguration()) {
        if (configuration.deleted.includes(raw)) return FALLBACK_CATEGORY;
        if (TAXONOMY.includes(raw)) return configuration.renamed[raw] || raw;
        return raw;
    }

    function effectiveProduct(rawProductName, overrides, configuration) {
        const raw = overrides[rawProductName] || classifyProduct(rawProductName);
        const category = resolveCategory(raw.category, configuration);
        const taxonomy = categoryDefinitions(configuration);
        if (!taxonomy[category]) return { category: FALLBACK_CATEGORY, status: 'Review' };
        return {
            category,
                        status: category === FALLBACK_CATEGORY ? 'Review' : 'Mapped'
        };
    }

    function invalidatePreparation() {
        cachedBuild = null;
        // A classification change must never make previously generated rows uploadable.
        const state = readJson(stateFile);
        if (state && Object.keys(state).length) {
            state.readyForAnalysis = false;
            state.prepared = false;
            state.uploadedToSupabase = false;
            writeJson(stateFile, state);
        }
    }

    function validateCategoryName(name, current = null) {
        const value = clean(name);
        const existing = Object.keys(categoryDefinitions());
        if (!value) throw new Error('Category name is required.');
        if (value.length > 100) throw new Error('Category name must be 100 characters or fewer.');
        if (value.toLowerCase() === FALLBACK_CATEGORY.toLowerCase() && current !== FALLBACK_CATEGORY) throw new Error('Other / Unclassified is reserved.');
        if (existing.some(item => item.toLowerCase() === value.toLowerCase() && item !== current)) throw new Error('A category with this name already exists.');
        return value;
    }


    let cachedBuild = null;
    let cachedSnapshot = null;

    function snapshotBuild() {
        const state = readJson(stateFile);
        if (state?.sourceMode !== "supabase_snapshot" || state?.readOnlySnapshot !== true) {
            cachedSnapshot = null;
            return null;
        }
        if (!fs.existsSync(preparedFile)) throw new Error("The synchronized staging data file is missing.");
        const fileStamp = fs.statSync(preparedFile).mtimeMs;
        if (cachedSnapshot?.fileStamp === fileStamp) return cachedSnapshot;
        const master = readJson(preparedFile);
        if (!Array.isArray(master)) throw new Error("The synchronized staging data is invalid.");
        const metadata = state.supabaseSnapshot || {};
        const clean = value => String(value ?? "").trim();
        const unique = values => new Set(values.map(clean).filter(Boolean)).size;
        const validDate = value => {
            const date = String(value ?? "").slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return false;
            return new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
        };
        const sourceFiles = [...new Set(master.map(row => clean(row.source_file_name)).filter(Boolean))];
        const orders = new Set(master.map(row => clean(row.order_id)).filter(Boolean));
        const nonCompleted = new Map();
        const returnOrders = new Map();
        const productsByName = new Map();
        const geographyByPair = new Map();
        const duplicateRecords = [];
        const periods = new Map();
        for (const row of master) {
            const orderId = clean(row.order_id);
            if (clean(row.order_status).toLowerCase() !== "completed") {
                const key = orderId || row.id;
                if (!nonCompleted.has(key)) nonCompleted.set(key, { orderId: row.order_id, statuses: new Set(), products: new Set(), dates: new Set() });
                const item = nonCompleted.get(key);
                if (clean(row.order_status)) item.statuses.add(clean(row.order_status));
                if (clean(row.raw_product_name)) item.products.add(clean(row.raw_product_name));
                if (clean(row.order_creation_date)) item.dates.add(String(row.order_creation_date).slice(0, 10));
            }
            if (clean(row.return_refund_status) || Number(row.returned_quantity) > 0) {
                const key = orderId || row.id;
                if (!returnOrders.has(key)) returnOrders.set(key, { orderId: row.order_id, statuses: new Set(), products: new Set(), returnedQuantity: 0 });
                const item = returnOrders.get(key);
                if (clean(row.return_refund_status)) item.statuses.add(clean(row.return_refund_status));
                if (clean(row.raw_product_name)) item.products.add(clean(row.raw_product_name));
                item.returnedQuantity += Number.isFinite(Number(row.returned_quantity)) ? Number(row.returned_quantity) : 0;
            }
            const productName = clean(row.raw_product_name);
            if (productName && !productsByName.has(productName)) productsByName.set(productName, {
                rawProductName: productName,
                category: clean(row.category) || FALLBACK_CATEGORY,
                status: clean(row.category) && clean(row.category) !== FALLBACK_CATEGORY ? "Mapped" : "Review"
            });
            const geographyKey = JSON.stringify([row.raw_province ?? null, row.raw_city ?? null]);
            if (!geographyByPair.has(geographyKey)) geographyByPair.set(geographyKey, {
                rawProvince: row.raw_province, rawCity: row.raw_city,
                region: row.region, province: row.province,
                status: clean(row.region) && clean(row.province) ? "Mapped" : "Review"
            });
            if (row.is_exact_duplicate === true && duplicateRecords.length < 200) duplicateRecords.push({
                file: row.source_file_name, row: row.source_row_number,
                orderId: row.order_id, productName: row.raw_product_name,
                date: row.order_creation_date, quantity: row.quantity
            });
            const period = clean(row.year_month);
            if (period) {
                if (!periods.has(period)) periods.set(period, { yearMonth: period, monthName: row.month_name || null, quarter: row.quarter || null, records: 0 });
                periods.get(period).records++;
            }
        }
        for (const item of Array.isArray(metadata.productMapping) ? metadata.productMapping : []) {
            const rawProductName = clean(item.raw_product_name);
            if (!rawProductName) continue;
            productsByName.set(rawProductName, {
                rawProductName,
                category: clean(item.category) || FALLBACK_CATEGORY,
                status: item.mapping_status || (clean(item.category) && clean(item.category) !== FALLBACK_CATEGORY ? "Mapped" : "Review")
            });
        }
        for (const item of Array.isArray(metadata.geographicMapping) ? metadata.geographicMapping : []) {
            const geographyKey = JSON.stringify([item.raw_province ?? null, item.raw_city ?? null]);
            geographyByPair.set(geographyKey, {
                rawProvince: item.raw_province, rawCity: item.raw_city,
                region: item.region, province: item.province,
                status: clean(item.region) && clean(item.province) ? "Mapped" : "Review"
            });
        }
        const products = [...productsByName.values()].sort((a, b) => a.rawProductName.localeCompare(b.rawProductName));
        const geography = [...geographyByPair.values()].sort((a, b) => String(a.province || "").localeCompare(String(b.province || "")));
        const statusRecords = [...nonCompleted.values()].map(item => ({ ...item, statuses: [...item.statuses], products: [...item.products], dates: [...item.dates] }));
        const returnRecords = [...returnOrders.values()].map(item => ({ ...item, statuses: [...item.statuses], products: [...item.products] }));
        const dates = master.map(row => String(row.order_creation_date ?? "").slice(0, 10)).filter(validDate).sort();
        const finite = value => value !== null && value !== "" && Number.isFinite(Number(value));
        const quality = {
            invalidDateRecords: master.filter(row => !validDate(row.order_creation_date)).length,
            invalidQuantityRecords: master.filter(row => !finite(row.quantity) || Number(row.quantity) < 0).length,
            invalidReturnQuantityRecords: master.filter(row => row.returned_quantity != null && !finite(row.returned_quantity)).length,
            excessiveReturnQuantityRecords: master.filter(row => finite(row.returned_quantity) && finite(row.quantity) && Number(row.returned_quantity) > Number(row.quantity)).length,
            missingProductRecords: master.filter(row => !clean(row.raw_product_name)).length,
            missingRegionRecords: master.filter(row => !clean(row.raw_province)).length,
            missingProvinceRecords: master.filter(row => !clean(row.raw_city)).length,
            duplicateRows: master.filter(row => row.is_exact_duplicate === true).length,
            nonCompletedOrders: nonCompleted.size,
            returnRefundOrders: returnOrders.size,
            uniqueStatuses: [...new Set(master.map(row => clean(row.order_status)).filter(Boolean))].sort(),
            missingFiles: [], invalidFiles: []
        };
        const stateSource = {
            filesImported: sourceFiles.length,
            transactionLines: master.length,
            uniqueOrders: orders.size,
            uniqueProducts: products.length,
            dateCoverage: { min: dates[0] || null, max: dates.at(-1) || null }
        };
        const snapshotValidation = {
            geographicMappingPrepared: geography.length > 0 && quality.missingRegionRecords === 0 && quality.missingProvinceRecords === 0,
            productClassificationPrepared: products.length > 0,
            duplicateHandlingPrepared: master.every(row => typeof row.is_exact_duplicate === "boolean"),
            timeFieldsGenerated: master.length > 0 && master.every(row => Boolean(row.year_month)),
            analyticalMeasuresPrepared: master.length > 0 && master.every(row => finite(row.line_revenue) && finite(row.net_quantity))
        };
        const fields = [
            ["Year", "year"], ["Month", "month_name"], ["Month Number", "month_number"],
            ["Year-Month", "year_month"], ["Quarter", "quarter"]
        ].filter(([, key]) => master.some(row => row[key] != null && row[key] !== ""))
            .map(([field, key]) => ({ field, source: `Published ${key} field`, format: "Stored published value", example: master.find(row => row[key] != null && row[key] !== "")?.[key] }));
        cachedSnapshot = {
            fileStamp, state, metadata, master, quality, source: stateSource,
            products, geography, duplicateRecords,
            statusReview: statusRecords.slice(0, 200),
            returnReview: returnRecords.slice(0, 200),
            fields,
            timeSummary: {
                preparedRecords: master.filter(row => row.year != null && row.month != null && row.month_number != null && row.month_name && row.year_month && row.quarter).length,
                sourceRecords: master.length, needsReview: quality.invalidDateRecords,
                periods: [...periods.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
            },
            snapshotValidation
        };
        return cachedSnapshot;
    }

    // A published snapshot does not contain all source-workbook fields, so raw
    // financial ETL remains disabled. Product-category maintenance is safe:
    // only the category column and local category references are changed.
    function commitSnapshotCategoryChange({ rows, state, configuration, overrides }) {
        const modifications = [
            [preparedFile, rows], [stateFile, state],
            [categoriesFile, configuration], [overridesFile, overrides]
        ].filter(([, value]) => value !== undefined);
        const id = crypto.randomUUID();
        const backups = [];
        const temps = [];
        try {
            for (const [file, value] of modifications) {
                const tmp = `${file}.${id}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(value, null, file === preparedFile ? 0 : 2), { flag: 'wx' });
                temps.push(tmp);
                const backup = `${file}.${id}.bak`;
                const existed = fs.existsSync(file);
                if (existed) fs.copyFileSync(file, backup);
                backups.push({ file, backup, existed });
            }
            for (let i = 0; i < modifications.length; i++) fs.renameSync(temps[i], modifications[i][0]);
            cachedSnapshot = null;
            cachedBuild = null;
        } catch (error) {
            for (const item of backups) {
                try {
                    if (item.existed && fs.existsSync(item.backup)) fs.copyFileSync(item.backup, item.file);
                    else if (!item.existed && fs.existsSync(item.file)) fs.unlinkSync(item.file);
                } catch (restoreError) { console.error('Snapshot category rollback failed:', restoreError); }
            }
            throw new Error(`Local category update failed: ${error.message}`);
        } finally {
            [...temps, ...backups.map(item => item.backup)].forEach(file => {
                try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
            });
        }
    }

    function snapshotCategoryChange(action, { productName, category, oldName, newName, config } = {}) {
        const snapshot = snapshotBuild();
        if (!snapshot) return false;
        const rows = snapshot.master.map(row => ({ ...row }));
        const state = readJson(stateFile);
        const overrides = readJson(overridesFile);
        const productMapping = (state.supabaseSnapshot?.productMapping || []).map(item => ({ ...item }));
        if (action === 'product') {
            if (!snapshot.products.some(item => item.rawProductName === productName)) throw new Error('Product was not found in synchronized staging.');
            for (const row of rows) if (clean(row.raw_product_name) === productName) row.category = category;
            let found = false;
            for (const row of productMapping) if (clean(row.raw_product_name) === productName) {
                row.category = category;
                row.mapping_status = category === FALLBACK_CATEGORY ? 'Review' : 'Mapped';
                found = true;
            }
            if (!found) productMapping.push({ raw_product_name: productName, category, mapping_status: category === FALLBACK_CATEGORY ? 'Review' : 'Mapped' });
            overrides[productName] = { category, status: category === FALLBACK_CATEGORY ? 'Review' : 'Mapped' };
        } else if (action === 'rename') {
            for (const row of rows) if (row.category === oldName) row.category = newName;
            for (const row of productMapping) if (row.category === oldName) row.category = newName;
            for (const entry of Object.values(overrides)) if (entry?.category === oldName) entry.category = newName;
        }
        state.supabaseSnapshot.productMapping = productMapping;
        state.supabaseSnapshot.localCategoryEdits = true;
        state.uploadedToSupabase = false;
        // Changing a category is NOT a raw-workbook re-preparation or publication.
        // The existing snapshot stays intentionally ineligible for direct publish.
        commitSnapshotCategoryChange({ rows: action === 'product' || action === 'rename' ? rows : undefined,
            state, configuration: config, overrides });
        return true;
    }

    function assertEditableLocalSource() {
        if (snapshotBuild()) throw new Error("This synchronized Supabase dataset is read-only in Staging Data. Import the original Shopee workbooks to edit mappings or rerun preparation.");
    }

    /* ==================================================
       BUILD PREPARATION DATA
    ================================================== */

    function build() {

        if (cachedBuild) {
            return cachedBuild;
        }

        const ready =
            getReadyImports(
                databaseFile
            );

        if (!ready.length) {

            throw new Error(
                "No ready imported datasets are available for preparation."
            );
        }

        const source =
            readSourceRows(
                ready,
                uploadDir
            );

        const rows =
            source.rows;

        if (!rows.length) {

            if (
                source.missingFiles.length > 0
            ) {

                throw new Error(
                    `${source.missingFiles.length} imported file(s) are missing from server/data/uploads. Re-import the Excel files through Data Management.`
                );
            }

            throw new Error(
                "No transaction rows were found in the imported datasets."
            );
        }

        /* ----------------------------------------------
           Required-column validation
        ---------------------------------------------- */

        const missingColumns =
            REQUIRED_COLUMNS.filter(
                column =>
                    !source.columns.includes(
                        column
                    )
            );

        if (
            missingColumns.length > 0
        ) {

            throw new Error(
                `Required columns are missing: ${missingColumns.join(", ")}`
            );
        }

        const overrides = readJson(overridesFile);
        const categoryConfig = categoryConfiguration();

        /* ----------------------------------------------
           Containers
        ---------------------------------------------- */

        const rowHashes =
            new Set();

        const duplicateRecords = [];

        const products =
            new Map();

        const geography =
            new Map();

        const statusOrders =
            new Map();

        const returnOrders =
            new Map();

        const uniqueOrders =
            new Set();

        const uniqueStatuses =
            new Set();

        const master =
            [];

        /* ----------------------------------------------
           Quality counters
        ---------------------------------------------- */

        let duplicateCount = 0;

        let invalidDateRecords = 0;

        let invalidQuantityRecords = 0;

        let invalidReturnQuantityRecords = 0;

        let excessiveReturnQuantityRecords = 0;

        let missingProductRecords = 0;

        let missingRegionRecords = 0;

        let missingProvinceRecords = 0;

        /* ----------------------------------------------
           Exact duplicate hash

           IMPORTANT:
           Order ID is NOT used by itself.

           The entire row is hashed.
        ---------------------------------------------- */

        function rowHash(row) {

            return JSON.stringify(
                source.columns.map(
                    column =>
                        row[column] ?? null
                )
            );
        }

        /* ----------------------------------------------
           PROCESS ROWS
        ---------------------------------------------- */

        rows.forEach(
            (sourceRecord, index) => {

                const row =
                    sourceRecord.row;

                const orderId =
                    clean(
                        row["Order ID"]
                    );

                const status =
                    clean(
                        row["Order Status"]
                    );

                const rawProductName =
                    clean(
                        row["Product Name"]
                    );

                const variationName = clean(row["Variation Name"]);
                const skuReferenceNo = clean(row["SKU Reference No."]);

                const rawProvince =
                    clean(
                        row["Province"]
                    );

                const rawCity =
                    clean(
                        row["City"]
                    );

                const returnedStatus =
                    clean(
                        row["Return / Refund Status"]
                    );

                const quantity =
                    number(
                        row["Quantity"]
                    );

                const returnedQuantity =
                    number(
                        row["Returned quantity"]
                    );

                /* --------------------------------------
                   Unique order/status examination
                -------------------------------------- */

                if (orderId) {
                    uniqueOrders.add(orderId);
                }

                if (status) {
                    uniqueStatuses.add(status);
                }

                if (orderId) {

                    if (
                        !statusOrders.has(
                            orderId
                        )
                    ) {

                        statusOrders.set(
                            orderId,
                            new Set()
                        );
                    }

                    if (status) {

                        statusOrders
                            .get(orderId)
                            .add(status);
                    }
                }

                /* --------------------------------------
                   Date examination
                -------------------------------------- */

                const time =
                    dateFields(
                        row[
                            "Order Creation Date"
                        ]
                    );

                if (
                    !time.orderCreationDate
                ) {

                    invalidDateRecords++;
                }

                /* --------------------------------------
                   Numeric examination
                -------------------------------------- */

                if (
                    quantity === null ||
                    quantity < 0
                ) {

                    invalidQuantityRecords++;
                }

                if (
                    returnedQuantity !== null &&
                    returnedQuantity < 0
                ) {

                    invalidReturnQuantityRecords++;
                }

                if (
                    quantity !== null &&
                    returnedQuantity !== null &&
                    returnedQuantity >
                        quantity
                ) {

                    excessiveReturnQuantityRecords++;
                }

                /* --------------------------------------
                   Product mapping
                -------------------------------------- */

                const product = effectiveProduct(rawProductName, overrides, categoryConfig);

                if (!rawProductName) {
                    missingProductRecords++;
                }

                const productKey =
                    rawProductName ||
                    "__EMPTY_PRODUCT__";

                products.set(
                    productKey,
                    {
                        rawProductName:
                            rawProductName ||
                            "Other / Unclassified",

                        category:
                            product.category,

                        status:
                            product.status
                    }
                );

                /* --------------------------------------
                   Geography mapping
                -------------------------------------- */

                const geo =
                    standardizeGeography(
                        rawProvince,
                        rawCity
                    );

                if (!rawProvince) {
                    missingRegionRecords++;
                }

                if (!rawCity) {
                    missingProvinceRecords++;
                }

                const geographyKey =
                    `${rawProvince}|||${rawCity}`;

                geography.set(
                    geographyKey,
                    {
                        rawProvince,
                        rawCity,
                        region: geo.region,
                        province: geo.province,
                        status: geo.status
                    }
                );

                /* --------------------------------------
                   Returns/refunds
                -------------------------------------- */

                if (
                    orderId &&
                    (
                        returnedStatus ||
                        (
                            returnedQuantity !== null &&
                            returnedQuantity > 0
                        )
                    )
                ) {

                    if (
                        !returnOrders.has(
                            orderId
                        )
                    ) {

                        returnOrders.set(
                            orderId,
                            {
                                statuses:
                                    new Set(),

                                products:
                                    new Set(),

                                returnedQuantity:
                                    0
                            }
                        );
                    }

                    const returnInfo =
                        returnOrders.get(
                            orderId
                        );

                    if (returnedStatus) {

                        returnInfo.statuses.add(
                            returnedStatus
                        );
                    }

                    if (rawProductName) {

                        returnInfo.products.add(
                            rawProductName
                        );
                    }

                    if (
                        returnedQuantity !== null
                    ) {

                        returnInfo.returnedQuantity +=
                            returnedQuantity;
                    }
                }

                /* --------------------------------------
                   EXACT DUPLICATE DETECTION
                -------------------------------------- */

                const hash =
                    rowHash(row);

                const isDuplicate =
                    rowHashes.has(hash);

                if (isDuplicate) {

                    duplicateCount++;

                    if (
                        duplicateRecords.length <
                        200
                    ) {

                        duplicateRecords.push({
                            sourceFile:
                                sourceRecord.item.fileName,

                            sourceRow:
                                sourceRecord.sourceRow,

                            orderId,

                            productName:
                                rawProductName,

                            date:
                                clean(
                                    row[
                                        "Order Creation Date"
                                    ]
                                ),

                            quantity:
                                quantity
                        });
                    }

                } else {

                    rowHashes.add(hash);
                }

                /*
                  Do not add exact duplicate rows
                  to the prepared Master Data.
                */

                if (isDuplicate) {
                    return;
                }

                /* --------------------------------------
                   ANALYTICAL INCLUSION RULE
                -------------------------------------- */

                const isCompleted =
                    lower(status) ===
                    "completed";

                const validQuantity =
                    quantity !== null &&
                    quantity >= 0
                        ? quantity
                        : 0;

                // Invalid return quantities must not silently enter net sales metrics.
                if (isCompleted && (quantity === null || quantity < 0 || returnedQuantity !== null && (returnedQuantity < 0 || returnedQuantity > quantity))) {
                    throw new Error(`Invalid sold/returned quantity in ${sourceRecord.item.fileName} row ${sourceRecord.sourceRow}. Reconcile the source before preparing analytics.`);
                }
                const validReturned = returnedQuantity !== null && returnedQuantity >= 0 ? returnedQuantity : 0;

                const netQuantity =
                    Math.max(
                        0,
                        validQuantity -
                            validReturned
                    );

                /* --------------------------------------
                   Financial handling: Deal Price is the per-unit merchandise
                   price after price-level seller discounts. Do NOT deduct
                   Price Discount(from Seller) a second time. Shipping,
                   platform fees and platform vouchers are not merchandise.
                   Order-level seller vouchers are allocated ONCE per order
                   after duplicate removal (below).
                -------------------------------------- */
                const dealPrice = number(row["Deal Price"]);
                if (isCompleted && (dealPrice === null || dealPrice < 0)) {
                    throw new Error(`Missing or invalid Deal Price in ${sourceRecord.item.fileName} row ${sourceRecord.sourceRow}. Cannot verify product sales revenue.`);
                }
                const lineRevenue = dealPrice === null ? 0 : Math.round(dealPrice * validQuantity * 100) / 100;
                const orderSellerVoucher = number(row["Seller Voucher(PHP)"]) ?? 0;
                if (isCompleted && orderSellerVoucher < 0) {
                    throw new Error(`Invalid seller voucher in ${sourceRecord.item.fileName} row ${sourceRecord.sourceRow}.`);
                }

                const totalDiscount =
                    number(
                        row[
                            "Total Discount(PHP)"
                        ]
                    ) ?? 0;

                const sellerDiscount =
                    number(
                        row[
                            "Price Discount(from Seller)(PHP)"
                        ]
                    ) ?? 0;

                const shopeeRebate =
                    number(
                        row[
                            "Shopee Rebate(PHP)"
                        ]
                    ) ?? 0;

                const serviceFee =
                    number(
                        row[
                            "Service Fee"
                        ]
                    ) ?? 0;

                const paidTime =
                    parseDate(
                        row[
                            "Order Paid Time"
                        ]
                    );

                const shipTime =
                    parseDate(
                        row[
                            "Ship Time"
                        ]
                    );

                const completeTime =
                    parseDate(
                        row[
                            "Order Complete Time"
                        ]
                    );

                master.push({

                    etl_run_id: null,

                    source_file_name:
                        sourceRecord.item.fileName,

                    source_row_number:
                        sourceRecord.sourceRow,

                    order_id:
                        orderId,

                    order_status:
                        status || null,

                    return_refund_status:
                        returnedStatus ||
                        null,

                    /* TIME */

                    order_creation_date:
                        time.orderCreationDate,

                    order_paid_time:
                        paidTime
                            ? paidTime.toISOString()
                            : null,

                    ship_time:
                        shipTime
                            ? shipTime.toISOString()
                            : null,

                    order_complete_time:
                        completeTime
                            ? completeTime.toISOString()
                            : null,

                    year:
                        time.year,

                    month:
                        time.month,

                    month_name:
                        time.monthName,

                    month_number:
                        time.monthNumber,

                    year_month:
                        time.yearMonth,

                    quarter:
                        time.quarter,

                    /* GEOGRAPHY */

                    raw_province:
                        rawProvince || null,

                    raw_city:
                        rawCity || null,

                    region:
                        geo.region,

                    province:
                        geo.province,

                    /* PRODUCT */

                    raw_product_name:
                        rawProductName ||
                        "Other / Unclassified",

                    variation_name:
                        variationName || null,

                    sku_reference_no:
                        skuReferenceNo || null,

                    category:
                        product.category,

                    /* QUANTITY */

                    quantity:
                        validQuantity,

                    returned_quantity:
                        returnedQuantity,

                    net_quantity:
                        netQuantity,

                    /* FINANCIAL */

                    line_revenue:
                        lineRevenue,
                    merchandise_gross_before_order_voucher: lineRevenue,
                    seller_voucher_order_source: orderSellerVoucher,
                    revenue_basis: "deal_price_times_quantity_less_allocated_seller_voucher",
                    return_data_quality: returnedQuantity === null && /^(request approved|approved|refunded|returned)$/i.test(returnedStatus || '') ? "unknown_returned_quantity" : "verified_or_no_return",

                    total_discount:
                        totalDiscount,

                    seller_price_discount:
                        sellerDiscount,

                    shopee_rebate:
                        shopeeRebate,

                    service_fee:
                        serviceFee,

                    /* FLAGS */

                    is_exact_duplicate:
                        false,

                    is_included_in_analysis:
                        isCompleted,

                    exclusion_reason:
                        isCompleted
                            ? null
                            : exclusionReasonForStatus(status)
                });
            }
        );

        /* ==================================================
           ALLOCATE ORDER-LEVEL SELLER VOUCHERS EXACTLY ONCE
           Repeated order-level values in each source line are not additive.
           Deal Price already includes line-level seller price discounts.
           No zero-valued source fields are invented.
        ================================================== */
        const sellerVoucherGroups = new Map();
        for (const item of master) {
            if (!item.is_included_in_analysis) continue;
            if (!item.order_id && item.seller_voucher_order_source > 0) {
                throw new Error("Seller voucher cannot be allocated without an Order ID.");
            }
            if (!item.order_id) continue;
            if (!sellerVoucherGroups.has(item.order_id)) sellerVoucherGroups.set(item.order_id, []);
            sellerVoucherGroups.get(item.order_id).push(item);
        }
        for (const [orderId, items] of sellerVoucherGroups) {
            const amounts = [...new Set(items.map(item => Number(item.seller_voucher_order_source || 0)))];
            if (amounts.length > 1) {
                throw new Error(`Conflicting Seller Voucher amounts on order ${orderId}; verify the source before calculating revenue.`);
            }
            const voucher = amounts[0];
            if (!(voucher > 0)) continue;
            const gross = items.reduce((sum, item) => sum + item.merchandise_gross_before_order_voucher, 0);
            if (!(gross > 0) || voucher > gross + 0.001) {
                throw new Error(`Seller Voucher exceeds merchandise value for order ${orderId}.`);
            }
            let allocated = 0;
            items.forEach((item, index) => {
                const reduction = index === items.length - 1
                    ? Math.round((voucher - allocated) * 100) / 100
                    : Math.round(voucher * item.merchandise_gross_before_order_voucher / gross * 100) / 100;
                allocated += reduction;
                item.line_revenue = Math.round((item.line_revenue - reduction) * 100) / 100;
            });
        }

        /* ==================================================
           STATUS REVIEW
        ================================================== */

        const nonCompletedOrders =
            [];

        for (
            const [
                orderId,
                statuses
            ]
            of statusOrders.entries()
        ) {

            const statusList =
                [...statuses];

            const completedOnly =
                statusList.length === 1 &&
                lower(
                    statusList[0]
                ) === "completed";

            if (!completedOnly) {

                nonCompletedOrders.push({
                    orderId,
                    statuses:
                        statusList
                });
            }
        }

        /* ==================================================
           DATE COVERAGE
        ================================================== */

        const validDates =
            rows
                .map(
                    item =>
                        dateFields(
                            item.row[
                                "Order Creation Date"
                            ]
                        ).orderCreationDate
                )
                .filter(Boolean)
                .sort();

        const minDate =
            validDates[0] || null;

        const maxDate =
            validDates[
                validDates.length - 1
            ] || null;

        /* ==================================================
           RETURN REVIEW
        ================================================== */

        const returnReview =
            [...returnOrders.entries()]
                .slice(0, 200)
                .map(
                    ([
                        orderId,
                        info
                    ]) => ({
                        orderId,

                        returnStatuses:
                            [
                                ...info.statuses
                            ],

                        products:
                            [
                                ...info.products
                            ].slice(0, 10),

                        returnedQuantity:
                            info.returnedQuantity
                    })
                );

        /* ==================================================
           QUALITY
        ================================================== */

        const quality = {

            duplicateRows:
                duplicateCount,

            nonCompletedOrders:
                nonCompletedOrders.length,

            returnRefundOrders:
                returnOrders.size,

            invalidDateRecords,

            invalidQuantityRecords,

            invalidReturnQuantityRecords,

            excessiveReturnQuantityRecords,

            missingProductRecords,

            missingRegionRecords,

            missingProvinceRecords,

            uniqueStatuses:
                [...uniqueStatuses],

            missingFiles:
                source.missingFiles,

            invalidFiles:
                source.invalidFiles
        };

        /* ==================================================
           VALIDATION

           Duplicate handling is considered a valid ETL
           operation because duplicate rows are excluded
           from the Master Data.

           The FRONTEND still requires the user to review
           them before proceeding.
        ================================================== */

        const validation = {

            geographicMappingPrepared:
                geography.size > 0 &&
                missingRegionRecords === 0 &&
                missingProvinceRecords === 0,

            productClassificationPrepared:
                products.size > 0,

            duplicateHandlingPrepared:
                duplicateCount >= 0,

            timeFieldsGenerated:
                master.length > 0 &&
                master.every(
                    row =>
                        row.year_month &&
                        row.quarter
                ),

            analyticalMeasuresPrepared:
                master.length > 0
        };

        /* ==================================================
           SOURCE PROFILE
        ================================================== */

        const state = {

            generatedAt:
                new Date().toISOString(),

            source: {

                filesImported:
                    ready.length,

                transactionLines:
                    rows.length,

                uniqueOrders:
                    uniqueOrders.size,

                uniqueProducts:
                    products.size,

                dateCoverage: {

                    min:
                        minDate,

                    max:
                        maxDate
                }
            },

            quality,

            validation,

            readyForAnalysis:
                false
        };

        cachedBuild = {

            master,

            state,

            products:
                [...products.values()],

            geography:
                [...geography.values()],

            duplicateRecords,

            statusReview:
                nonCompletedOrders
                    .slice(0, 200),

            returnReview,

            quality,

            taxonomy: categoryDefinitions(categoryConfig),

            timeFields: [

                {
                    field: "Year",
                    source: "Order Creation Date",
                    format: "YYYY",
                    example: "2025"
                },

                {
                    field: "Month",
                    source: "Order Creation Date",
                    format: "Full month name",
                    example: "November"
                },

                {
                    field: "Month Number",
                    source: "Order Creation Date",
                    format: "1 to 12",
                    example: "11"
                },

                {
                    field: "Year-Month",
                    source: "Order Creation Date",
                    format: "YYYY-MM",
                    example: "2025-11"
                },

                {
                    field: "Quarter",
                    source: "Order Creation Date",
                    format: "Q1 to Q4",
                    example: "Q4"
                }
            ]
        };

        return cachedBuild;
    }

    /* ==================================================
       PUBLIC FUNCTIONS
    ================================================== */

    function profile() {

        const snapshot = snapshotBuild();
        if (snapshot) return { source: snapshot.source, quality: snapshot.quality };

        const result =
            build();

        return {
            source:
                result.state.source,

            quality:
                result.quality
        };
    }

    function duplicates() {

        const snapshot = snapshotBuild();
        if (snapshot) return { total: snapshot.quality.duplicateRows, records: snapshot.duplicateRecords };

        const result =
            build();

        return {

            total:
                result.quality.duplicateRows,

            records:
                result.duplicateRecords
        };
    }

    function statuses() {

        const snapshot = snapshotBuild();
        if (snapshot) return { totalOrders: snapshot.quality.nonCompletedOrders, records: snapshot.statusReview };

        const result =
            build();

        return {

            totalOrders:
                result.quality.nonCompletedOrders,

            records:
                result.statusReview
        };
    }

    function returns() {

        const snapshot = snapshotBuild();
        if (snapshot) return { totalOrders: snapshot.quality.returnRefundOrders, records: snapshot.returnReview };

        const result =
            build();

        return {

            totalOrders:
                result.quality.returnRefundOrders,

            records:
                result.returnReview
        };
    }

    function geography() {

        const snapshot = snapshotBuild();
        if (snapshot) return { total: snapshot.geography.length, records: snapshot.geography };

        const result =
            build();

        return {

            total:
                result.geography.length,

            records:
                result.geography
        };
    }

    function products(search = "") {

        const snapshot = snapshotBuild();
        if (snapshot) {
            const query = lower(search);
            const records = snapshot.products.filter(item => !query || lower(item.rawProductName).includes(query));
            return { records, total: records.length, taxonomy: categoryDefinitions() };
        }

        const result =
            build();

        const query =
            lower(search);

        const records =
            result.products.filter(
                item =>
                    !query ||
                    lower(
                        item.rawProductName
                    ).includes(query)
            );

        return {

            records,

            total:
                records.length,

            taxonomy:
                result.taxonomy
        };
    }

    function saveProductMapping({
        rawProductName,
        category
    }) {

        if (!rawProductName) {

            throw new Error(
                "Raw Product Name is required."
            );
        }

        const taxonomy = categoryDefinitions();
        if (!taxonomy[category]) {

            throw new Error(
                "Invalid product category."
            );
        }

        if (snapshotBuild()) {
            snapshotCategoryChange('product', { productName: rawProductName, category });
            return { category, status: category === FALLBACK_CATEGORY ? 'Review' : 'Mapped' };
        }

        const overrides =
            readJson(
                overridesFile
            );

        overrides[
            rawProductName
        ] = {

            category,

            status:
                category ===
                "Other / Unclassified"
                    ? "Review"
                    : "Mapped"
        };

        writeJson(
            overridesFile,
            overrides
        );

        invalidatePreparation();

        return overrides[rawProductName];
    }

    function listCategories() {
        const taxonomy = categoryDefinitions();
        const snapshot = snapshotBuild();
        if (snapshot) {
            const counts = new Map();
            for (const row of snapshot.products) counts.set(row.category, (counts.get(row.category) || 0) + 1);
            return {
                categories: Object.keys(taxonomy).map(name => ({ name, productCount: counts.get(name) || 0, reserved: name === FALLBACK_CATEGORY })),
                taxonomy
            };
        }
        let rows = [];
        try { rows = build().products; } catch { /* Category editor must also work before first import. */ }
        const counts = new Map();
        for (const row of rows) counts.set(row.category, (counts.get(row.category) || 0) + 1);
        return {
            categories: Object.keys(taxonomy).map(name => ({
                name,
                productCount: counts.get(name) || 0,
                reserved: name === FALLBACK_CATEGORY
            })),
            taxonomy
        };
    }

    function addCategory(name) {
        const value = validateCategoryName(name);
        const config = categoryConfiguration();
        config.added.push(value);
        if (snapshotBuild()) snapshotCategoryChange('add', { config });
        else { writeJson(categoriesFile, config); invalidatePreparation(); }
        return listCategories();
    }

    function renameCategory(oldName, newName) {
        const taxonomy = categoryDefinitions();
        if (!taxonomy[oldName]) throw new Error('Category not found.');
        if (oldName === FALLBACK_CATEGORY) throw new Error('The fallback category cannot be renamed.');
        const name = validateCategoryName(newName, oldName);
        if (oldName === name) return listCategories();
        const config = categoryConfiguration();
        const original = TAXONOMY.find(key => !config.deleted.includes(key) && (config.renamed[key] || key) === oldName);
        if (original) config.renamed[original] = name;
        else config.added = config.added.map(item => item === oldName ? name : item);
        const overrides = readJson(overridesFile);
        for (const mapping of Object.values(overrides)) {
            if (mapping && mapping.category === oldName) mapping.category = name;
        }
        if (snapshotBuild()) snapshotCategoryChange('rename', { oldName, newName: name, config });
        else {
            // Preserve existing raw-workbook behavior.
            writeJson(categoriesFile, config);
            writeJson(overridesFile, overrides);
            invalidatePreparation();
        }
        return listCategories();
    }

    function deleteCategory(name) {
        const taxonomy = categoryDefinitions();
        if (!taxonomy[name]) throw new Error('Category not found.');
        if (name === FALLBACK_CATEGORY) throw new Error('The fallback category cannot be deleted.');
        let products = [];
        try { products = snapshotBuild()?.products || build().products; }
        catch { throw new Error('Cannot verify product assignments until imported products are available.'); }
        const assigned = products.filter(product => product.category === name).length;
        if (assigned) throw new Error(`This category is currently assigned to ${assigned} products. Reassign these products to another category before deleting it.`);
        const config = categoryConfiguration();
        const original = TAXONOMY.find(key => !config.deleted.includes(key) && (config.renamed[key] || key) === name);
        if (original) {
            config.deleted.push(original);
            delete config.renamed[original];
        } else {
            config.added = config.added.filter(item => item !== name);
        }
        if (snapshotBuild()) snapshotCategoryChange('delete', { config });
        else { writeJson(categoriesFile, config); invalidatePreparation(); }
        return listCategories();
    }

    function getTimeFields() {

        const snapshot = snapshotBuild();
        if (snapshot) return snapshot.fields;

        return build().timeFields;
    }

    function timeSummary() {

        const snapshot = snapshotBuild();
        if (snapshot) return snapshot.timeSummary;

        const result = build();
        const periods = new Map();

        result.master.forEach(row => {
            if (!row.year_month) return;

            if (!periods.has(row.year_month)) {
                periods.set(row.year_month, {
                    yearMonth: row.year_month,
                    monthName: row.month_name,
                    quarter: row.quarter,
                    records: 0
                });
            }

            periods.get(row.year_month).records += 1;
        });

        return {
            preparedRecords: result.master.filter(row => row.year != null && row.month != null && row.month_number != null && row.month_name && row.year_month && row.quarter).length,
            sourceRecords: result.state.source.transactionLines,
            needsReview: result.quality.invalidDateRecords,
            periods: [...periods.values()].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        };
    }

    function run() {
        assertEditableLocalSource();
        const existing = currentStatus();
        if (existing.prepared && existing.runId && existing.inputFingerprint === inputFingerprint()) {
            return { ...existing, unchanged: true };
        }
        cachedBuild = null;

        const result =
            build();

        const runId =
            `${Date.now()}-prep`;

        result.master.forEach(
            row => {
                row.etl_run_id =
                    runId;
            }
        );

        // Preserve the previous successful output on I/O failure. The prepared
        // file and state are replaced using temporary files and rollback copies.
        const snapshot = preparationInputs();
        const nextState = result.state;
        // Keep only a digest for freshness validation; no detailed change history is stored.
        nextState.inputFingerprint = inputFingerprint(snapshot);

        /*
          At this stage duplicate handling has been
          performed automatically, but the frontend still
          requires the user to open Review before proceeding.
        */

        result.state.runId =
            runId;

        result.state.prepared =
            true;

        result.state.readyForAnalysis =
            false;

        result.state.validation =
            {
                ...result.state.validation,

                duplicateHandlingPrepared:
                    true
            };

        const txn = `${Date.now()}-${crypto.randomUUID()}`;
        const files = [preparedFile, stateFile];
        const temps = files.map(file => `${file}.${txn}.tmp`);
        const backups = files.map(file => `${file}.${txn}.bak`);
        try {
            fs.writeFileSync(temps[0], JSON.stringify(result.master, null, 2), "utf8");
            fs.writeFileSync(temps[1], JSON.stringify(result.state, null, 2), "utf8");
            files.forEach((file, index) => { if (fs.existsSync(file)) fs.copyFileSync(file, backups[index]); });
            fs.renameSync(temps[0], preparedFile);
            fs.renameSync(temps[1], stateFile);
        } catch (error) {
            files.forEach((file, index) => { if (fs.existsSync(backups[index])) fs.copyFileSync(backups[index], file); });
            throw error;
        } finally {
            [...temps, ...backups].forEach(file => { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} });
        }

        return result.state;
    }

    function currentStatus() {

        const state =
            fs.existsSync(stateFile)
                ? readJson(stateFile)
                : {
                    prepared: false,
                    readyForAnalysis: false
                };

        if (state?.sourceMode === "supabase_snapshot" && state?.readOnlySnapshot === true) {
            const snapshot = snapshotBuild();
            return {
                sourceMode: "supabase_snapshot",
                readOnlySnapshot: true,
                snapshotSyncedAt: state.supabaseSnapshot?.syncedAt || null,
                snapshotRecords: snapshot?.master.length || 0,
                prepared: false,
                uploadedToSupabase: false,
                readyForAnalysis: false,
                runId: null,
                validation: snapshot?.snapshotValidation || {}
            };
        }

        return {

            ...state,
            prepared: Boolean(fs.existsSync(preparedFile) && state.runId && state.inputFingerprint && state.inputFingerprint === inputFingerprint())
        };
    }

    function masterSummary() {

        const snapshot = snapshotBuild();
        if (snapshot) return {
            prepared: false,
            readOnlySnapshot: true,
            records: snapshot.master.length,
            includedRecords: snapshot.master.filter(row => row.is_included_in_analysis === true && row.is_exact_duplicate !== true).length,
            excludedRecords: snapshot.master.filter(row => row.is_included_in_analysis !== true || row.is_exact_duplicate === true).length,
            generatedAt: snapshot.metadata.syncedAt || snapshot.state.generatedAt
        };

        if (
            !fs.existsSync(
                preparedFile
            )
        ) {

            return {
                prepared: false
            };
        }

        const rows =
            readJson(
                preparedFile
            );

        return {

            prepared: true,

            records:
                Array.isArray(rows)
                    ? rows.length
                    : 0,

            includedRecords:
                Array.isArray(rows)
                    ? rows.filter(
                        row =>
                            row.is_included_in_analysis
                    ).length
                    : 0,

            excludedRecords:
                Array.isArray(rows)
                    ? rows.filter(
                        row =>
                            !row.is_included_in_analysis
                    ).length
                    : 0,

            generatedAt:
                fs.statSync(
                    preparedFile
                ).mtime.toISOString()
        };
    }

    function replaceWithSupabaseSnapshot(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.transactions) || snapshot.transactions.length === 0) {
            throw new Error("A complete, validated Supabase transaction set is required before replacing local staging.");
        }
        const rows = snapshot.transactions.map(({ subcategory: _removedSubcategory, ...row }) => row);
        const nextState = {
            sourceMode: "supabase_snapshot",
            readOnlySnapshot: true,
            generatedAt: snapshot.syncedAt,
            prepared: false,
            readyForAnalysis: false,
            runId: null,
            inputFingerprint: null,
            uploadedToSupabase: false,
            supabaseSnapshot: {
                syncedAt: snapshot.syncedAt,
                latestRun: snapshot.latestRun,
                mappingCounts: snapshot.mappingCounts,
                productMapping: snapshot.productMapping,
                geographicMapping: snapshot.geographicMapping,
                summary: snapshot.summary
            }
        };
        const txn = `${Date.now()}-${crypto.randomUUID()}`;
        const files = [preparedFile, stateFile];
        const temps = files.map(file => `${file}.${txn}.tmp`);
        const backups = files.map(file => `${file}.${txn}.bak`);
        const existed = files.map(file => fs.existsSync(file));
        try {
            fs.writeFileSync(temps[0], JSON.stringify(rows), { encoding: "utf8", flag: "wx" });
            fs.writeFileSync(temps[1], JSON.stringify(nextState, null, 2), { encoding: "utf8", flag: "wx" });
            files.forEach((file, index) => { if (existed[index]) fs.copyFileSync(file, backups[index]); });
            fs.renameSync(temps[0], preparedFile);
            fs.renameSync(temps[1], stateFile);
            cachedBuild = null;
            cachedSnapshot = null;
            return { records: rows.length, syncedAt: snapshot.syncedAt };
        } catch (error) {
            files.forEach((file, index) => {
                try {
                    if (existed[index] && fs.existsSync(backups[index])) fs.copyFileSync(backups[index], file);
                    else if (!existed[index] && fs.existsSync(file)) fs.unlinkSync(file);
                } catch {}
            });
            throw new Error(`Could not replace local staging data: ${error.message}`);
        } finally {
            [...temps, ...backups].forEach(file => { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} });
        }
    }

    function activateLocalImports() {
        const state = readJson(stateFile);
        if (state?.sourceMode !== "supabase_snapshot" || state?.readOnlySnapshot !== true) return false;
        const txn = `${Date.now()}-${crypto.randomUUID()}`;
        const preparedBackup = `${preparedFile}.${txn}.bak`;
        const stateTemp = `${stateFile}.${txn}.tmp`;
        const hadPrepared = fs.existsSync(preparedFile);
        try {
            fs.writeFileSync(stateTemp, JSON.stringify({ prepared: false, readyForAnalysis: false, sourceMode: "local_imports" }, null, 2), "utf8");
            if (hadPrepared) fs.renameSync(preparedFile, preparedBackup);
            fs.renameSync(stateTemp, stateFile);
        } catch (error) {
            try { if (hadPrepared && fs.existsSync(preparedBackup)) fs.renameSync(preparedBackup, preparedFile); } catch {}
            try { if (fs.existsSync(stateTemp)) fs.unlinkSync(stateTemp); } catch {}
            throw new Error(`Could not switch staging back to imported workbooks: ${error.message}`);
        }
        try { if (fs.existsSync(preparedBackup)) fs.unlinkSync(preparedBackup); } catch {}
        cachedSnapshot = null;
        cachedBuild = null;
        return true;
    }

    function clearCache() {

        cachedBuild = null;
        cachedSnapshot = null;
    }

    return {

        profile,

        duplicates,

        statuses,

        returns,

        geography,

        products,

        saveProductMapping,
        listCategories,
        addCategory,
        renameCategory,
        deleteCategory,

        timeFields:
            getTimeFields,

        timeSummary,

        run,

        status:
            currentStatus,

        masterSummary,
        replaceWithSupabaseSnapshot,
        activateLocalImports,
        clearCache
    };
}
