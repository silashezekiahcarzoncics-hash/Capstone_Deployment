import { useEffect, useMemo, useRef, useState } from "react";
import { clearAnalyticsMemoryCache, fetchScopedAnalytics } from "../data/analyticsApi";

import {
    FaCheckCircle,
    FaExclamationTriangle,
    FaDatabase,
    FaCloud,
    FaCalendarAlt,
    FaCopy,
    FaClipboardCheck,
    FaUndo,
    FaMapMarkedAlt,
    FaBoxOpen,
    FaClock,
    FaCalculator,
    FaSearch,
    FaTimes,
    FaChevronLeft,
    FaChevronRight,
    FaPlay,
    FaSyncAlt,
    FaArrowRight,
    FaPlus,
    FaPen,
    FaTrash,
    FaLock
} from "react-icons/fa";

import "../styles/data-preparation.css";

const API_URL = "http://localhost:4000/api";
const PRODUCT_PAGE_SIZE = 10;

const DEFAULT_CATEGORY_OPTIONS = [
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

const CATEGORY_LOOKUP = Object.fromEntries(DEFAULT_CATEGORY_OPTIONS.map(category => [category, true]));

const dataProfileDefaults = {
    filesImported: 0,
    transactionLines: 0,
    uniqueOrders: 0,
    coverage: "—",
    productListings: 0,
    regions: 0,
    provinces: 0
};

function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
}

function formatCoverage(source) {
    if (!source?.dateCoverage?.min || !source?.dateCoverage?.max) {
        return "—";
    }

    const min = new Date(`${source.dateCoverage.min}T00:00:00`);
    const max = new Date(`${source.dateCoverage.max}T00:00:00`);

    const formatter = new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric"
    });

    return `${formatter.format(min)} – ${formatter.format(max)}`;
}

function Modal({ title, subtitle, eyebrow, children, onClose, wide = false, headerAction = null, variant = "" }) {
    const modalRef = useRef(null);

    useEffect(() => {
        const previousFocus = document.activeElement;
        const closeButton = modalRef.current?.querySelector(".icon-button");
        closeButton?.focus();
        return () => previousFocus?.focus?.();
    }, []);

    return (
        <div className={`prep-modal-backdrop${variant ? ` ${variant}-backdrop` : ""}`} onMouseDown={onClose}>
            <div
                ref={modalRef}
                className={`prep-modal${wide ? " wide" : ""}${variant ? ` ${variant}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="prep-modal-title"
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.stopPropagation();
                        onClose();
                        return;
                    }
                    if (event.key === "Tab") {
                        const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
                        if (!focusable.length) return;
                        const first = focusable[0];
                        const last = focusable[focusable.length - 1];
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault();
                            last.focus();
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault();
                            first.focus();
                        }
                    }
                }}
            >
                <div className="prep-modal-header">
                    <div>
                        {eyebrow && <span className="prep-modal-kicker">{eyebrow}</span>}
                        <h3 id="prep-modal-title">{title}</h3>
                        {subtitle && <p>{subtitle}</p>}
                    </div>
                    <div className="prep-modal-header-actions">
                        {headerAction}
                    <button className="icon-button" onClick={onClose} aria-label="Close modal" autoFocus>
                        <FaTimes />
                    </button>
                    </div>
                </div>
                <div className="prep-modal-body">{children}</div>
            </div>
        </div>
    );
}

function QualityRow({ icon, title, description, status, action, onAction }) {
    const passed = status === "Passed";
    const prepared = ["Prepared", "Automatically Handled", "Informational"].includes(status);

    return (
        <div className="quality-row">
            <div className={`quality-icon ${passed || prepared ? "success" : "warning"}`}>
                {passed || prepared ? <FaCheckCircle /> : <FaExclamationTriangle />}
            </div>
            <div className="quality-copy">
                <strong>{title}</strong>
                <span>{description}</span>
            </div>
            <span className={`status-badge ${passed || prepared ? "passed" : "review"}`}>
                {status}
            </span>
            {action && (
                <button className="outline-button small" onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}

function InfoHint({ label, children, className = "" }) {
    return (
        <details className={`prep-info-hint ${className}`}>
            <summary aria-label={label} title={label}>?</summary>
            <div className="prep-info-hint-content">{children}</div>
        </details>
    );
}

export default function DataPreparation({ setActivePage }) {
    const [profile, setProfile] = useState(dataProfileDefaults);
    const [quality, setQuality] = useState({});
    const [products, setProducts] = useState([]);
    const [categoryRows, setCategoryRows] = useState([]);
    const [categoryTaxonomy, setCategoryTaxonomy] = useState(CATEGORY_LOOKUP);
    const [showCategoryManager, setShowCategoryManager] = useState(false);
    const [categoryPage, setCategoryPage] = useState(1);
    const [categoryEditing, setCategoryEditing] = useState(null);
    const [categoryDraft, setCategoryDraft] = useState('');
    const [categoryAdding, setCategoryAdding] = useState(false);
    const [categoryBusy, setCategoryBusy] = useState(false);
    const [categoryError, setCategoryError] = useState('');
    const [categoryDelete, setCategoryDelete] = useState(null);
    const [productSearch, setProductSearch] = useState("");
    const [productFilter, setProductFilter] = useState("all");
    const [geoMappings, setGeoMappings] = useState([]);
    const [statusReview, setStatusReview] = useState([]);
    const [returnReview, setReturnReview] = useState([]);
    const [duplicates, setDuplicates] = useState([]);
    const [timeFields, setTimeFields] = useState([]);
    const [timeSummary, setTimeSummary] = useState({ preparedRecords: 0, sourceRecords: 0, needsReview: 0, periods: [] });
    const [preparationState, setPreparationState] = useState(null);
    const [view, setView] = useState("staging");
    const [preparedSummary, setPreparedSummary] = useState(null);
    const [liveData, setLiveData] = useState(null);
    const [liveReport, setLiveReport] = useState(null);
    const [liveProductSearch, setLiveProductSearch] = useState("");
    const [liveError, setLiveError] = useState("");
    const [liveLoading, setLiveLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [noImports, setNoImports] = useState(false);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncingFromSupabase, setSyncingFromSupabase] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [syncMessage, setSyncMessage] = useState("");
    const [error, setError] = useState("");
    const [modal, setModal] = useState(null);
    const [productPage, setProductPage] = useState(1);
    const [editedProduct, setEditedProduct] = useState(null);
    const [duplicateReviewed, setDuplicateReviewed] = useState(false);
    const [statusReviewed, setStatusReviewed] = useState(false);
    const [returnsReviewed, setReturnsReviewed] = useState(false);

    const [geoFilter, setGeoFilter] = useState("all");

    const categoryOptions = Object.keys(categoryTaxonomy);
    const productSummary = useMemo(() => {
        const mapped = products.filter(item => item.status === "Mapped");
        const review = products.filter(item => item.status !== "Mapped");
        return { mapped, review };
    }, [products]);

    const geoSummary = useMemo(() => {
        const mapped = geoMappings.filter(item => item.status === "Mapped");
        const review = geoMappings.filter(item => item.status !== "Mapped");
        return { mapped, review };
    }, [geoMappings]);

    const visibleGeoRows = useMemo(() => {
        const rows =
            geoFilter === "mapped" ? geoSummary.mapped :
            geoFilter === "review" ? geoSummary.review :
            geoMappings;
        return [...rows].sort((a, b) =>
            (a.status === "Mapped") - (b.status === "Mapped") ||
            String(a.region).localeCompare(String(b.region)) ||
            String(a.province).localeCompare(String(b.province))
        );
    }, [geoMappings, geoSummary, geoFilter]);

    async function getJson(endpoint, options = {}) {
        let response;
        try {
            response = await fetch(`${API_URL}${endpoint}`, options);
        } catch {
            throw new Error(
                `Cannot reach the Data Preparation API at ${API_URL}. Start the backend with "npm run server" from the project root.`
            );
        }
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error("The Data Preparation API returned HTML instead of JSON. Restart the backend with `npm run server`, then refresh this page.");
        }
        if (!response.ok) throw new Error(result.error || "Request failed.");
        return result;
    }

    async function refreshPreparationStatus() {
        const [state, summary] = await Promise.all([
            getJson("/preparation/status"),
            getJson("/preparation/master-summary")
        ]);
        setPreparationState(state);
        setPreparedSummary(summary);
    }

    async function refreshLiveData(force = false) {
        // Loading the tab should use the cached report; only Refresh bypasses it.
        // Keep the previous successful report visible during a manual refresh.
        setLiveLoading(true);
        setLiveError("");
        try {
            const report = await getJson(`/preparation/live-report${force ? "?refresh=1" : ""}`);
            setLiveReport(report);
            setLiveData(report);
            return report;
        } catch (err) {
            setLiveError(err.message);
            return null;
        } finally { setLiveLoading(false); }
    }

    async function loadPreparationData() {
        setLoading(true);
        setLoadError("");
        setNoImports(false);
        setError("");

        try {
            const [profileData, productData, geoData, statusData, returnData, duplicateData, timeData, stateData, categoriesData] =
                await Promise.all([
                    getJson("/preparation/profile"),
                    getJson("/preparation/products"),
                    getJson("/preparation/geography"),
                    getJson("/preparation/status-review"),
                    getJson("/preparation/returns"),
                    getJson("/preparation/duplicates"),
                    getJson("/preparation/time-fields"),
                    getJson("/preparation/status"),
                    getJson("/preparation/categories")
                ]);

            const source = profileData.source || {};
            const q = profileData.quality || {};

            const geographyRegions = new Set(
                (geoData.records || []).map(item => item.region).filter(Boolean)
            );
            const geographyProvinces = new Set(
                (geoData.records || []).map(item => item.province).filter(Boolean)
            );

            setProfile({
                filesImported: source.filesImported || 0,
                transactionLines: source.transactionLines || 0,
                uniqueOrders: source.uniqueOrders || 0,
                coverage: formatCoverage(source),
                productListings: source.uniqueProducts || 0,
                regions: geographyRegions.size,
                provinces: geographyProvinces.size
            });

            setQuality(q);
            setProducts(productData.records || []);
            setCategoryRows(categoriesData.categories || []);
            setCategoryTaxonomy(categoriesData.taxonomy || CATEGORY_LOOKUP);
            setGeoMappings(geoData.records || []);
            setStatusReview(statusData.records || []);
            setReturnReview(returnData.records || []);
            setDuplicates(duplicateData.records || []);
            setTimeFields(timeData.fields || []);
            setTimeSummary(timeData.summary || {
                preparedRecords: 0,
                sourceRecords: source.transactionLines || 0,
                needsReview: q.invalidDateRecords || 0,
                periods: []
            });
            setPreparationState(stateData);
            setPreparedSummary(await getJson("/preparation/master-summary"));
        } catch (err) {
            // Empty installations should guide users to Data Management rather
            // than making the preparation page look broken.
            if (/No ready imported datasets are available for preparation/i.test(err.message)) {
                setNoImports(true);
                setPreparationState(await getJson("/preparation/status").catch(() => ({ prepared: false })));
                setPreparedSummary(null);
                setProducts([]);
                setGeoMappings([]);
                setQuality({});
                setProfile(dataProfileDefaults);
            } else {
                console.error(err);
                setError(err.message);
                setLoadError(err.message);
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadPreparationData();
    }, []);

    async function runPreparation() {
        setRunning(true);
        setError("");
        setSyncMessage("");

        try {
            const result = await getJson("/preparation/run", { method: "POST" });
            setDuplicateReviewed(false);
            setStatusReviewed(false);
            setReturnsReviewed(false);
            await loadPreparationData();
            setSyncMessage(result.unchanged
                ? "No relevant input changes detected. The prepared dataset remains current."
                : "Preparation completed locally. Publish the prepared dataset to update live analytics.");
        } catch (err) {
            setError(err.message);
        } finally {
            setRunning(false);
        }
    }

    async function pushPreparedData() {
        setPushing(true);
        setError("");
        setSyncMessage("");

        try {
            const result = await getJson("/preparation/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmReplace: true, runId: preparationState?.runId })
            });
            clearAnalyticsMemoryCache();
            await refreshPreparationStatus();
            await refreshLiveData();
            setModal(null);
            setSyncMessage(`Published ${formatNumber(result.preparedRecords)} prepared records to Supabase successfully.${result.warning ? ` Note: ${result.warning}` : ""}`);
        } catch (err) {
            setError(err.message);
        } finally {
            setPushing(false);
        }
    }

    async function syncDatabase() {
        setSyncing(true);
        setError("");
        setSyncMessage("");
        try {
            const result = await refreshLiveData(true);
            if (result) setSyncMessage(`Refreshed live Supabase status: ${formatNumber(result.records)} records.`);
        } finally { setSyncing(false); }
    }

    async function syncSupabaseStaging() {
        setSyncingFromSupabase(true);
        setError("");
        setSyncMessage("");
        try {
            const result = await getJson("/preparation/sync-supabase", { method: "POST" });
            setDuplicateReviewed(false);
            setStatusReviewed(false);
            setReturnsReviewed(false);
            await loadPreparationData();
            setModal(null);
            setSyncMessage(`Copied ${formatNumber(result.records)} published records into local staging. You can edit product categories locally, but a full Data Preparation rerun still requires the original Shopee workbooks.`);
        } catch (err) {
            setError(err.message);
            setModal(null);
        } finally { setSyncingFromSupabase(false); }
    }

    async function saveProductMapping() {
        if (!editedProduct) return;

        try {
            await getJson("/preparation/products", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rawProductName: editedProduct.rawProductName,
                    category: editedProduct.category
                })
            });

            // Update the visible categorization count immediately after a successful
            // local mapping save. Preparation/publishing remain a separate action.
            const changedProduct = editedProduct;
            setProducts(current => current.map(item =>
                item.rawProductName === changedProduct.rawProductName
                    ? { ...item, category: changedProduct.category,
                        status: changedProduct.category === "Other / Unclassified" ? "Review" : "Mapped" }
                    : item
            ));
            setEditedProduct(null);
            const [refreshed, state, categories] = await Promise.all([
                getJson("/preparation/products"), getJson("/preparation/status"),
                getJson("/preparation/categories")
            ]);
            setProducts(refreshed.records || []);
            setCategoryRows(categories.categories || []);
            setPreparationState(state);
            setSyncMessage(preparationState?.readOnlySnapshot
                ? "Category updated in local staging. Supabase is unchanged; the original Shopee workbooks are still needed for a full Data Preparation rerun."
                : "Product mapping saved locally. Run Data Preparation to apply changes; Supabase is unchanged.");
        } catch (err) {
            setError(err.message);
        }
    }

    async function changeCategory(method, body) {
        setCategoryBusy(true);
        setCategoryError('');
        try {
            const result = await getJson('/preparation/categories', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            setCategoryRows(result.categories);
            setCategoryTaxonomy(result.taxonomy);
            setCategoryEditing(null);
            setCategoryAdding(false);
            setCategoryDraft('');
            setCategoryDelete(null);
            setSyncMessage(preparationState?.readOnlySnapshot
                ? 'Category changes saved to local staging only. Supabase is unchanged.'
                : 'Category saved locally. Run Data Preparation again before uploading changes to Supabase.');

            try {
                const [refreshed, state] = await Promise.all([
                    getJson('/preparation/products'),
                    getJson('/preparation/status')
                ]);
                setProducts(refreshed.records || []);
                setPreparationState(state);
                if (editedProduct) {
                    const changed = (refreshed.records || []).find(row => row.rawProductName === editedProduct.rawProductName);
                    setEditedProduct(changed || null);
                }
            } catch (refreshError) {
                setError(`Category saved locally, but the review data could not be refreshed: ${refreshError.message}`);
            }
        } catch (err) {
            setCategoryError(err.message);
        } finally {
            setCategoryBusy(false);
        }
    }

    function openCategoryManager() {
        setCategoryError('');
        setCategoryPage(1);
        setCategoryEditing(null);
        setCategoryAdding(false);
        setCategoryDelete(null);
        setShowCategoryManager(true);
    }

    const categoryTotalPages = Math.max(1, Math.ceil(categoryRows.length / 10));
    const categoryCurrentPage = Math.min(categoryPage, categoryTotalPages);
    const pagedCategories = categoryRows.slice((categoryCurrentPage - 1) * 10, categoryCurrentPage * 10);

    const filteredProducts = useMemo(() => {
        const term = productSearch.trim().toLowerCase();
        const rows =
            productFilter === "mapped" ? productSummary.mapped :
            productFilter === "review" ? productSummary.review :
            products;
        if (!term) return rows;
        return rows.filter(item => item.rawProductName?.toLowerCase().includes(term));
    }, [products, productSearch, productFilter, productSummary]);

    const productPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
    const visibleProducts = filteredProducts.slice(
        (productPage - 1) * PRODUCT_PAGE_SIZE,
        productPage * PRODUCT_PAGE_SIZE
    );

    useEffect(() => {
        setProductPage(1);
    }, [productSearch, productFilter]);

    const datePassed = (quality.invalidDateRecords || 0) === 0;
    const invalidDateRecords = Number(timeSummary.needsReview ?? quality.invalidDateRecords) || 0;
    const numericPassed =
        (quality.invalidQuantityRecords || 0) === 0 &&
        (quality.invalidReturnQuantityRecords || 0) === 0 &&
        (quality.excessiveReturnQuantityRecords || 0) === 0;

    const validation = {
        geography: (preparationState?.validation?.geographicMappingPrepared ?? geoMappings.length > 0),
        product: products.length > 0 && products.every(item => item.category && categoryTaxonomy[item.category]),
        duplicates: true, // Exact duplicates are automatically handled by the established ETL.
        time: preparationState?.validation?.timeFieldsGenerated ?? profile.transactionLines > 0,
        measures: preparationState?.validation?.analyticalMeasuresPrepared ?? profile.transactionLines > 0
    };

    const readyForAnalysis = Object.values(validation).every(Boolean) && Boolean(preparationState?.prepared);
    const readyToPublish = readyForAnalysis && !preparationState?.uploadedToSupabase &&
        Boolean(preparationState?.runId) && Boolean(preparedSummary?.records);
    const fallbackCount = products.filter(item => item.category === "Other / Unclassified").length;

    function openDuplicateModal() {
        setModal("duplicates");
    }

    function openStatusModal() { setModal("status"); }

    function openReturnsModal() { setModal("returns"); }

    function openProductModal() {
        setProductFilter("all");
        setModal("products");
    }

    return (
        <div className="data-preparation">
            <div className="prep-page-header">
                <div>
                    <h1>Data Preparation</h1>
                    <p>Review, clean, and standardize your transaction records for reporting and forecasting.</p>
                </div>
                <div className="prep-header-actions">
                    <button className="outline-button" type="button" onClick={() => setModal("summary")}><FaClipboardCheck /> Preparation Summary</button>
                    {view === "staging" && <div className="prep-execution-actions">
                        <button className="outline-button" type="button" onClick={() => setModal("confirm-sync-supabase")}
                            disabled={running || syncing || syncingFromSupabase || pushing || loading}
                            title="Copy the currently published dataset into the existing local staging data.">
                            {syncingFromSupabase ? <FaSyncAlt className="saipher-spin" /> : <FaCloud />} {syncingFromSupabase ? "Syncing..." : "Sync from Supabase"}
                        </button>
                        <button className="primary-button" type="button" onClick={() => setModal("confirm-preparation")}
                            disabled={running || syncing || syncingFromSupabase || pushing || loading || noImports || Boolean(preparationState?.prepared) || Boolean(preparationState?.readOnlySnapshot)}
                            title={preparationState?.readOnlySnapshot ? "Published records do not contain all original Shopee fields required for a safe preparation rerun." : preparationState?.prepared ? "The current prepared dataset is up to date." : "Build the local prepared dataset."}>
                            <FaPlay /> {running ? "Preparing..." : "Run Data Preparation"}
                        </button>
                        <button className="outline-button publish-button" type="button" onClick={() => setModal("confirm-upload")}
                            disabled={!readyToPublish || pushing || running || syncing || loading}
                            title={!readyToPublish ? "Finish preparation and required reviews before publishing." : "Publish this prepared version to Supabase."}>
                            <FaDatabase /> Publish Prepared Data to Supabase
                        </button>
                    </div>}
                </div>
            </div>

            <div className="saipher-data-tabs" role="tablist" aria-label="Preparation data source">
                <button type="button" role="tab" aria-selected={view === "staging"} className={view === "staging" ? "active" : ""} onClick={() => setView("staging")}><FaDatabase aria-hidden="true" /> Staging Data (Local)</button>
                <button type="button" role="tab" aria-selected={view === "live"} className={view === "live" ? "active" : ""} onClick={() => { setView("live"); if (!liveReport && !liveLoading) refreshLiveData(); }}><FaCloud aria-hidden="true" /> Live Data (Supabase)</button>
                <span className="saipher-data-state">{preparationState?.readOnlySnapshot ? "Synced snapshot" : preparationState?.uploadedToSupabase ? "Published" : preparationState?.prepared ? "Ready to publish" : "Preparation required"}</span>
            </div>
            {view === "staging" ? (loading ? (
                <div className="saipher-loading-state" role="status" aria-live="polite">
                    <FaSyncAlt className="saipher-spin" />
                    <div><strong>Loading local preparation data…</strong><p>Reading imported workbooks, mappings and quality checks. Larger datasets may take longer on the first load; counts will appear when processing finishes.</p></div>
                </div>
            ) : loadError ? (
                <div className="saipher-loading-state saipher-loading-failed" role="alert">
                    <FaExclamationTriangle /> <div><strong>Local preparation data could not be loaded.</strong><p>{loadError}</p>
                    <button className="outline-button" type="button" onClick={loadPreparationData}>Retry Loading</button></div>
                </div>
            ) : <>
            {error && (
                <div className="prep-alert error-alert">
                    <FaExclamationTriangle />
                    <span>{error}</span>
                    <button onClick={() => setError("")}>Dismiss</button>
                </div>
            )}

            {noImports && (
                <div className="prep-alert empty-import-alert" role="status">
                    <span className="empty-import-icon"><FaBoxOpen /></span>
                    <div className="empty-import-copy">
                        <strong>No imported Excel files yet</strong>
                        <p>Import a valid Shopee workbook in Data Management before running preparation.</p>
                    </div>
                    <button className="primary-button" type="button" onClick={() => setActivePage?.("data-management")}>
                        Go to Data Management <FaArrowRight aria-hidden="true" />
                    </button>
                </div>
            )}

            {syncMessage && (
                <div className="prep-alert success-alert" role="status">
                    <FaCheckCircle />
                    <span>{syncMessage}</span>
                    <button onClick={() => setSyncMessage("")}>Dismiss</button>
                </div>
            )}

            {preparationState?.readOnlySnapshot && (
                <div className="prep-alert empty-import-alert" role="status">
                    <FaLock />
                    <span>This staging data came from published Supabase records. The existing sections below show the synchronized rows and mappings. Some original Shopee source fields are not published, so a full raw-workbook preparation rerun is disabled. Product-category review and edits are available here and stay local. Import the original Shopee workbooks to rerun the full preparation.</span>
                </div>
            )}

            <section className="prep-section" id="dp-profiling">
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">01</span>
                        <h2>Dataset Overview</h2>
                        <p>Summary of imported transaction files and sales volume.</p>
                    </div>
                </div>

                <div className="profile-grid">
                    <div className="profile-card">
                        <FaDatabase />
                        <span>Files Imported</span>
                        <strong>{formatNumber(profile.filesImported)}</strong>
                    </div>
                    <div className="profile-card">
                        <FaClipboardCheck />
                        <span>Transaction Lines</span>
                        <strong>{formatNumber(profile.transactionLines)}</strong>
                    </div>
                    <div className="profile-card">
                        <FaBoxOpen />
                        <span>Unique Orders</span>
                        <strong>{formatNumber(profile.uniqueOrders)}</strong>
                    </div>
                    <div className="profile-card">
                        <FaCalendarAlt />
                        <span>Data Coverage</span>
                        <strong className="compact-value">{profile.coverage}</strong>
                    </div>
                    <div className="profile-card">
                        <FaBoxOpen />
                        <span>Product Listings</span>
                        <strong>{formatNumber(profile.productListings)}</strong>
                    </div>
                    <div className="profile-card">
                        <FaMapMarkedAlt />
                        <span>Geographic Coverage</span>
                        <strong className="compact-value">
                            {formatNumber(profile.regions)} Regions / {formatNumber(profile.provinces)} Provinces
                        </strong>
                    </div>
                </div>
            </section>

            <section className="prep-section" id="dp-quality">
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">02</span>
                        <h2>Data Quality Checks</h2>
                        <p>Automated checks to verify data completeness and clean transaction records.</p>
                    </div>
                </div>

                <div className="quality-card">
                    <QualityRow
                        icon={FaCalendarAlt}
                        title="Date Fields"
                        description={datePassed ? "No major date-format issues detected." : `${formatNumber(quality.invalidDateRecords)} records have invalid or missing creation dates.`}
                        status={datePassed ? "Passed" : "Review Needed"}
                    />
                    <QualityRow
                        icon={FaCopy}
                        title="Exact Duplicates"
                        description={`${formatNumber(quality.duplicateRows || 0)} exact duplicate rows detected. Repeated Order IDs remain valid.`}
                        status={(quality.duplicateRows || 0) > 0 ? "Automatically Handled" : "Passed"}
                        action={(quality.duplicateRows || 0) > 0 ? "Review" : null}
                        onAction={openDuplicateModal}
                    />
                    <QualityRow
                        icon={FaClipboardCheck}
                        title="Order Status"
                        description={`${formatNumber(quality.nonCompletedOrders || 0)} orders are not marked Completed.`}
                        status={(quality.nonCompletedOrders || 0) > 0 ? "Informational" : "Passed"}
                        action={(quality.nonCompletedOrders || 0) > 0 ? "Review" : null}
                        onAction={openStatusModal}
                    />
                    <QualityRow
                        icon={FaUndo}
                        title="Returns / Refunds"
                        description={`${formatNumber(quality.returnRefundOrders || 0)} orders contain return/refund information.`}
                        status={(quality.returnRefundOrders || 0) > 0 ? "Informational" : "Passed"}
                        action={(quality.returnRefundOrders || 0) > 0 ? "Review" : null}
                        onAction={openReturnsModal}
                    />
                    <QualityRow
                        icon={FaCalculator}
                        title="Numeric Fields"
                        description={numericPassed ? "No major invalid-value pattern detected." : "Some numeric records require review."}
                        status={numericPassed ? "Passed" : "Review Needed"}
                    />
                </div>
            </section>

            <section className="prep-section" id="dp-transform">
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">03</span>
                        <h2>Data Standardization</h2>
                        <p>Standardize customer locations, products, and order dates into consistent business categories.</p>
                    </div>
                </div>

                <div className="transform-grid">
                    <div className="transform-card mapping-transform">
                        <div className="transform-card-header">
                            <div className="transform-icon"><FaMapMarkedAlt /></div>
                            <div>
                                <div className="transform-title-row">
                                    <h3>Geographic Standardization</h3>
                                    <button
                                        type="button"
                                        className="geo-help-button"
                                        aria-label="Help for Geographic Mapping"
                                        aria-haspopup="dialog"
                                        onClick={() => setModal("geography-help")}
                                    >
                                        ?
                                    </button>
                                </div>
                                <p>Group cities and delivery areas into standard regions and provinces.</p>
                            </div>
                        </div>
                        <div className="geo-stats">
                            <div className="geo-stat"><strong>{formatNumber(geoMappings.length)}</strong><span>Values detected</span></div>
                            <div className="geo-stat ok"><strong>{formatNumber(geoSummary.mapped.length)}</strong><span>Mapped</span></div>
                            <div className={`geo-stat ${geoSummary.review.length ? "warn" : "ok"}`}>
                                <strong>{formatNumber(geoSummary.review.length)}</strong><span>Unmapped / needs review</span>
                            </div>
                        </div>
                        <button
                            className="outline-button full geo-review-btn"
                            onClick={() => { setGeoFilter("all"); setModal("geography"); }}
                        >
                            Review Geographic Standardization
                        </button>
                    </div>

                    <div className="transform-card product-transform mapping-transform">
                        <div className="transform-card-header">
                            <div className="transform-icon"><FaBoxOpen /></div>
                            <div>
                                <div className="transform-title-row">
                                    <h3>Product Categorization</h3>
                                    <button
                                        type="button"
                                        className="geo-help-button"
                                        aria-label="Help for Product Mapping"
                                        aria-haspopup="dialog"
                                        onClick={() => setModal("product-help")}
                                    >
                                        ?
                                    </button>
                                </div>
                                <p>Group individual product listings into standardized packaging categories.</p>
                            </div>
                        </div>
                        <div className="geo-stats">
                            <div className="geo-stat"><strong>{formatNumber(products.length)}</strong><span>Values detected</span></div>
                            <div className="geo-stat ok"><strong>{formatNumber(productSummary.mapped.length)}</strong><span>Mapped</span></div>
                            <div className={`geo-stat ${productSummary.review.length ? "warn" : "ok"}`}>
                                <strong>{formatNumber(fallbackCount)}</strong><span>Others / Unclassified</span>
                            </div>
                        </div>
                        <button className="outline-button full geo-review-btn" onClick={openProductModal}>
                            Review Product Categorization
                        </button>
                    </div>

                    <div className="transform-card">
                        <div className="transform-card-header">
                            <div className="transform-icon"><FaClock /></div>
                            <div>
                                <div className="transform-title-row">
                                    <h3>Order Date Standardization</h3>
                                    <button
                                        type="button"
                                        className="geo-help-button"
                                        aria-label="Help for Time Fields"
                                        aria-haspopup="dialog"
                                        onClick={() => setModal("time-help")}
                                    >
                                        ?
                                    </button>
                                </div>
                                <p>Structure order creation dates into monthly periods for trend tracking and forecasting.</p>
                            </div>
                        </div>
                        <div className="geo-stats">
                            <div className="geo-stat">
                                <strong>{loading ? "—" : formatNumber(timeSummary.preparedRecords)}</strong>
                                <span>Records with time fields</span>
                            </div>
                            <div className="geo-stat ok">
                                <strong>{loading ? "—" : formatNumber(timeSummary.periods.length)}</strong>
                                <span>Detected months mapped</span>
                            </div>
                            <div className={`geo-stat ${invalidDateRecords > 0 ? "warn" : "ok"}`}>
                                <strong>{loading ? "—" : formatNumber(invalidDateRecords)}</strong>
                                <span>Missing / invalid dates</span>
                            </div>
                        </div>
                        <button className="outline-button full geo-review-btn" onClick={() => setModal("time")} disabled={loading}>
                            Review Date Standardization
                        </button>
                    </div>

                </div>
            </section>

            <section className="prep-section validation-section" id="dp-validation">
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">04</span>
                        <h2>Readiness Verification</h2>
                        <p>Confirm that the sales dataset is complete and ready for analysis.</p>
                    </div>
                </div>

                <div className="validation-layout">
                    <div className="validation-checklist">
                        {[
                            ["Regions and provinces mapped", validation.geography],
                            ["Product categories organized", validation.product],
                            ["Exact duplicates automatically handled", validation.duplicates],
                            ["Monthly timelines generated", validation.time],
                            ["Sales revenue and quantities calculated", validation.measures]
                        ].map(([label, ok]) => (
                            <div className={ok ? "validation-item complete" : "validation-item"} key={label}>
                                <FaCheckCircle />
                                <span>{label}</span>
                            </div>
                        ))}
                    </div>

                    <div className={readyForAnalysis ? "ready-card" : "ready-card not-ready"}>
                        <div className="ready-icon">
                            {readyForAnalysis ? <FaCheckCircle /> : <FaExclamationTriangle />}
                        </div>
                        <div>
                            <span className="ready-kicker">DATASET STATUS</span>
                            <h3>{preparationState?.readOnlySnapshot ? "SYNCED SNAPSHOT — SOURCE REQUIRED TO REPROCESS" : preparationState?.uploadedToSupabase ? "PUBLISHED TO LIVE ANALYTICS" : readyToPublish ? "PREPARED — READY TO PUBLISH" : !preparationState?.prepared ? "PREPARATION REQUIRED" : "REVIEW REQUIRED"}</h3>
                            <p>
                                {preparationState?.readOnlySnapshot
                                    ? "Published rows are available in Staging Data, but some original Shopee fields are not stored. Product-category edits are available locally; import original workbooks to run full preparation again."
                                    : readyForAnalysis
                                    ? (preparationState?.uploadedToSupabase ? "The current preparation run is published to Supabase." : "Prepared locally; analytics still use the last published Supabase dataset.")
                                    : "Review the outstanding data items above before proceeding."}
                            </p>
                        </div>
                        <button
                            className="primary-button"
                            disabled={!readyForAnalysis}
                            onClick={() => setActivePage?.("analysis-controls")}
                        >
                            Proceed to Analysis Scope <FaArrowRight />
                        </button>
                    </div>
                </div>
            </section>

            </>) : (
                <div className="saipher-live-view" aria-label="Read-only published data">
                    <div className="saipher-publish-bar">
                        <span><FaLock /> Published Supabase data — read-only. Changes can only be made in Staging Data.</span>
                        <button className="outline-button" type="button" onClick={syncDatabase} disabled={syncing || liveLoading}>
                            <FaSyncAlt /> {syncing || liveLoading ? "Loading..." : "Refresh Live Data"}
                        </button>
                    </div>
                    {liveLoading && <div className="saipher-loading-state" role="status" aria-live="polite">
                        <FaSyncAlt className="saipher-spin" />
                        <div><strong>{liveReport ? "Refreshing published data…" : "Loading published Supabase data…"}</strong>
                        <p>Reading the published transactions and preparing the read-only summary. No zero totals are shown until loading completes.</p></div>
                    </div>}
                    {liveError && <div className="prep-alert error-alert" role="alert">
                        <FaExclamationTriangle /> <span>{liveError}</span>
                        <button className="outline-button small" type="button" onClick={() => refreshLiveData(true)}>Retry</button>
                    </div>}
                    {!liveReport && !liveLoading && !liveError && <div className="saipher-loading-state">
                        <div><strong>Live data has not been loaded.</strong><p>Select Refresh Live Data to retrieve published records.</p></div>
                        <button className="outline-button" type="button" onClick={() => refreshLiveData()}>Load Live Data</button>
                    </div>}
                    {liveReport && <>
                        <section className="prep-section" id="dp-live-profiling">
                            <div className="section-heading"><div><span className="section-kicker">01</span><h2>Dataset Overview</h2>
                                <p>Published transaction files and sales coverage, calculated from live Supabase records.</p></div></div>
                            <div className="profile-grid">
                                {[
                                    ["Files Imported", liveReport.profile.filesImported, FaDatabase],
                                    ["Transaction Lines", liveReport.profile.transactionLines, FaClipboardCheck],
                                    ["Unique Orders", liveReport.profile.uniqueOrders, FaCheckCircle],
                                    ["Data Coverage", liveReport.profile.coverage, FaCalendarAlt],
                                    ["Product Listings", liveReport.profile.productListings, FaBoxOpen],
                                    ["Geographic Coverage", `${liveReport.profile.regions} Regions / ${liveReport.profile.provinces} Provinces`, FaMapMarkedAlt]
                                ].map(([label, value, Icon]) => <div className="profile-card" key={label}>
                                    <Icon /><span>{label}</span><strong className={typeof value === 'string' ? 'compact-value' : ''}>{typeof value === 'number' ? formatNumber(value) : value}</strong>
                                </div>)}
                            </div>
                            <div className="saipher-live-meta">Last completed ETL record: {liveReport.lastPublishedAt ? new Date(liveReport.lastPublishedAt).toLocaleString() : 'Not available'} · Supabase is the live analytics source.</div>
                        </section>
                        <section className="prep-section" id="dp-live-quality">
                            <div className="section-heading"><div><span className="section-kicker">02</span><h2>Data Quality Checks</h2><p>Read-only checks of the published records.</p></div></div>
                            <div className="quality-card">
                                <QualityRow icon={FaCalendarAlt} title="Date Fields" description={`${formatNumber(liveReport.quality.invalidDateRecords)} published record(s) have missing or invalid creation dates.`}
                                    status={liveReport.quality.invalidDateRecords ? "Review Needed" : "Passed"} action="View" onAction={() => setModal('live-dates')} />
                                <QualityRow icon={FaCheckCircle} title="Exact Duplicates" description={`${formatNumber(liveReport.quality.duplicateRows)} duplicate rows marked in published data. The original ETL removes exact duplicates.`}
                                    status="Informational" action="View" onAction={() => setModal('live-duplicates')} />
                                <QualityRow icon={FaClipboardCheck} title="Order Status" description={`${formatNumber(liveReport.quality.nonCompletedOrders)} non-Completed orders in published data.`}
                                    status="Informational" action="View" onAction={() => setModal('live-statuses')} />
                                <QualityRow icon={FaBoxOpen} title="Returns / Refunds" description={`${formatNumber(liveReport.quality.returnRefundOrders)} orders carry return/refund status.`}
                                    status="Informational" action="View" onAction={() => setModal('live-returns')} />
                                <QualityRow icon={FaCalculator} title="Numeric Fields" description={`${formatNumber(liveReport.quality.invalidNumericRecords)} rows have missing/non-numeric prepared measures.`}
                                    status={liveReport.quality.invalidNumericRecords ? "Review Needed" : "Passed"} />
                            </div>
                            <p className="saipher-live-meta">Source-file validation details that were not persisted in Supabase cannot be reconstructed from published rows.</p>
                        </section>
                        <section className="prep-section" id="dp-live-standardization">
                            <div className="section-heading"><div><span className="section-kicker">03</span><h2>Data Standardization</h2><p>Published classifications, geography and time fields. Editing is disabled.</p></div></div>
                            <div className="transform-grid">
                                <div className="transform-card">
                                    <div className="transform-card-header"><div className="transform-icon"><FaMapMarkedAlt /></div><div><h3>Geographic Standardization</h3><p>Stored region/province mappings in the published data.</p></div></div>
                                    <div className="geo-stats">
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.geography.length)}</strong><span>Values detected</span></div>
                                        <div className="geo-stat ok"><strong>{formatNumber(liveReport.geography.filter(item => item.status === 'Mapped').length)}</strong><span>Mapped</span></div>
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.geography.filter(item => item.status !== 'Mapped').length)}</strong><span>Unclassified</span></div>
                                    </div>
                                    <button className="outline-button full geo-review-btn" onClick={() => setModal('live-geography')}>View Geographic Standardization</button>
                                </div>
                                <div className="transform-card product-transform">
                                    <div className="transform-card-header"><div className="transform-icon"><FaBoxOpen /></div><div><h3>Product Categorization</h3><p>Currently published product classifications.</p></div></div>
                                    <div className="geo-stats">
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.products.length)}</strong><span>Values detected</span></div>
                                        <div className="geo-stat ok"><strong>{formatNumber(liveReport.products.filter(item => item.status === 'Mapped').length)}</strong><span>Mapped</span></div>
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.products.filter(item => item.status !== 'Mapped').length)}</strong><span>Others / Unclassified</span></div>
                                    </div>
                                    <button className="outline-button full geo-review-btn" onClick={() => setModal('live-products')}>View Product Categorization</button>
                                </div>
                                <div className="transform-card">
                                    <div className="transform-card-header"><div className="transform-icon"><FaClock /></div><div><h3>Order Date Standardization</h3><p>Published monthly periods and missing-date count.</p></div></div>
                                    <div className="geo-stats">
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.time.preparedRecords)}</strong><span>Valid dates</span></div>
                                        <div className="geo-stat ok"><strong>{formatNumber(liveReport.time.periods.length)}</strong><span>Detected months</span></div>
                                        <div className="geo-stat"><strong>{formatNumber(liveReport.time.needsReview)}</strong><span>Invalid dates</span></div>
                                    </div>
                                    <button className="outline-button full geo-review-btn" onClick={() => setModal('live-periods')}>View Date Standardization</button>
                                </div>
                            </div>
                        </section>
                        <section className="prep-section validation-section" id="dp-live-validation">
                            <div className="section-heading"><div><span className="section-kicker">04</span><h2>Readiness Verification</h2><p>Published dataset status for the analytics modules.</p></div></div>
                            <div className="validation-layout">
                                <div className="validation-checklist">
                                    {[
                                        ["Supabase master transactions available", liveReport.records > 0],
                                        ["Published geographic assignments available", liveReport.geography.length > 0],
                                        ["Published product assignments available", liveReport.products.length > 0],
                                        ["Published monthly time fields available", liveReport.time.periods.length > 0],
                                        ["Prepared revenue and quantities available", liveReport.quality.invalidNumericRecords === 0]
                                    ].map(([label, ok]) => <div key={label} className={ok ? 'validation-item complete' : 'validation-item'}>
                                        <FaCheckCircle /><span>{label}</span></div>)}
                                </div>
                                <div className="ready-card"><div className="ready-icon"><FaLock /></div><div>
                                    <span className="ready-kicker">LIVE DATASET STATUS</span>
                                    <h3>{liveReport.records > 0 ? 'PUBLISHED — READ ONLY' : 'NO PUBLISHED TRANSACTIONS'}</h3>
                                    <p>{formatNumber(liveReport.quality.includedRows)} included and {formatNumber(liveReport.quality.excludedRows)} excluded from analytics. Changes must be prepared locally and published explicitly.</p>
                                </div></div>
                            </div>
                        </section>
                    </>}
                </div>
            )}

            {modal?.startsWith('live-') && liveReport && (() => {
                const type = modal.slice(5);
                const sources = {
                    products: liveReport.products,
                    geography: liveReport.geography,
                    statuses: liveReport.statusReview,
                    returns: liveReport.returnReview,
                    duplicates: liveReport.duplicateReview,
                    periods: liveReport.time.periods,
                    dates: []
                };
                const records = sources[type] || [];
                const search = liveProductSearch.toLowerCase().trim();
                const filtered = search ? records.filter(item => JSON.stringify(item).toLowerCase().includes(search)) : records;
                return <Modal title={`Published ${type.charAt(0).toUpperCase() + type.slice(1)}`}
                    subtitle="Read-only values retrieved from live Supabase. No local changes are applied here."
                    onClose={() => { setModal(null); setLiveProductSearch(''); }}>
                    {type === 'dates' ? <p>Missing or invalid date records: {formatNumber(liveReport.quality.invalidDateRecords)}. Individual invalid-date source rows are not included in this summary.</p> : <>
                        <input className="saipher-live-search" aria-label="Search published records" value={liveProductSearch}
                            onChange={event => setLiveProductSearch(event.target.value)} placeholder="Search published records..." />
                        <p>{formatNumber(filtered.length)} of {formatNumber(records.length)} entries</p>
                        <div className="saipher-live-scroll">
                            {filtered.map((item, index) => <div key={index} className="saipher-live-row">
                                {typeof item === 'string' ? item : Object.entries(item).filter(([,value]) => value != null && value !== '').map(([key,value]) =>
                                    <span key={key}><strong>{key.replace(/([A-Z])/g,' $1')}:</strong> {String(value)}</span>)}
                            </div>)}
                            {!filtered.length && <p>No matching records.</p>}
                        </div>
                    </>}
                    <div className="modal-actions"><button className="outline-button" onClick={() => { setModal(null); setLiveProductSearch(''); }}>Close</button></div>
                </Modal>;
            })()}

            {modal === "summary" && (
                <Modal title="Preparation Summary" subtitle={preparationState?.readOnlySnapshot ? "Synchronized local snapshot; the published rows do not support a Data Preparation rerun." : "Current locally prepared dataset; not necessarily live in Supabase."} onClose={() => setModal(null)}>
                    <div className="saipher-modal-list">
                        <p><strong>{preparationState?.readOnlySnapshot ? "Synchronized records" : "Prepared records"}:</strong> {formatNumber(preparedSummary?.records)}</p>
                        <p><strong>Included in analytics:</strong> {formatNumber(preparedSummary?.includedRecords)}</p>
                        <p><strong>Excluded from analytics:</strong> {formatNumber(preparedSummary?.excludedRecords)}</p>
                        <p><strong>Others / Unclassified products:</strong> {formatNumber(fallbackCount)} (valid fallback)</p>
                        <p><strong>Automatically handled exact duplicates:</strong> {formatNumber(quality.duplicateRows)}</p>
                        <p><strong>Preparation:</strong> {preparationState?.readOnlySnapshot ? "Unavailable from published rows" : preparationState?.prepared ? "Current" : "Required"}</p>
                        <p><strong>Publishing readiness:</strong> {readyToPublish ? "Ready" : "Not ready"}</p>
                        <p><strong>Last prepared:</strong> {preparedSummary?.generatedAt ? new Date(preparedSummary.generatedAt).toLocaleString() : "Not available"}</p>
                    </div>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
                </Modal>
            )}
            {modal === "confirm-sync-supabase" && (
                <Modal title="Sync Live Data to Staging" subtitle="The current local staging dataset will be replaced after validation." onClose={() => !syncingFromSupabase && setModal(null)}>
                    <div className="modal-summary warning-summary">
                        <FaExclamationTriangle aria-hidden="true" />
                        <span>This copies the currently published transactions and mappings from Supabase into the existing local prepared-data file and preparation state. Supabase will only be read. The previous local prepared dataset will be replaced after every page and required field has been validated. Existing imported Shopee workbooks remain available in Data Management. Published data may not include all source fields required to rerun preparation, so the synchronized staging copy supports local category edits, but a full Data Preparation rerun still requires original workbooks.</span>
                    </div>
                    <div className="modal-actions">
                        <button className="outline-button" type="button" onClick={() => setModal(null)} disabled={syncingFromSupabase}>Cancel</button>
                        <button className="primary-button" type="button" onClick={syncSupabaseStaging} disabled={syncingFromSupabase || running || pushing}>
                            {syncingFromSupabase ? <FaSyncAlt className="saipher-spin" /> : <FaCloud />} {syncingFromSupabase ? "Syncing..." : "Replace Local Staging"}
                        </button>
                    </div>
                </Modal>
            )}
            {modal === "confirm-preparation" && (
                <Modal
                    title="Confirm Data Preparation"
                    subtitle="Review this action before the preparation process starts."
                    onClose={() => setModal(null)}
                >
                    <div className="modal-summary info-summary">
                        <FaDatabase aria-hidden="true" />
                        This generates the local prepared dataset using current mappings. Live Supabase analytics will not change until publication.
                    </div>
                    <div className="modal-actions">
                        <button className="outline-button" type="button" onClick={() => setModal(null)}>Cancel</button>
                        <button className="primary-button" type="button" onClick={() => { setModal(null); runPreparation(); }}>
                            <FaPlay /> Confirm &amp; Run
                        </button>
                    </div>
                </Modal>
            )}

            {modal === "confirm-upload" && (
                <Modal
                    title="Publish Prepared Data to Supabase?"
                    subtitle="This uploads only the last successfully prepared dataset."
                    onClose={() => !pushing && setModal(null)}
                >
                    <div className="modal-summary warning-summary">
                        <FaExclamationTriangle aria-hidden="true" />
                        The backend stages this preparation and publishes only after an atomic database commit. The required SQL migration must be applied first. Current run: {preparationState?.runId || "Unknown"}; records: {formatNumber(preparedSummary?.records)}.
                    </div>
                    <div className="modal-actions">
                        <button className="outline-button" type="button" onClick={() => setModal(null)} disabled={pushing}>Cancel</button>
                        <button className="primary-button" type="button" onClick={pushPreparedData} disabled={pushing || running || syncing}>
                            <FaDatabase /> {pushing ? "Publishing..." : "Confirm Publish"}
                        </button>
                    </div>
                </Modal>
            )}

            {modal === "duplicates" && (
                <Modal
                    title="Review Exact Duplicates"
                    subtitle="Exact duplicate rows were detected across the imported files. Repeated Order IDs are not treated as duplicates."
                    onClose={() => setModal(null)}
                    wide
                >
                    {duplicates.length === 0 ? (
                        <div className="empty-state">No exact duplicate rows detected.</div>
                    ) : (
                        <>
                            <div className="modal-summary warning-summary">
                                <FaExclamationTriangle /> {quality.duplicateRows} exact duplicate rows will be excluded from the prepared Master Data.
                            </div>
                            <div className="table-wrap">
                                <table className="prep-table">
                                    <thead><tr><th>Source Row</th><th>Order ID</th><th>Product Name</th><th>Date</th><th>Qty</th></tr></thead>
                                    <tbody>
                                        {duplicates.map((row, index) => (
                                            <tr key={`${row.row}-${index}`}>
                                                <td>{row.row}</td><td>{row.orderId || "—"}</td><td>{row.productName || "—"}</td><td>{row.date || "—"}</td><td>{row.quantity ?? "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="modal-actions"><button className="primary-button" onClick={() => { setDuplicateReviewed(true); setModal(null); }}>Acknowledge &amp; Keep Excluded</button></div>
                        </>
                    )}
                </Modal>
            )}

            {modal === "status" && (
                <Modal
                    title="Review Order Status"
                    subtitle="The core analytical dataset uses Completed orders. Other statuses remain traceable in the raw imported data."
                    onClose={() => setModal(null)}
                    wide
                >
                    <div className="modal-summary warning-summary"><FaExclamationTriangle /> {quality.nonCompletedOrders || 0} affected orders are excluded from the core analytical dataset.</div>
                    <div className="table-wrap">
                        <table className="prep-table">
                            <thead><tr><th>Order ID</th><th>Status</th><th>Products</th><th>Date</th></tr></thead>
                            <tbody>
                                {statusReview.map((row, index) => (
                                    <tr key={`${row.orderId}-${index}`}><td>{row.orderId}</td><td>{row.statuses?.join(", ") || "—"}</td><td>{row.products?.join(", ") || "—"}</td><td>{row.dates?.join(", ") || "—"}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="modal-actions"><button className="primary-button" onClick={() => { setStatusReviewed(true); setModal(null); }}>Acknowledge Review</button></div>
                </Modal>
            )}

            {modal === "returns" && (
                <Modal
                    title="Review Returns & Refunds"
                    subtitle="Return/refund information is preserved. Returned quantity is used to derive Net Quantity without deleting the original transaction quantity."
                    onClose={() => setModal(null)}
                    wide
                >
                    <div className="modal-summary info-summary"><FaUndo /> {quality.returnRefundOrders || 0} orders contain return/refund information.</div>
                    <div className="table-wrap">
                        <table className="prep-table">
                            <thead><tr><th>Order ID</th><th>Return / Refund Status</th><th>Product</th><th>Returned Qty</th></tr></thead>
                            <tbody>
                                {returnReview.map((row, index) => (
                                    <tr key={`${row.orderId}-${index}`}><td>{row.orderId}</td><td>{row.returnStatuses?.join(", ") || "—"}</td><td>{row.products?.join(", ") || "—"}</td><td>{row.returnedQuantity || 0}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="modal-actions"><button className="primary-button" onClick={() => { setReturnsReviewed(true); setModal(null); }}>Acknowledge Review</button></div>
                </Modal>
            )}

            {modal === "geography-help" && (
                <Modal
                    title="Geographic Mapping Guide"
                    eyebrow="DATA STANDARDIZATION GUIDE"
                    subtitle="How location fields from imported transactions are organized for analytics."
                    onClose={() => setModal(null)}
                    wide
                    variant="prep-modal-guide"
                >
                    <div className="geo-help-flow">
                        <div><span>Source Province</span><b aria-hidden="true">→</b><strong>Region</strong></div>
                        <div><span>Source City</span><b aria-hidden="true">→</b><strong>Province</strong></div>
                    </div>
                    <div className="modal-summary info-summary">
                        <FaMapMarkedAlt aria-hidden="true" />
                        Imported province and city values are standardized into the Region → Province hierarchy used in geographic reporting and analysis.
                    </div>
                                    <h4>What the numbers show</h4>
                    <p><strong>Values detected</strong> counts distinct source province and city combinations. <strong>Mapped</strong> counts combinations where both source fields are present and assigned to region and province levels. <strong>Unmapped / needs review</strong> counts entries missing a source province or city; those are held as Unclassified.</p>
                    <h4>Why it matters and what review does</h4>
                    <p>Consistent locations let reports and forecasts group orders under region and province. The source province field supplies the region and the source city field supplies the province. For example, when the city field contains Aurora, the system assigns the region North Luzon. Use the <strong>All</strong>, <strong>Mapped</strong>, and <strong>Needs review</strong> buttons to filter entries. This screen is read-only and has no correction controls; location assignments follow system rules and appear after data preparation is run again when source data or those rules change.</p>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
</Modal>
            )}

            {modal === "geography" && (
                <Modal
                    title="Review Geographic Mapping"
                    subtitle="Overview of the geographic values detected and mapped by the system. Hierarchy: Source Province → Region, Source City → Province."
                    onClose={() => setModal(null)}
                    wide
                >
                    <div className="geo-stats">
                        <div className="geo-stat"><strong>{geoMappings.length}</strong><span>Values detected</span></div>
                        <div className="geo-stat ok"><strong>{geoSummary.mapped.length}</strong><span>Mapped</span></div>
                        <div className={`geo-stat ${geoSummary.review.length ? "warn" : ""}`}>
                            <strong>{geoSummary.review.length}</strong><span>Unmapped / needs review</span>
                        </div>
                    </div>

                    {geoSummary.review.length > 0 ? (
                        <div className="modal-summary warning-summary">
                            <FaExclamationTriangle /> {geoSummary.review.length} value(s) have a missing source province or city and are held as “Unclassified”.
                        </div>
                    ) : (
                        <div className="modal-summary info-summary">
                            <FaCheckCircle /> All detected geographic values are mapped.
                        </div>
                    )}

                    <div className="geo-filter">

                        {[["all", "All"], ["mapped", "Mapped"], ["review", "Needs review"]].map(([key, label]) => (
                            <button
                                key={key}
                                className={`outline-button tiny ${geoFilter === key ? "active" : ""}`}
                                onClick={() => setGeoFilter(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="table-wrap geo-table-wrap">
                        <table className="prep-table">
                            <thead>
                                <tr>
                                    <th>Source Province</th>
                                    <th>Source City</th>
                                    <th>Mapped Region</th>
                                    <th>Mapped Province</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleGeoRows.length === 0 && (
                                    <tr><td colSpan="5">No values in this view.</td></tr>
                                )}
                                {visibleGeoRows.map(row => (
                                    <tr key={`${row.rawProvince}|${row.rawCity}`}>
                                        <td>{row.rawProvince || "—"}</td>
                                        <td>{row.rawCity || "—"}</td>
                                        <td><strong>{row.region}</strong></td>
                                        <td><strong>{row.province}</strong></td>
                                        <td>
                                            <span className={`mini-badge ${row.status === "Mapped" ? "geo-ok" : "geo-warn"}`}>
                                                {row.status === "Mapped" ? "Mapped" : "Needs review"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mapping-rule-note">Known Aurora regional inconsistency is standardized to North Luzon.</div>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
                </Modal>
            )}

            {modal === "time-help" && (
                <Modal
                    title="Time Fields Guide"
                    eyebrow="DATA STANDARDIZATION GUIDE"
                    subtitle="Source date, standardized format, and generated calendar fields."
                    onClose={() => setModal(null)}
                    wide
                    variant="prep-modal-guide"
                >
                    <div className="time-help-content">
                        <div className="time-help-source">
                            <span>Source</span>
                            <strong>Order Creation Date</strong>
                        </div>
                        <div className="time-help-source">
                            <span>Standardized format</span>
                            <strong>YYYY-MM-DD</strong>
                        </div>
                        <h4>Generated fields</h4>
                        <div className="time-help-fields">
                            {["Year", "Month", "Month Number", "Year-Month", "Quarter"].map(field => <span key={field}>{field}</span>)}
                        </div>
                    </div>
                                    <h4>What the numbers show</h4>
                    <p><strong>Records with time fields</strong> counts prepared records that have a valid date and generated calendar fields. <strong>Detected months mapped</strong> counts distinct year-month periods. <strong>Missing / invalid dates</strong> counts source records whose Order Creation Date is blank or unreadable.</p>
                    <h4>Why it matters</h4>
                    <p>Consistent calendar months make comparisons and forecasts line up. For example, an order dated <strong>2025-03-18</strong> belongs to <strong>March 2025</strong> and the first quarter. An order without a usable date gets no generated time fields and cannot be assigned to a reporting month.</p>
                    <p><strong>Review Date Standardization</strong> shows generated calendar fields, each detected month with its prepared-record count, and the number of missing or invalid dates. It is read-only; date handling follows existing preparation rules.</p>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
</Modal>
            )}

            {modal === "time" && (
                <Modal
                    title="Review Time Mapping"
                    subtitle="Order Creation Date is standardized and mapped to calendar fields for every valid prepared record."
                    onClose={() => setModal(null)}
                    wide
                >
                    <div className="geo-stats">
                        <div className="geo-stat ok">
                            <strong>{formatNumber(timeSummary.preparedRecords)}</strong>
                            <span>Prepared records with time fields</span>
                        </div>
                        <div className="geo-stat ok">
                            <strong>{formatNumber(timeSummary.periods.length)}</strong>
                            <span>Detected months mapped</span>
                        </div>
                        <div className={`geo-stat ${invalidDateRecords ? "warn" : "ok"}`}>
                            <strong>{formatNumber(invalidDateRecords)}</strong>
                            <span>Source records needing date review</span>
                        </div>
                    </div>

                    {invalidDateRecords > 0 ? (
                        <div className="modal-summary warning-summary">
                            <FaExclamationTriangle /> {formatNumber(invalidDateRecords)} source record(s) have a missing or invalid Order Creation Date. They cannot be assigned generated time fields.
                        </div>
                    ) : (
                        <div className="modal-summary info-summary">
                            <FaCheckCircle /> All source records with dates were standardized successfully.
                        </div>
                    )}

                    <h4 className="time-modal-heading">Generated field mapping</h4>
                    <div className="table-wrap">
                        <table className="prep-table">
                            <thead><tr><th>Source</th><th>Generated Field</th><th>Format</th><th>Example</th></tr></thead>
                            <tbody>{timeFields.map(field => <tr key={field.field}><td>{field.source}</td><td>{field.field}</td><td>{field.format}</td><td>{field.example}</td></tr>)}</tbody>
                        </table>
                    </div>

                    <h4 className="time-modal-heading">Detected months already mapped</h4>
                    <div className="table-wrap geo-table-wrap">
                        <table className="prep-table">
                            <thead>
                                <tr><th>Year-Month</th><th>Month</th><th>Quarter</th><th>Prepared Records</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                {timeSummary.periods.length === 0 && (
                                    <tr><td colSpan="5">No valid dated records are available.</td></tr>
                                )}
                                {timeSummary.periods.map(period => (
                                    <tr key={period.yearMonth}>
                                        <td>{period.yearMonth}</td>
                                        <td>{period.monthName}</td>
                                        <td>{period.quarter}</td>
                                        <td>{formatNumber(period.records)}</td>
                                        <td><span className="mini-badge geo-ok">Mapped</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
                </Modal>
            )}

            {modal === "product-help" && (
                <Modal
                    title="Product Mapping Guide"
                    eyebrow="DATA STANDARDIZATION GUIDE"
                    subtitle="How raw Shopee product listings are organized for category analysis."
                    onClose={() => setModal(null)}
                    wide
                    variant="prep-modal-guide"
                >
                    <div className="product-help-hierarchy">
                        <div><span>Raw Product Name</span><b aria-hidden="true">→</b><strong>Category</strong></div>
                    </div>
                    <div className="modal-summary info-summary">
                        <FaBoxOpen aria-hidden="true" />
                        Preserve the original Product Name. Uncertain listings can remain <strong>Other / Unclassified</strong>.
                    </div>
                                    <p>Categories group similar listings so users can compare sales by product type. The system uses its existing product-name rules and any saved per-product choice. For example, a recognized tape listing can be grouped under “Tape / Adhesive.” Names it cannot classify are placed in the reserved <strong>Other / Unclassified</strong> category.</p>
                    <h4>What the numbers show</h4>
                    <p><strong>Values detected</strong> counts distinct product listings. <strong>Mapped</strong> counts listings assigned a regular category. <strong>Unmapped / needs review</strong> counts listings still in Other / Unclassified. These listings remain in source records but lack a specific category for category analysis.</p>
                    <h4>Review and make a correction</h4>
                    <p>In <strong>Review Product Categorization</strong>, choose All, Mapped, or Needs review, search names, and browse pages. Select <strong>Review / Edit</strong>, choose a category, then choose <strong>Save Mapping</strong>. This saves the choice locally for that product name and applies to matching names in future preparation, including future imports. Run Data Preparation to rebuild the prepared data; publish separately to update live analytics.</p>
                    <p><strong>Manage Product Mapping</strong> lets you add categories, rename editable categories, and delete categories that have no assigned products. Renaming also updates saved product choices. A category in use cannot be deleted, and Other / Unclassified cannot be renamed or deleted. A saved change marks the existing prepared result as needing preparation again; live analytics remain as published until the new result is published.</p>
                    <div className="modal-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button></div>
</Modal>
            )}

            {modal === "products" && (
                <Modal
                    title="Review Product Mapping"
                    subtitle="Map each raw Shopee Product Name to Category. Uncertain listings may remain Other / Unclassified."
                    headerAction={<button type="button" className="outline-button category-manage-trigger" onClick={openCategoryManager} >Manage Product Mapping</button>}
                    onClose={() => { setModal(null); setEditedProduct(null); setShowCategoryManager(false); }}
                    wide
                >
                    <div className="geo-stats">
                        <div className="geo-stat"><strong>{formatNumber(products.length)}</strong><span>Values detected</span></div>
                        <div className="geo-stat ok"><strong>{formatNumber(productSummary.mapped.length)}</strong><span>Mapped</span></div>
                        <div className={`geo-stat ${productSummary.review.length ? "warn" : ""}`}>
                            <strong>{formatNumber(productSummary.review.length)}</strong><span>Unmapped / needs review</span>
                        </div>
                    </div>

                    {productSummary.review.length > 0 ? (
                        <div className="modal-summary warning-summary">
                            <FaExclamationTriangle /> {formatNumber(productSummary.review.length)} product listing(s) need category review.
                        </div>
                    ) : (
                        <div className="modal-summary info-summary">
                            <FaCheckCircle /> All detected product listings are mapped.
                        </div>
                    )}

                    <div className="geo-filter">
                         <InfoHint label="Product list filters">All shows every listing; Mapped shows assigned categories; Needs review shows listings still in Other / Unclassified.</InfoHint>
                       {[["all", "All"], ["mapped", "Mapped"], ["review", "Needs review"]].map(([key, label]) => (
                            <button
                                key={key}
                                className={`outline-button tiny ${productFilter === key ? "active" : ""}`}
                                onClick={() => setProductFilter(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="product-modal-toolbar">
                        <div className="search-box">
                            <FaSearch />
                            <input value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Search raw product names..." />
                        </div>
                        <span>{formatNumber(filteredProducts.length)} matching listings</span>
                    </div>

                    <div className="table-wrap">
                        <table className="prep-table product-table">
                            <thead><tr><th>Raw Product Name (Source)</th><th>Category</th><th>Status</th><th></th></tr></thead>
                            <tbody>
                                {visibleProducts.length === 0 && (
                                    <tr><td colSpan="4">No product listings in this view.</td></tr>
                                )}
                                {visibleProducts.map((product, index) => (
                                    <tr key={`${product.rawProductName}-${index}`}>
                                        <td className="raw-product-cell">{product.rawProductName || "Other / Unclassified"}</td>
                                        <td>{product.category}</td>
                                        
                                        <td><span className={`status-badge ${product.status === "Mapped" ? "passed" : "review"}`}>{product.status}</span></td>
                                <td><button className="outline-button tiny" title="Choose a category for this product listing" onClick={() => setEditedProduct({ ...product })}>Review / Edit</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="pagination-row">
                            <span>Page {productPage} of {productPages}</span>
                        <div>
                            <button disabled={productPage === 1} onClick={() => setProductPage(page => Math.max(1, page - 1))}><FaChevronLeft /></button>
                            <button disabled={productPage === productPages} onClick={() => setProductPage(page => Math.min(productPages, page + 1))}><FaChevronRight /></button>
                        </div>
                    </div>

                </Modal>
            )}
            {modal === "products" && editedProduct && (
                <div className="mapping-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditedProduct(null); }}>
                    <section className="mapping-editor-lightbox" role="dialog" aria-modal="true" aria-label="Edit product category" onKeyDown={event => {
                        if (event.key === 'Escape') { event.stopPropagation(); setEditedProduct(null); }
                        if (event.key === 'Tab') {
                            const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
                            if (!elements.length) return;
                            const first = elements[0];
                            const last = elements[elements.length - 1];
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                        }
                    }}>
                        <div className="mapping-editor">
                            <div>
                                <span>Editing Raw Product Name</span>
                                <strong>{editedProduct.rawProductName}</strong>
                            </div>
                            <div className="editor-fields">
                                <label>
                                    <span className="editor-field-label">Category <InfoHint label="Choose a category">Select the category that best describes this product. Other / Unclassified leaves it flagged for review.</InfoHint></span>
                                    <select autoFocus value={editedProduct.category} onChange={event => setEditedProduct(current => ({ ...current, category: event.target.value }))}>
                                        {categoryOptions.map(category => <option key={category}>{category}</option>)}
                                    </select>
                                </label>
                            </div>
                            <div className="editor-actions">
                                <button className="outline-button" onClick={() => setEditedProduct(null)}>Cancel</button>
                                <button className="primary-button" title="Save this product category locally" onClick={saveProductMapping} >Save Mapping</button>
                            </div>
                        </div>
                    </section>
                </div>
            )}
            {modal === "products" && showCategoryManager && (
                <div className="category-manager-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !categoryBusy) setShowCategoryManager(false); }}>
                    <section className="category-manager-lightbox" role="dialog" aria-modal="true" aria-label="Manage Product Mapping" onKeyDown={event => {
                        if (event.key === 'Escape') { event.stopPropagation(); if (!categoryBusy) setShowCategoryManager(false); }
                        if (event.key === 'Tab') {
                            const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
                            if (!elements.length) return;
                            const first = elements[0];
                            const last = elements[elements.length - 1];
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                        }
                    }}>
                        <div className="category-manager-header">
                            <div><h3>Manage Product Mapping <InfoHint label="Manage product categories">Add categories for organizing products, rename editable categories, and delete categories with no assigned products. Changes are saved locally and take effect after Data Preparation runs.</InfoHint></h3><p>Add, rename, or delete primary product categories.</p></div>
                            <button type="button" className="icon-button" aria-label="Close category manager" onClick={() => setShowCategoryManager(false)}><FaTimes /></button>
                        </div>
                        <div className="category-manager-body">
                            <div className="category-manager-toolbar">
                                <div className="category-manager-title">CATEGORIES <span>{categoryRows.length}</span><InfoHint label="Category count">The number of available categories. Each category card shows how many distinct product listings currently use it.</InfoHint></div>
                                <InfoHint label="Add a category">Creates a new category label that can be selected when assigning a product.</InfoHint>
                                <button type="button" title="Add a product category" className="outline-button category-add-trigger" disabled={categoryBusy} onClick={() => { setCategoryAdding(value => !value); setCategoryEditing(null); setCategoryError(''); setCategoryDraft(''); }}><FaPlus /> Add</button>
                            </div>
                            {categoryError && <p className="category-manager-error" role="alert">{categoryError}</p>}
                            {categoryAdding && <form className="category-manager-form" onSubmit={event => { event.preventDefault(); changeCategory('POST', { name: categoryDraft }); }}>
                                <label>New category name <InfoHint label="New category name">Enter a clear label, such as “Gift Packaging.” The name is available for product assignments after it is saved.</InfoHint><input autoFocus maxLength={100} value={categoryDraft} onChange={event => setCategoryDraft(event.target.value)} placeholder="Category name" /></label>
                                <button type="submit" title="Save category changes" className="primary-button" disabled={categoryBusy}>Save</button>
                                <button type="button" title="Discard the new category entry" className="outline-button" onClick={() => setCategoryAdding(false)}>Cancel</button>
                            </form>}
                            <div className="category-manager-grid">
                                {pagedCategories.map(row => <div className="category-manager-card" key={row.name}>
                                    {categoryEditing === row.name ? <form className="category-manager-rename" onSubmit={event => { event.preventDefault(); changeCategory('PATCH', { oldName: row.name, newName: categoryDraft }); }}>
                                        <input autoFocus maxLength={100} title="Enter the replacement category name" aria-label={`Rename ${row.name}`} value={categoryDraft} onChange={event => setCategoryDraft(event.target.value)} />
                                        <button type="submit" title="Save category changes" className="primary-button" disabled={categoryBusy}>Save</button>
                                        <button type="button" title="Keep the current category name" className="outline-button" onClick={() => setCategoryEditing(null)}>Cancel</button>
                                    </form> : <>
                                        <div className="category-manager-card-info"><strong>{row.name}</strong><small>{row.productCount} distinct product{row.productCount === 1 ? '' : 's'}</small></div>
                                        {!row.reserved && <div className="category-manager-card-actions">
                                            <InfoHint label={`Rename or delete ${row.name}`}>Rename changes the category label and updates saved product choices. Delete is available only when no products are assigned.</InfoHint>
                                            <button type="button" className="outline-button" title={`Rename ${row.name}`} aria-label={`Rename ${row.name}`} disabled={categoryBusy} onClick={() => { setCategoryEditing(row.name); setCategoryDraft(row.name); setCategoryAdding(false); setCategoryError(''); }}><FaPen /></button>
                                            <button type="button" className="outline-button" title={`Delete ${row.name} if no products use it`} aria-label={`Delete ${row.name}`} disabled={categoryBusy} onClick={() => { setCategoryDelete(row); setCategoryError(''); }}><FaTrash /></button>
                                        </div>}
                                    </>}
                                </div>)}
                            </div>
                            {categoryDelete && <div className="category-manager-confirm" role="alertdialog" aria-label="Delete category confirmation">
                                <p>{categoryDelete.productCount > 0 ? `This category is currently assigned to ${categoryDelete.productCount} products. Reassign these products to another category before deleting it.` : `Delete “${categoryDelete.name}”?`}</p>
                                <div className="category-manager-confirm-buttons">
                                    {categoryDelete.productCount === 0 && <button type="button" className="primary-button" disabled={categoryBusy} onClick={() => changeCategory('DELETE', { name: categoryDelete.name })}>Delete</button>}
                                    <button type="button" className="outline-button" onClick={() => setCategoryDelete(null)}>Cancel</button>
                                </div>
                            </div>}
                            {categoryTotalPages > 1 && <div className="category-manager-pagination">
                                <span>Page {categoryCurrentPage} of {categoryTotalPages} · 10 categories per page</span>
                                <div><button type="button" aria-label="Previous category page" disabled={categoryCurrentPage === 1} onClick={() => setCategoryPage(value => Math.max(1, value - 1))}><FaChevronLeft /></button>
                                <button type="button" aria-label="Next category page" disabled={categoryCurrentPage === categoryTotalPages} onClick={() => setCategoryPage(value => Math.min(categoryTotalPages, value + 1))}><FaChevronRight /></button></div>
                            </div>}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
