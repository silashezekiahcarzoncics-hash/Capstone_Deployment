import { geographicScopeLabel, scopedGeography, scopeCategoryOptions } from "../utils/geographicScope";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
    FaMoneyBillWave,
    FaShoppingCart,
    FaCubes,
    FaChartLine,
    FaChartBar,
    FaLightbulb,
    FaArrowUp,
    FaArrowDown,
    FaChevronDown,
    FaChevronUp,
    FaMapMarkerAlt,
    FaTrophy
} from "react-icons/fa";
import CategoryMultiSelect from "../components/CategoryMultiSelect";
import DescriptivePerformanceControls from "../components/DescriptivePerformanceControls";
import ProvinceCategoryHeatmap from "../components/ProvinceCategoryHeatmap";
import { categorySeriesColor } from "../utils/categorySeriesColor";
import { buildProvinceTrendSeries, provinceComparisonKey } from "../utils/provinceComparison";
import { buildProvinceCategoryHeatmap, provinceCategorySelectionFilters } from "../utils/provinceCategoryHeatmap";

import "../styles/analytics-redesign.css";
import "../styles/descriptive-chart.css";
import "../styles/descriptive-visuals.css";
import { DEFAULT_SCOPE, useAnalytics, money, monthLabel } from "../hooks/useAnalytics";

// Descriptive-only comparison. Does not change forecast training or plotted data.
const PERIOD_LABELS = {
    closure: "Shop Closure",
    no_sales: "No Sales Recorded",
    data_gap: "Data Gap",
    anomaly: "Anomaly"
};

function periodDetails(row) {
    const kinds = (row?.adjustmentKinds || []).filter(kind => PERIOD_LABELS[kind]);
    const labels = [...new Set(kinds)].map(kind => PERIOD_LABELS[kind]);
    const reason = row?.adjustmentReason?.trim();
    const heading = labels.length ? labels.join(" / ") : row?.adjusted ? "Flagged Period" : "";
    const description = heading
        ? `${heading}${reason ? ` — ${reason}` : ""}. Recorded sales totals are unchanged. ${kinds.includes("data_gap") ? "Data gaps are unknown demand and make affected forecasts unavailable." : "This marker can affect model training when configured."}`
        : "";
    return { heading, description, hasDataGap: kinds.includes("data_gap") };
}

function previousCalendarMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return date.toISOString().slice(0, 7);
}

export function descriptiveMonthOverMonth(trend = [], key = "revenue") {
    const latest = [...trend].reverse().find(item => !item.partial);
    const previous = trend.find(item => item.name === previousCalendarMonth(latest?.name));
    const latestValue = Number(latest?.[key]) || 0;
    const previousValue = Number(previous?.[key]) || 0;
    const latestDetails = periodDetails(latest);
    const previousDetails = periodDetails(previous);
    let warning = "";

    if (!latest) warning = "No complete month is available for comparison.";
    else if (!previous) warning = "The immediately preceding calendar month is unavailable; no months have been skipped.";
    else if (previous.partial) warning = `${monthLabel(previous.name)} is incomplete, so the comparison is unavailable.`;
    else if (latestDetails.hasDataGap || previousDetails.hasDataGap) warning = "A recorded data gap affects one of these months; the comparison is not reliable.";
    else if (previousValue === 0) warning = "The previous month's value is zero; a percentage change cannot be calculated.";

    return {
        latestMonth: latest?.name ?? null,
        previousMonth: previous?.name ?? null,
        latest: latestValue,
        change: !warning ? (latestValue - previousValue) / previousValue * 100 : null,
        warning,
        context: [previous, latest].filter(Boolean).map(item => periodDetails(item).description).filter(Boolean),
        partialMonths: trend.filter(item => item.partial).map(item => item.name)
    };
}

function DescriptiveFilterPanel({
    categories,
    provinces,
    compareBy,
    appliedCompareBy,
    selectedCategories,
    province,
    selectedProvinces,
    appliedCategories,
    appliedProvince,
    appliedProvinceKey,
    appliedProvinces,
    loading,
    onCategoriesChange,
    onCompareByChange,
    onProvinceChange,
    onProvincesChange,
    onApply,
    onReset
}) {
    const hasPendingChanges = compareBy !== appliedCompareBy
        || JSON.stringify([...selectedCategories].sort()) !== JSON.stringify([...appliedCategories].sort())
        || province !== appliedProvince
        || JSON.stringify([...selectedProvinces].sort()) !== JSON.stringify([...appliedProvinces].sort());
    const hasAppliedFilters = Boolean(appliedCategories.length || appliedProvince || appliedProvinceKey || appliedProvinces.length);
    const selectedProvinceLabel = appliedProvinceKey
        ? provinces.find(item => item.value === appliedProvinceKey)?.label || appliedProvince
        : appliedProvince;

    return (
        <section className="descriptive-filter-panel" aria-label="Descriptive analytics filters">
            <form onSubmit={event => { event.preventDefault(); onApply(); }}>
                <div className="descriptive-filter-fields">
                    <label className="rd-field">
                        <span>Compare By</span>
                        <select value={compareBy} onChange={event => onCompareByChange(event.target.value)}>
                            <option value="category">Product Category</option>
                            <option value="province">Province</option>
                        </select>
                    </label>
                    <CategoryMultiSelect categories={categories} selected={selectedCategories} onChange={onCategoriesChange} label="Product Category" />
                    {compareBy === "province" ? <CategoryMultiSelect
                        categories={provinces}
                        selected={selectedProvinces}
                        onChange={onProvincesChange}
                        label="Compare Provinces"
                        allLabel="All Provinces"
                    /> : <label className="rd-field">
                        <span>Province</span>
                        <select value={province} onChange={event => onProvinceChange(event.target.value)}>
                            <option value="">All Provinces</option>
                            {province && !provinces.some(item => item.name === province) && <option value={province}>{province}</option>}
                            {[...new Set(provinces.map(item => item.name))].map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </label>}
                    <div className="descriptive-filter-actions">
                        <button type="submit" className="descriptive-filter-apply" disabled={!hasPendingChanges || loading}>
                            {loading ? "Update Filters" : "Apply Filters"}
                        </button>
                        <button type="button" className="descriptive-filter-reset" onClick={onReset} disabled={!hasPendingChanges && !hasAppliedFilters}>
                            Reset Filters
                        </button>
                    </div>
                </div>
            </form>

            <div className="descriptive-filter-summary-row">
                <p className="descriptive-filter-summary" aria-live="polite">
                    Showing: <strong>{appliedCategories.length ? appliedCategories.join(", ") : "All Categories"}</strong><span aria-hidden="true"> · </span><strong>{appliedCompareBy === 'province' && appliedProvinces.length > 1 ? `${appliedProvinces.length} selected provinces` : selectedProvinceLabel || (appliedProvinces.length === 1 ? provinces.find(item => item.value === appliedProvinces[0])?.label : '') || "All Provinces"}</strong>
                </p>
            </div>
        </section>
    );
}

export default function DescriptiveAnalytics({
    scope = DEFAULT_SCOPE,
    sharedFilters = null,
    onSharedFiltersChange = () => {},
    active = true,
    metric: sharedMetric,
    onMetricChange = () => {},
    trendMode: sharedTrendMode,
    onTrendModeChange = () => {},
    previousYear: sharedPreviousYear,
    onPreviousYearChange = () => {},
    currentYear: sharedCurrentYear,
    onCurrentYearChange = () => {},
    onViewPredictive = () => {}
}) {
    const [draftCategories, setDraftCategories] = useState([]);
    const [draftProvince, setDraftProvince] = useState("");
    const [compareBy, setCompareBy] = useState("category");
    const [draftProvinces, setDraftProvinces] = useState([]);
    const [pendingFilters, setPendingFilters] = useState(null);
    const [localAppliedFilters, setLocalAppliedFilters] = useState({ compareBy: "category", categories: [], province: "", provinceKey: "", provinces: [] });
    const appliedFilters = sharedFilters || localAppliedFilters;
    const setAppliedFilters = next => { setLocalAppliedFilters(next); onSharedFiltersChange(next); };
    const [availableCategories, setAvailableCategories] = useState([]);
    const [availableProvinces, setAvailableProvinces] = useState([]);
    const { data: scopeData } = useAnalytics(scope, active);
    const { data: geographicBrowseData } = useAnalytics(scope, active, { categories: appliedFilters.categories });
    const requestedFilters = pendingFilters || appliedFilters;
    const descriptiveFilters = { categories: requestedFilters.categories,
        province: requestedFilters.compareBy === "province" ? "" : requestedFilters.province,
        provinceKeys: requestedFilters.compareBy === "province" ? requestedFilters.provinces : (requestedFilters.provinceKey ? [requestedFilters.provinceKey] : []) };
    const { data, error, loading, refresh } = useAnalytics(scope, active, descriptiveFilters, { keepPreviousOnError: true, keepPreviousData: true });
    const [localMetric, setLocalMetric] = useState("Revenue");
    const metric = sharedMetric ?? localMetric;
    const setMetric = sharedMetric == null ? setLocalMetric : onMetricChange;
    const [geoTab, setGeoTab] = useState("Top Provinces");
    const [geoMetric, setGeoMetric] = useState("revenue");
    const [performanceView, setPerformanceView] = useState("geography");
    const [heatmapSelectionSnapshot, setHeatmapSelectionSnapshot] = useState(null);
    const [focusCategoryAfterHeatmapSelection, setFocusCategoryAfterHeatmapSelection] = useState(false);
    const [showAllTopProvinces, setShowAllTopProvinces] = useState(false);
    const [expandedRegions, setExpandedRegions] = useState(() => new Set());
    const [showAllRegionProvinces, setShowAllRegionProvinces] = useState(() => new Set());
    const [localTrendMode, setLocalTrendMode] = useState("monthly");
    const [localPreviousYear, setLocalPreviousYear] = useState("");
    const [localCurrentYear, setLocalCurrentYear] = useState("");
    const trendMode = sharedTrendMode ?? localTrendMode;
    const setTrendMode = sharedTrendMode == null ? setLocalTrendMode : onTrendModeChange;
    const availableTrendYears = [...new Set((data?.trend || []).filter(hasYoYValue).map(item => item.name.slice(0, 4)))].sort();
    const sharedYearPairAvailable = availableTrendYears.includes(sharedPreviousYear)
        && availableTrendYears.includes(sharedCurrentYear)
        && sharedPreviousYear !== sharedCurrentYear;
    const previousYear = sharedYearPairAvailable ? sharedPreviousYear : localPreviousYear;
    const setPreviousYear = sharedYearPairAvailable ? onPreviousYearChange : setLocalPreviousYear;
    const currentYear = sharedYearPairAvailable ? sharedCurrentYear : localCurrentYear;
    const setCurrentYear = sharedYearPairAvailable ? onCurrentYearChange : setLocalCurrentYear;
    const [categoryMode, setCategoryMode] = useState("chart");

    useEffect(() => {
        if (!data) return;
        const source = data.trend || [];
        const availableYears = [...new Set(source.filter(hasYoYValue).map(item => item.name.slice(0, 4)))].sort();
        const previousDefault = availableYears.length > 1 ? availableYears.at(-2) : "";
        const currentDefault = availableYears.length ? availableYears.at(-1) : "";
        const categories = [...new Set(scopeCategoryOptions(scopeData || data, scope))]
            .filter(category => !Array.isArray(scope.categories) || scope.categories.includes(category))
            .sort((a, b) => a.localeCompare(b));
        const provinces = scopedGeography(scopeData?.scope?.geography || data.scope?.geography || [], scope)
            .flatMap(region => (region.provinces || []).map(name => ({ value: provinceComparisonKey(region.region, name), label: `${name} · ${region.region}`, name, region: region.region })))
            .sort((a, b) => a.label.localeCompare(b.label));

        setAvailableCategories(categories);
        setAvailableProvinces(provinces);
        if (!availableYears.includes(previousYear) || !availableYears.includes(currentYear) || previousYear === currentYear) {
            // A narrow descriptive filter may remove a year. Keep its fallback local so
            // filtering this page cannot change the Executive Overview's year selection.
            setPreviousYear(previousDefault);
            setCurrentYear(currentDefault);
        }
        setExpandedRegions(current => new Set([...current].filter(name => data.regions.some(region => region.name === name))));
    }, [data, scopeData]);

    useEffect(() => {
        setCompareBy(appliedFilters.compareBy);
        setDraftCategories(appliedFilters.categories);
        setDraftProvince(appliedFilters.province);
        setDraftProvinces(appliedFilters.provinces);
    }, [JSON.stringify(appliedFilters)]);

    useEffect(() => {
        if (!pendingFilters || loading || error || !data) return;
        setAppliedFilters(pendingFilters);
        setPendingFilters(null);
    }, [pendingFilters, loading, error, data]);

    useEffect(() => {
        if (!focusCategoryAfterHeatmapSelection || pendingFilters || loading) return;
        if (error) {
            setFocusCategoryAfterHeatmapSelection(false);
            return;
        }
        const categorySection = document.getElementById("da-categories");
        const contentScroller = document.querySelector(".dss-content");
        if (!categorySection || !contentScroller) {
            setFocusCategoryAfterHeatmapSelection(false);
            return;
        }
        window.__dssScrollLockUntil = Date.now() + 900;
        // Scroll the analytics pane only. scrollIntoView can also move the
        // outer document when this pane is near the end of its content.
        const sectionTop = categorySection.getBoundingClientRect().top;
        const scrollerTop = contentScroller.getBoundingClientRect().top;
        const scrollOffset = sectionTop - scrollerTop - contentScroller.clientTop;
        contentScroller.scrollTo({
            top: Math.max(0, contentScroller.scrollTop + scrollOffset),
            behavior: "smooth"
        });
        setFocusCategoryAfterHeatmapSelection(false);
    }, [focusCategoryAfterHeatmapSelection, pendingFilters, loading, error, data]);

    const applyFilters = () => setPendingFilters({ compareBy, categories: [...draftCategories], province: draftProvince, provinceKey: "", provinces: [...draftProvinces] });
    const resetFilters = () => {
        setHeatmapSelectionSnapshot(null);
        setFocusCategoryAfterHeatmapSelection(false);
        setCompareBy("category");
        setDraftCategories([...availableCategories]);
        setDraftProvince("");
        setDraftProvinces([]);
        setPendingFilters({ compareBy: "category", categories: [...availableCategories], province: "", provinceKey: "", provinces: [] });
    };
    const selectProvince = (province, region) => {
        const key = provinceComparisonKey(region, province);
        const current = pendingFilters || appliedFilters;
        if (compareBy === "province") {
            const nextProvinces = current.compareBy === "province" && current.provinces.includes(key) ? [] : [key];
            setDraftProvince("");
            setDraftProvinces(nextProvinces);
            setPendingFilters({ compareBy, categories: [...draftCategories], province: "", provinceKey: "", provinces: nextProvinces });
        } else {
            const alreadySelected = current.provinceKey === key || (!current.provinceKey && current.province === province);
            const nextProvince = alreadySelected ? "" : province;
            const nextProvinceKey = alreadySelected ? "" : key;
            setDraftProvince(nextProvince);
            setDraftProvinces([]);
            setPendingFilters({ compareBy, categories: [...draftCategories], province: nextProvince, provinceKey: nextProvinceKey, provinces: [] });
        }
    };
    const filterPanel = (
        <DescriptiveFilterPanel
            categories={availableCategories}
            provinces={availableProvinces}
            compareBy={compareBy}
            appliedCompareBy={appliedFilters.compareBy}
            selectedCategories={draftCategories}
            province={draftProvince}
            selectedProvinces={draftProvinces}
            appliedCategories={appliedFilters.categories}
            appliedProvince={appliedFilters.province}
            appliedProvinceKey={appliedFilters.provinceKey || ""}
            appliedProvinces={appliedFilters.provinces}
            loading={loading}
            onCategoriesChange={setDraftCategories}
            onCompareByChange={setCompareBy}
            onProvinceChange={setDraftProvince}
            onProvincesChange={setDraftProvinces}
            onApply={applyFilters}
            onReset={resetFilters}
        />
    );

    if (!data || !data.summary.rows) {
        return (
            <div className="rd-page">
                <div className="rd-header descriptive-page-header descriptive-page-header-status">
                    <div>
                        <span className="rd-eyebrow">DESCRIPTIVE ANALYTICS</span>
                        <h1>Sales Overview</h1>
                        <p>Review historical sales revenue, distinct order volumes, and regional distribution.</p>
                    </div>
                    {filterPanel}
                </div>
                {loading && <div className="rd-card descriptive-result-status" role="status">Loading and recalculating descriptive analytics…</div>}
                {data?.qualityWarnings?.map(note => <p key={note} className="descriptive-chart-caption" role="status">{note}</p>)}
                {error && <div className="rd-card descriptive-result-status" role="alert"><p>{error}</p><button type="button" onClick={refresh}>Retry</button></div>}
                {!loading && !error && data && !data.summary.rows && (
                    <div className="rd-card descriptive-no-data" role="status">
                        <h2>No Data Available</h2>
                        <p>{data.empty ? "No published sales records are available in the active Analysis Scope." : "No records match the applied category and province filters within the active Analysis Scope."}</p>
                        {(appliedFilters.categories.length || appliedFilters.province || appliedFilters.provinces.length) && <button type="button" className="descriptive-filter-reset" onClick={resetFilters}>Reset Filters</button>}
                    </div>
                )}
            </div>
        );
    }

    const regionData = data.regions;
    const allProvinces = regionData.flatMap(region => region.provinces.map(province => ({ ...province, region: region.name })));
    const browseRegionData = geographicBrowseData?.regions || regionData;
    const browseProvinces = browseRegionData.flatMap(region => region.provinces.map(province => ({ ...province, region: region.name })));
    const rankedBrowseProvinces = sortByMetric(browseProvinces, geoMetric);
    const visibleBrowseProvinces = showAllTopProvinces ? rankedBrowseProvinces : rankedBrowseProvinces.slice(0, 10);
    const months = data.trend.map(item => monthLabel(item.name));
    const years = [...new Set(data.trend.filter(hasYoYValue).map(item => item.name.slice(0, 4)))].sort();
    const categorySeries = appliedFilters.categories.map(name => {
        const category = data.categories.find(item => item.name === name);
        const monthly = new Map((category?.monthly || []).map(row => [row.name, row]));
        return {
            name,
            color: categorySeriesColor(name, availableCategories),
            rows: data.trend.map(period => ({
                ...period,
                ...(monthly.get(period.name) || { revenue: 0, orders: 0, quantity: 0, rows: 0 })
            }))
        };
    });
    const provinceSeries = appliedFilters.compareBy === "province" && appliedFilters.provinces.length
        ? buildProvinceTrendSeries({
            regions: data.regions,
            months: data.trend,
            selected: appliedFilters.provinces,
            available: availableProvinces
        })
        : [];
    const comparisonSeries = appliedFilters.compareBy === "province" ? provinceSeries : categorySeries;
    const comparisonLabel = appliedFilters.compareBy === "province" ? "Province" : "Product Category";
    const visualFilters = pendingFilters || appliedFilters;
    const activeProvinceLabel = appliedFilters.compareBy === "province" && appliedFilters.provinces.length === 1
        ? availableProvinces.find(item => item.value === appliedFilters.provinces[0])?.name || "All Provinces"
        : (appliedFilters.provinceKey ? availableProvinces.find(item => item.value === appliedFilters.provinceKey)?.name || appliedFilters.province : appliedFilters.province) || "All Provinces";

    const scopedCategories = data.categories || [];
    const categoryTotals = scopedCategories.reduce((totals, item) => ({
        revenue: totals.revenue + (Number(item.revenue) || 0),
        quantity: totals.quantity + (Number(item.quantity) || 0)
    }), { revenue: 0, quantity: 0 });
    const provinceCategoryHeatmap = buildProvinceCategoryHeatmap(data.regions, data.categories, geoMetric);

    const selectHeatmapCell = (province, category) => {
        const nextFilters = provinceCategorySelectionFilters(province, category);
        const filtersToRestore = pendingFilters || appliedFilters;
        setHeatmapSelectionSnapshot(current => current || {
            filters: {
                ...filtersToRestore,
                categories: [...filtersToRestore.categories],
                provinces: [...filtersToRestore.provinces]
            },
            performanceView
        });
        setFocusCategoryAfterHeatmapSelection(true);
        setCompareBy("category");
        setDraftCategories(nextFilters.categories);
        setDraftProvince(province.name);
        setDraftProvinces([]);
        setPendingFilters(nextFilters);
    };
    const returnToPreviousHeatmapView = () => {
        if (!heatmapSelectionSnapshot) return;
        const { filters, performanceView: previousView } = heatmapSelectionSnapshot;
        setHeatmapSelectionSnapshot(null);
        setFocusCategoryAfterHeatmapSelection(false);
        setCompareBy(filters.compareBy);
        setDraftCategories([...filters.categories]);
        setDraftProvince(filters.province);
        setDraftProvinces([...filters.provinces]);
        setPendingFilters(filters);
        setPerformanceView(previousView);
    };

    const toggleRegion = name => {
        const collapsing = expandedRegions.has(name);
        setExpandedRegions(current => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
        if (collapsing) {
            setShowAllRegionProvinces(current => {
                const next = new Set(current);
                next.delete(name);
                return next;
            });
        }
    };

    const trendData = Object.fromEntries(
        ["Revenue", "Orders", "Quantity"].map(name => [
            name,
            data.trend.map(item => item[name.toLowerCase()])
        ])
    );

    const mom = descriptiveMonthOverMonth(data.trend, metric.toLowerCase());
    const latest = mom.latest;
    const change = mom.change;
    const formattedLatest = metric === "Revenue"
        ? money(latest)
        : latest.toLocaleString();

    // Peak sales month from actual historical data.
    const peakMonth = data.trend?.length
        ? data.trend.reduce(
            (max, cur) => (
                (cur.revenue || 0) > (max.revenue || 0)
                    ? cur
                    : max
            ),
            data.trend[0]
        )
        : null;

    // Average order spend.
    const avgOrderValue = (
        data.summary.orders > 0 &&
        data.summary.revenue > 0
    )
        ? data.summary.revenue / data.summary.orders
        : 0;

    // Geographic and category rankings remain unchanged.
    const topProvinceOverall = allProvinces.slice().sort(
        (a, b) => (b.revenue || 0) - (a.revenue || 0)
    )[0];

    const topProvinceShare = (
        data.summary.revenue > 0 &&
        topProvinceOverall?.revenue
    )
        ? ((topProvinceOverall.revenue / data.summary.revenue) * 100).toFixed(1)
        : "0.0";

    const topCategoryOverall = (data.categories || []).slice().sort(
        (a, b) => (b.quantity || 0) - (a.quantity || 0)
    )[0];

    const topCategoryShare = (
        data.summary.quantity > 0 &&
        topCategoryOverall?.quantity
    )
        ? ((topCategoryOverall.quantity / data.summary.quantity) * 100).toFixed(1)
        : "0.0";

    const topRevenueCategoryOverall = (data.categories || []).slice().sort(
        (a, b) => (b.revenue || 0) - (a.revenue || 0)
    )[0];

    const topRevenueCategoryShare = (
        data.summary.revenue > 0 &&
        topRevenueCategoryOverall?.revenue
    )
        ? ((topRevenueCategoryOverall.revenue / data.summary.revenue) * 100).toFixed(1)
        : "0.0";

    return (
        <div className="rd-page">
            <div className="rd-header descriptive-page-header">
                <div>
                    <span className="rd-eyebrow">DESCRIPTIVE ANALYTICS</span>
                    <h1>Sales Overview</h1>
                    <p>Review historical sales revenue, distinct order volumes, and regional distribution.</p>
                </div>

                {filterPanel}

                <div className="rd-header-note">
                    <span>Date Range</span>
                    <strong>{months[0]} – {months.at(-1)}</strong>
                    <small>
                        {geographicScopeLabel(scope)} · {scope.returns} · {
                            scope.categories === null
                                ? "All categories"
                                : `${scope.categories.length} categories`
                        }
                    </small>
                </div>
            </div>

            {data?.qualityWarnings?.map(note => <p key={note} className="descriptive-chart-caption" role="status">{note}</p>)}
            {error && <div className="rd-card descriptive-result-status" role="alert"><p>{error}</p><button type="button" onClick={refresh}>Retry</button><small>Showing the previous valid results.</small></div>}

            <section
                className="rd-card descriptive-insights-card"
                id="da-insights"
                style={{ marginBottom: 18 }}
            >
                <div className="rd-card-head between">
                    <div>
                        <h2>Key Business Takeaways</h2>
                        <p>Core commercial facts and sales benchmarks established from historical records.</p>
                    </div>
                    <span className="rd-tag">Sales Benchmarks</span>
                </div>

                <div className="descriptive-facts-grid">
                    <div className="descriptive-fact-card amber">
                        <div className="descriptive-fact-kicker">
                            <span>Peak Sales Month</span>
                        </div>
                        <div className="descriptive-fact-value">
                            {peakMonth ? monthLabel(peakMonth.name) : "N/A"}
                        </div>
                        <div className="descriptive-fact-detail">
                            <strong>
                                {peakMonth ? money(peakMonth.revenue) : "₱0"}
                            </strong> in record monthly revenue
                        </div>
                    </div>

                    <div className="descriptive-fact-card blue">
                        <div className="descriptive-fact-kicker">
                            <span>Average Order Spend</span>
                        </div>
                        <div className="descriptive-fact-value">
                            {money(avgOrderValue)}
                        </div>
                        <div className="descriptive-fact-detail">
                            Across <strong>{data.summary.orders.toLocaleString()}</strong> completed customer orders
                        </div>
                    </div>

                    <div className="descriptive-fact-card green">
                        <div className="descriptive-fact-kicker">
                            <span>Top Buyer Province</span>
                        </div>
                        <div className="descriptive-fact-value">
            {topProvinceOverall?.name || "N/A"}
                        </div>
                        <div className="descriptive-fact-detail">
                            Drives <strong>{topProvinceShare}%</strong> of total sales ({money(topProvinceOverall?.revenue || 0)})
                        </div>
                        <PeriodAverages rows={topProvinceOverall?.monthly} periods={data.trend} metric="revenue" />
                    </div>

                    <div className="descriptive-fact-card indigo">
                        <div className="descriptive-fact-kicker">
                            <span>Top Revenue Product</span>
                        </div>
                        <div className="descriptive-fact-value">
                            {topRevenueCategoryOverall?.name || "N/A"}
                        </div>
                        <div className="descriptive-fact-detail">
                            Generates <strong>{topRevenueCategoryShare}%</strong> of sales ({money(topRevenueCategoryOverall?.revenue || 0)})
                        </div>
                        <PeriodAverages rows={topRevenueCategoryOverall?.monthly} periods={data.trend} metric="revenue" />
                    </div>

                    <div className="descriptive-fact-card purple">
                        <div className="descriptive-fact-kicker">
                            <span>Top Volume Product</span>
                        </div>
                        <div className="descriptive-fact-value">
                            {topCategoryOverall?.name || "N/A"}
                        </div>
                        <div className="descriptive-fact-detail">
                            Represents <strong>{topCategoryShare}%</strong> of units sold ({topCategoryOverall?.quantity?.toLocaleString() || 0} units)
                        </div>
                        <PeriodAverages rows={topCategoryOverall?.monthly} periods={data.trend} metric="quantity" />
                    </div>
                </div>
            </section>

            <div className="rd-kpi-grid descriptive-kpi-grid" id="da-kpis">
                <Kpi
                    icon={<FaMoneyBillWave />}
                    label="Total Revenue"
                    value={money(data.summary.revenue)}
                    detail="Net sales across prepared records"
                    tone="blue"
                />
                <Kpi
                    icon={<FaShoppingCart />}
                    label="Distinct Orders"
                    value={data.summary.orders.toLocaleString()}
                    detail="Count of unique customer orders"
                    tone="purple"
                />
                <Kpi
                    icon={<FaCubes />}
                    label="Units Sold"
                    value={data.summary.quantity.toLocaleString()}
                    detail="Total quantity of items sold"
                    tone="green"
                />
                <Kpi
                    icon={<FaChartLine />}
                    label="Latest Complete Month"
                    value={mom.latestMonth ? monthLabel(mom.latestMonth) : "No complete month"}
                    detail={`${formattedLatest} in ${metric.toLowerCase()} for the latest complete period`}
                    tone="amber"
                />
                <AverageMonthlySalesKpi
                    metric={metric}
                    trend={data.trend}
                    comparisonSeries={comparisonSeries}
                    comparisonLabel={comparisonLabel}
                    scope={scope}
                />
            </div>

            <div className="descriptive-analysis-stack">
                <section className="rd-card" id="da-trend">
                    <div className="rd-card-head between">
                        <div>
                            <h2>Historical Trend</h2>
                            <p>Track sales performance over time across monthly periods.</p>
                        </div>

                        <div className="descriptive-trend-controls">
                            <div className="rd-segmented">
                                {Object.keys(trendData).map(item => (
                                    <button
                                        key={item}
                                        className={metric === item ? "active" : ""}
                                        onClick={() => setMetric(item)}
                                    >
                                        {item}
                                    </button>
                                ))}
                            </div>
                            <div className="rd-segmented" aria-label="Historical trend chart mode">
                                <button className={trendMode === "monthly" ? "active" : ""} onClick={() => setTrendMode("monthly")}>Monthly Trend</button>
                                <button className={trendMode === "yoy" ? "active" : ""} onClick={() => setTrendMode("yoy")}>Year-over-Year</button>
                            </div>
                        </div>
                    </div>

                    {trendMode === "monthly" ? (
                        <DescriptiveTrendChart rows={data.trend} metric={metric} series={comparisonSeries} seriesLabel={comparisonLabel} />
                    ) : (
                        <YearOverYearChart
                            rows={data.trend}
                            metric={metric}
                            years={years}
                            previousYear={previousYear}
                            currentYear={currentYear}
                            onPreviousYearChange={setPreviousYear}
                            onCurrentYearChange={setCurrentYear}
                            series={comparisonSeries}
                            seriesLabel={comparisonLabel}
                        />
                    )}

                    {trendMode === "monthly" && <>
                    <div className="rd-trend-foot">
                        <div className={
                            change === null
                                ? ""
                                : change >= 0
                                    ? "positive"
                                    : "negative"
                        }>
                            {change !== null && (
                                change >= 0
                                    ? <FaArrowUp />
                                    : <FaArrowDown />
                            )}
                            {change === null
                                ? "N/A — see comparison note"
                                : `${Math.abs(change).toFixed(1)}% vs ${monthLabel(mom.previousMonth)}`}
                        </div>
                    </div>

                    {mom.warning && (
                        <p
                            className="descriptive-chart-caption"
                            role="status"
                            title={mom.warning}
                        >
                            Comparison note: {mom.warning}
                        </p>
                    )}

                    {mom.context.map((note, index) => (
                        <p
                            key={`mom-context-${index}`}
                            className="descriptive-chart-caption"
                            title={note}
                        >
                            {note} The month is retained in chronological comparisons unless a data gap makes the comparison unreliable.
                        </p>
                    ))}

                    {mom.partialMonths.length > 0 && (
                        <p className="descriptive-chart-caption">
                            Incomplete period{mom.partialMonths.length === 1 ? "" : "s"} ({mom.partialMonths.map(monthLabel).join(", ")}) {mom.partialMonths.length === 1 ? "remains" : "remain"} visible with recorded values.
                        </p>
                    )}
                    </>}
                </section>

                <DescriptivePerformanceControls
                    view={performanceView}
                    onViewChange={setPerformanceView}
                    metric={geoMetric}
                    onMetricChange={setGeoMetric}
                    showMetrics={false}
                    className="descriptive-performance-switch"
                />
                <section className="rd-card" id="da-geography">
                    <div className="rd-card-head between">
                        <div>
                            <h2>Geographic Performance</h2>
                            <p>Select a province to see its product category performance below.</p>
                        </div>
                        <div className="descriptive-performance-header-actions">
                            <DescriptivePerformanceControls
                                view={performanceView}
                                onViewChange={setPerformanceView}
                                metric={geoMetric}
                                onMetricChange={setGeoMetric}
                                showViews={false}
                                className="descriptive-performance-metric-controls"
                            />
                            {heatmapSelectionSnapshot && (
                                <button type="button" className="descriptive-clear-selection" onClick={returnToPreviousHeatmapView}>
                                    Return to previous view
                                </button>
                            )}
                        </div>
                    </div>

                    {performanceView === "geography" && <>
                        <div className="descriptive-view-toolbar">
                            <span className="descriptive-chart-toolbar-label">Geographic view</span>
                            <div className="rd-segmented" aria-label="Geographic detail">
                                {["Top Provinces", "Regions"].map(item => (
                                    <button type="button" key={item} className={geoTab === item ? "active" : ""} aria-pressed={geoTab === item} onClick={() => setGeoTab(item)}>{item}</button>
                                ))}
                            </div>
                        </div>
                        {geoTab === "Top Provinces" ? (
                            <div className="descriptive-bar-chart" aria-label={`Top provinces by ${geoMetric}`}>
                                {visibleBrowseProvinces.map((item, index) => (
                                    <GeoBarButton
                                        key={`${item.region}/${item.name}`}
                                        item={item}
                                        metric={geoMetric}
                                        denominator={geographicBrowseData?.summary?.[geoMetric] ?? data.summary[geoMetric]}
                                        maxValue={Number(rankedBrowseProvinces[0]?.[geoMetric]) || 1}
                                        rank={index + 1}
                                        selected={visualFilters.compareBy === "province" ? visualFilters.provinces.includes(provinceComparisonKey(item.region, item.name)) : (visualFilters.provinceKey ? visualFilters.provinceKey === provinceComparisonKey(item.region, item.name) : visualFilters.province === item.name)}
                                        onClick={() => selectProvince(item.name, item.region)}
                                    />
                                ))}
                                {rankedBrowseProvinces.length > 10 && (
                                    <button type="button" className="descriptive-region-more" aria-expanded={showAllTopProvinces} onClick={() => setShowAllTopProvinces(value => !value)}>
                                        {showAllTopProvinces ? "Show top 10" : "Show all"}
                                    </button>
                                )}
                                {!browseProvinces.length && <div className="descriptive-empty-state">No province results match the current filters.</div>}
                            </div>
                        ) : (
                            <div className="descriptive-bar-chart descriptive-region-chart">
                                {sortByMetric(browseRegionData, geoMetric).map((region, index, regions) => {
                                    const isOpen = expandedRegions.has(region.name);
                                    const provinces = sortByMetric(region.provinces.map(province => ({ ...province, region: region.name })), geoMetric);
                                    const showAll = showAllRegionProvinces.has(region.name);
                                    const visibleProvinces = showAll ? provinces : provinces.slice(0, 5);
                                    return (
                                        <div className="descriptive-region-group" key={region.name}>
                                            <GeoBarButton
                                                item={region}
                                                metric={geoMetric}
                                                denominator={geographicBrowseData?.summary?.[geoMetric] ?? data.summary[geoMetric]}
                                                maxValue={Number(regions[0]?.[geoMetric]) || 1}
                                                rank={index + 1}
                                                expanded={isOpen}
                                                onClick={() => toggleRegion(region.name)}
                                            />
                                            {isOpen && (
                                                <div className="descriptive-nested-bars" aria-label={`Provinces in ${region.name}`}>
                                                    {visibleProvinces.map((province, provinceIndex) => (
                                                        <GeoBarButton
                                                            key={`${region.name}/${province.name}`}
                                                            item={province}
                                                            metric={geoMetric}
                                                            denominator={geographicBrowseData?.summary?.[geoMetric] ?? data.summary[geoMetric]}
                                                            maxValue={Number(provinces[0]?.[geoMetric]) || 1}
                                                            rank={provinceIndex + 1}
                                                            nested
                                                            selected={visualFilters.compareBy === "province" ? visualFilters.provinces.includes(provinceComparisonKey(region.name, province.name)) : (visualFilters.provinceKey ? visualFilters.provinceKey === provinceComparisonKey(region.name, province.name) : visualFilters.province === province.name)}
                                                            onClick={() => selectProvince(province.name, region.name)}
                                                        />
                                                    ))}
                                                    {provinces.length > 5 && (
                                                        <button type="button" className="descriptive-region-more" aria-expanded={showAll} onClick={() => setShowAllRegionProvinces(current => {
                                                            const next = new Set(current);
                                                            if (next.has(region.name)) next.delete(region.name);
                                                            else next.add(region.name);
                                                            return next;
                                                        })}>
                                                            {showAll ? "Show less" : "See more"}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!regionData.length && <div className="descriptive-empty-state">No region results match the current filters.</div>}
                            </div>
                        )}
                    </>}

                    {performanceView === "heatmap" && <ProvinceCategoryHeatmap heatmap={provinceCategoryHeatmap} metric={geoMetric} onSelectCell={selectHeatmapCell} />}
                </section>

                <section className="rd-card" id="da-categories">
                    <div className="rd-card-head between descriptive-category-card-head">
                        <div>
                            <h2>Product Category Performance{activeProvinceLabel !== "All Provinces" ? ` in ${activeProvinceLabel}` : ""}</h2>
                            <p>Compare product categories for the selected province and active descriptive filters.</p>
                        </div>
                        <div className="rd-scope-summary descriptive-category-header-scope">
                            <span className="rd-scope-label"><FaMapMarkerAlt /> Category scope</span>
                            <strong>{activeProvinceLabel}</strong>
                        </div>
                        <div className="descriptive-category-header-actions">
                            <div className="rd-segmented" aria-label="Category display mode">
                                <button type="button" className={categoryMode === "table" ? "active" : ""} aria-pressed={categoryMode === "table"} onClick={() => setCategoryMode("table")}>Table</button>
                                <button type="button" className={categoryMode === "chart" ? "active" : ""} aria-pressed={categoryMode === "chart"} onClick={() => setCategoryMode("chart")}>Chart</button>
                            </div>
                        </div>
                    </div>

                        {loading && <p className="descriptive-chart-caption" role="status">Updating results. Current analytics stay visible until refresh completes.</p>}

                        {categoryMode === "table" ? (
                            <div className="rd-table-wrap">
                                <table className="rd-table">
                                    <thead>
                                        <tr>
                                            <th>Category</th>
                                            <th className={geoMetric === "revenue" ? "descriptive-selected-metric" : ""} aria-sort={geoMetric === "revenue" ? "descending" : undefined}>Revenue</th>
                                            <th className={geoMetric === "orders" ? "descriptive-selected-metric" : ""} aria-sort={geoMetric === "orders" ? "descending" : undefined}>Orders</th>
                                            <th className={geoMetric === "quantity" ? "descriptive-selected-metric" : ""} aria-sort={geoMetric === "quantity" ? "descending" : undefined}>Quantity</th>
                                            <th>Share</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortByMetric(scopedCategories, geoMetric).map(item => (
                                            <tr key={item.name}>
                                                <td><strong>{item.name}</strong></td>
                                                <td className={geoMetric === "revenue" ? "descriptive-selected-metric" : ""}>{money(item.revenue)}</td>
                                                <td className={geoMetric === "orders" ? "descriptive-selected-metric" : ""}>{Number(item.orders || 0).toLocaleString()}</td>
                                                <td className={geoMetric === "quantity" ? "descriptive-selected-metric" : ""}>{Number(item.quantity || 0).toLocaleString()}</td>
                                                <td><span className="rd-tag">{Number(item.share || 0).toFixed(1)}%</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {!scopedCategories.length && <div className="descriptive-empty-state">No category results match the current filters.</div>}
                                {!!scopedCategories.length && <p className="descriptive-chart-caption">Sorted by {geoMetric === "revenue" ? "Revenue" : geoMetric === "orders" ? "Orders" : "Quantity"}. {geoMetric === "orders" && data.definitions?.orders}</p>}
                            </div>
                        ) : (
                            <CategoryBarChart items={scopedCategories} metric={geoMetric} totals={categoryTotals} />
                        )}
                </section>
            </div>

            <section className="descriptive-handoff">
                <div>
                    <strong>Continue to Demand Forecasts (Predictive Analytics)</strong>
                    <small>Forecast future sales trends and expected product demand by province.</small>
                </div>
                <button type="button" onClick={onViewPredictive}>
                    View Demand Forecasts <span aria-hidden="true">→</span>
                </button>
            </section>

            <footer className="descriptive-footer">
                <button type="button" className="rd-link-button" onClick={refresh}>
                    Refresh data
                </button>
            </footer>
        </div>
    );
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2020, index, 1)))
);

function isConfirmedZero(row) {
    const kinds = row?.adjustmentKinds || [];
    return Number(row?.rows) === 0 && kinds.some(kind => kind === "closure" || kind === "no_sales");
}

export function hasYoYValue(row) {
    return Number(row?.rows) > 0 || isConfirmedZero(row);
}

function sortByMetric(items, metric) {
    return [...items].sort((a, b) => (Number(b[metric]) || 0) - (Number(a[metric]) || 0) || a.name.localeCompare(b.name));
}

function formatMetricValue(metric, value) {
    return metric === "revenue"
        ? money(value)
        : Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function GeoBarButton({ item, metric, denominator, maxValue, rank, selected = false, expanded, nested = false, onClick }) {
    const value = Number(item[metric]) || 0;
    const share = metric === "orders" || !denominator ? null : value / denominator * 100;
    const details = `${item.name}. Region: ${item.region || item.name}. Revenue: ${money(item.revenue)}. Distinct orders: ${Number(item.orders || 0).toLocaleString()}. Units sold: ${Number(item.quantity || 0).toLocaleString()}.${share === null ? "" : ` Share of ${metric}: ${share.toFixed(1)}%.`}`;

    return (
        <button
            type="button"
            className={`descriptive-geo-bar${selected ? " selected" : ""}${nested ? " nested" : ""}`}
            onClick={onClick}
            aria-label={`${details} ${expanded === undefined ? (selected ? "Deselect" : "Select") : (expanded ? "Collapse" : "Expand")}.`}
            aria-pressed={expanded === undefined ? selected : undefined}
            aria-expanded={expanded}
            title={details}
        >
            <span className="descriptive-bar-rank">{rank}</span>
            <span className="descriptive-bar-label">
                <strong>{item.name}</strong>
                <small>{item.region || "Region"}</small>
            </span>
            <span className="descriptive-bar-track" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(value > 0 ? 1 : 0, value / maxValue * 100))}%` }} />
            </span>
            <span className="descriptive-bar-stat">
                <strong>{formatMetricValue(metric, value)}{metric === "orders" ? " orders" : metric === "quantity" ? " units" : ""}</strong>
                {share !== null && <small>{share.toFixed(1)}% of scoped {metric === "revenue" ? "revenue" : "units"}</small>}
            </span>
            {expanded !== undefined && <span className="descriptive-bar-chevron">{expanded ? <FaChevronUp /> : <FaChevronDown />}</span>}
        </button>
    );
}

export function YearOverYearChart({ rows, metric, years, previousYear, currentYear, onPreviousYearChange, onCurrentYearChange, series = [], seriesLabel = "Product Category" }) {
    const [zoom, setZoom] = useState(1);
    const [expanded, setExpanded] = useState(false);
    const metricKey = metric.toLowerCase();
    const previousRows = new Map(rows.filter(row => row.name.startsWith(`${previousYear}-`)).map(row => [Number(row.name.slice(5, 7)), row]));
    const currentRows = new Map(rows.filter(row => row.name.startsWith(`${currentYear}-`)).map(row => [Number(row.name.slice(5, 7)), row]));
    const categoryRows = series.map(category => ({
        ...category,
        previous: new Map(category.rows.filter(row => row.name.startsWith(`${previousYear}-`)).map(row => [Number(row.name.slice(5, 7)), row])),
        current: new Map(category.rows.filter(row => row.name.startsWith(`${currentYear}-`)).map(row => [Number(row.name.slice(5, 7)), row]))
    }));
    const values = categoryRows.length
        ? categoryRows.flatMap(category => [...category.previous.values(), ...category.current.values()]).filter(hasYoYValue).map(row => Number(row[metricKey]) || 0)
        : [...previousRows.values(), ...currentRows.values()].filter(hasYoYValue).map(row => Number(row[metricKey]) || 0);
    const maxValue = Math.max(1, ...values);
    const selectedYearRows = categoryRows.length
        ? [...new Map(categoryRows.flatMap(category => category.rows.filter(row => row.name.startsWith(`${previousYear}-`) || row.name.startsWith(`${currentYear}-`)).map(row => [row.name, row]))).values()]
        : rows.filter(row => row.name.startsWith(`${previousYear}-`) || row.name.startsWith(`${currentYear}-`));
    const dataGaps = selectedYearRows.filter(row => (row.adjustmentKinds || []).includes("data_gap"));
    const incompletePeriods = selectedYearRows.filter(row => row.partial);

    useEffect(() => {
        if (!expanded) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const closeOnEscape = event => {
            if (event.key === "Escape") setExpanded(false);
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [expanded]);

    if (years.length < 2) {
        return <div className="descriptive-empty-state">Year-over-Year comparison needs at least two years with recorded or confirmed zero-sales periods.</div>;
    }

    return (
        <div className={`descriptive-yoy-chart descriptive-chart-shell${expanded ? " expanded" : ""}`}>
            <div className="descriptive-yoy-controls">
                <label>
                    <span>Previous year</span>
                    <select value={previousYear} onChange={event => onPreviousYearChange(event.target.value)}>
                        {years.filter(year => year < currentYear || year === previousYear).map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                </label>
                <label>
                    <span>Current year</span>
                    <select value={currentYear} onChange={event => onCurrentYearChange(event.target.value)}>
                        {years.filter(year => year > previousYear || year === currentYear).map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                </label>
                <div className="descriptive-chart-zoom descriptive-yoy-zoom" aria-label="Chart zoom controls">
                    <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={zoom <= 1}>−</button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, value + 0.5))} disabled={zoom >= 3}>+</button>
                </div>
                <button type="button" className="descriptive-chart-control expand" onClick={() => setExpanded(value => !value)}>
                    {expanded ? "Close expanded chart ×" : "Expand chart"}
                </button>
            </div>

            {!categoryRows.length && <div className="descriptive-yoy-legend" aria-label="Chart legend"><span><i className="previous" />{previousYear}</span><span><i className="current" />{currentYear}</span></div>}

            <div className="descriptive-yoy-scroll">
                <div className="descriptive-yoy-grid" role="group" aria-label={`${metric} comparison for ${previousYear} and ${currentYear}`} style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", width: `${zoom * 100}%`, minWidth: categoryRows.length ? 0 : undefined }}>
                    {MONTH_NAMES.map((month, index) => {
                        const monthNumber = index + 1;
                        const previous = previousRows.get(monthNumber);
                        const current = currentRows.get(monthNumber);
                        const previousHasValue = hasYoYValue(previous);
                        const currentHasValue = hasYoYValue(current);
                        const previousValue = Number(previous?.[metricKey]) || 0;
                        const currentValue = Number(current?.[metricKey]) || 0;
                        const comparable = isComparableYoY(previous) && isComparableYoY(current);
                        const growth = comparable && previousValue !== 0
                            ? (currentValue - previousValue) / previousValue * 100
                            : null;
                        const reason = growth !== null ? "" : comparisonReason(previous, current, previousValue);
                        const categoryValues = categoryRows.map(category => ({
                            category,
                            previous: category.previous.get(monthNumber),
                            current: category.current.get(monthNumber)
                        }));
                        return (
                            <div className="descriptive-yoy-month" key={month}>
                                <div className={`descriptive-yoy-bars${categoryRows.length ? " multi" : ""}`} style={categoryRows.length ? { "--bar-count": categoryRows.length * 2 } : undefined}>
                                    {categoryValues.length
                                        ? categoryValues.map(({ category, previous: previousCategory, current: currentCategory }) => <Fragment key={category.name}>
                                            <YoYBar row={previousCategory} year={previousYear} month={month} metric={metric} value={Number(previousCategory?.[metricKey]) || 0} maxValue={maxValue} hasValue={hasYoYValue(previousCategory)} color="previous" category={category.name} seriesColor={category.color} />
                                            <YoYBar row={currentCategory} year={currentYear} month={month} metric={metric} value={Number(currentCategory?.[metricKey]) || 0} maxValue={maxValue} hasValue={hasYoYValue(currentCategory)} color="current" category={category.name} seriesColor={category.color} />
                                        </Fragment>)
                                        : <><YoYBar row={previous} year={previousYear} month={month} metric={metric} value={previousValue} maxValue={maxValue} hasValue={previousHasValue} color="previous" /><YoYBar row={current} year={currentYear} month={month} metric={metric} value={currentValue} maxValue={maxValue} hasValue={currentHasValue} color="current" /></>}
                                </div>
                                <strong className="descriptive-yoy-month-label">{month}</strong>
                                {!categoryRows.length && <span className={`descriptive-yoy-growth${growth === null ? " unavailable" : growth >= 0 ? " positive" : " negative"}`} title={reason}>
                                    {growth === null ? "N/A" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}
                                </span>}
                                {!categoryRows.length && <span className="descriptive-yoy-pair-values">
                                    <span className="previous">{previousYear}: {previousHasValue ? formatMetricValue(metric.toLowerCase(), previousValue) : "Missing"}</span>
                                    <span className="current">{currentYear}: {currentHasValue ? formatMetricValue(metric.toLowerCase(), currentValue) : "Missing"}</span>
                                </span>}
                            </div>
                        );
                    })}
                </div>
            </div>
            {categoryRows.length > 0 && <div className="descriptive-yoy-legend descriptive-yoy-legend-below" aria-label={`${seriesLabel} legend`}>
                {categoryRows.map(category => <span key={category.name}><i style={{ backgroundColor: category.color }} />{category.name}</span>)}
            </div>}
            {categoryRows.length > 0
                ? <p className="descriptive-chart-caption descriptive-yoy-year-key">Grouped bars compare the selected {seriesLabel === "Product Category" ? "categories" : "provinces"} by month. Faded bars show {previousYear}; solid bars show {currentYear}. Hover or focus a bar for its {seriesLabel.toLowerCase()}, year, and value. Missing periods remain unplotted unless a zero-sales period is confirmed.</p>
                : <p className="descriptive-chart-caption">Bars show recorded actual values. YoY growth is shown only when both matching months are comparable; missing records, incomplete periods, data gaps, anomalies, or a zero previous-year value are marked N/A.</p>}
            {dataGaps.length > 0 && <p className="descriptive-chart-caption" role="status">Data quality warning: {dataGaps.map(row => monthLabel(row.name)).join(", ")} include recorded data gaps. Available sales remain visible; growth is marked N/A where affected.</p>}
            {incompletePeriods.length > 0 && <p className="descriptive-chart-caption" role="status">Incomplete periods: {incompletePeriods.map(row => monthLabel(row.name)).join(", ")}. Recorded values remain visible and are not compared as full months.</p>}
        </div>
    );
}

function isComparableYoY(row) {
    if (!row || row.partial) return false;
    const kinds = row.adjustmentKinds || [];
    if (kinds.includes("data_gap") || kinds.includes("anomaly") || kinds.includes("closure")) return false;
    return hasYoYValue(row);
}

function comparisonReason(previous, current, previousValue) {
    for (const [row, yearLabel] of [[previous, "previous year"], [current, "current year"]]) {
        if (!row) return `No historical record for this month in the ${yearLabel}.`;
        if ((row.adjustmentKinds || []).includes("data_gap")) return `A recorded data gap affects the ${yearLabel}; growth is unavailable.`;
        if (row.partial) return `The ${yearLabel} period is incomplete; growth is unavailable.`;
        if ((row.adjustmentKinds || []).includes("anomaly")) return `The ${yearLabel} month is flagged as an anomaly; growth is unavailable.`;
        if ((row.adjustmentKinds || []).includes("closure")) return `The ${yearLabel} month is flagged as a shop closure; growth is unavailable.`;
        if (!hasYoYValue(row)) return `No transactions are recorded for the ${yearLabel} month, and zero sales are not confirmed.`;
    }
    if (previousValue === 0) return "Previous-year value is zero; percentage growth is undefined.";
    return "The matching months are not comparable.";
}

function YoYBar({ row, year, month, metric, value, maxValue, hasValue, color, category = "", seriesColor = "" }) {
    const flags = periodDetails(row).description;
    const state = !row ? "No period in dataset" : row.partial ? "Incomplete month" : (row.adjustmentKinds || []).includes("data_gap") ? "Data gap" : hasValue ? "Recorded actual" : "No transaction records; zero is not confirmed";
    const label = `${category ? `${category}, ` : ""}${month} ${year}: ${hasValue ? formatMetricValue(metric.toLowerCase(), value) : state}${flags ? `. ${flags}` : ""}`;
    return (
        <button
            type="button"
            className={`descriptive-yoy-bar ${color}${seriesColor ? " category-series" : ""}${hasValue && value === 0 ? " zero" : ""}${!hasValue ? " missing" : ""}`}
            style={{ height: hasValue ? `${Math.min(100, Math.max(value > 0 ? 2 : 1, value / maxValue * 100))}%` : "0%", ...(seriesColor ? { "--series-color": seriesColor } : {}) }}
            aria-label={label}
            title={label}
            tabIndex="0"
        />
    );
}

function CategoryBarChart({ items, metric, totals }) {
    const sorted = sortByMetric(items, metric);
    const maxValue = Math.max(1, ...sorted.map(item => Number(item[metric]) || 0));
    const denominator = totals[metric] || 0;
    return (
        <div className="descriptive-category-chart">
            <div className="descriptive-chart-toolbar">
                <span className="descriptive-chart-toolbar-label">Sorted by {metric === "revenue" ? "Revenue" : metric === "orders" ? "Orders" : "Quantity"}</span>
            </div>
            <div className="descriptive-category-bars">
                {sorted.map(item => {
                    const value = Number(item[metric]) || 0;
                    const share = denominator ? value / denominator * 100 : 0;
                    const detail = `${item.name}. Revenue: ${money(item.revenue)}. Distinct orders: ${Number(item.orders || 0).toLocaleString()}. Quantity: ${Number(item.quantity || 0).toLocaleString()}.${metric === "orders" ? " Category order counts overlap when an order contains multiple categories." : ` ${metric === "revenue" ? "Revenue" : "Quantity"} share: ${share.toFixed(1)}%.`}`;
                    return (
                        <div className="descriptive-category-bar-row" key={item.name} tabIndex="0" title={detail} aria-label={detail}>
                            <strong className="descriptive-category-name">{item.name}</strong>
                            <span className="descriptive-category-track" aria-hidden="true"><span style={{ width: `${Math.max(value > 0 ? 1 : 0, value / maxValue * 100)}%` }} /></span>
                            <span className="descriptive-category-value">
                                {formatMetricValue(metric, value)}{metric === "orders" ? " orders" : metric === "quantity" ? " units" : ""}
                                {metric !== "orders" && <small>{share.toFixed(1)}%</small>}
                            </span>
                        </div>
                    );
                })}
                {!sorted.length && <div className="descriptive-empty-state">No category results match the current filters.</div>}
            </div>
            {metric === "orders" && <p className="descriptive-chart-caption">Orders are distinct within each category. An order containing multiple categories is counted in each, so these category counts can overlap.</p>}
        </div>
    );
}

export function DescriptiveTrendChart({ rows, metric, series = [], seriesLabel = "Product Category" }) {
    const [xInterval, setXInterval] = useState("monthly");
    const [yInterval, setYInterval] = useState("auto");
    const [zoom, setZoom] = useState(1);
    const [containerWidth, setContainerWidth] = useState(800);
    const [expanded, setExpanded] = useState(false);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const plotScrollRef = useRef(null);
    const selectedSeries = series.map(category => ({
        ...category,
        points: category.rows.map(row => {
            const hasValue = Number(row.rows) > 0 || isConfirmedZero(row);
            return {
                month: row.name,
                value: hasValue ? Number(row[metric.toLowerCase()]) || 0 : null,
                partial: !!row.partial,
                adjusted: !!row.adjusted,
                ...periodDetails(row)
            };
        })
    }));

    // Original values, month positions and chart geometry are preserved.
    const points = rows.map(row => ({
        month: row.name,
        value: Number(row[metric.toLowerCase()]) || 0,
        partial: !!row.partial,
        adjusted: !!row.adjusted,
        ...periodDetails(row)
    }));

    const dataGapMonths = points.filter(point => point.hasDataGap);
    const values = selectedSeries.length
        ? selectedSeries.flatMap(category => category.points.map(point => point.value).filter(Number.isFinite))
        : points.map(point => point.value);
    const rawMinimum = Math.min(0, ...values);
    const rawMaximum = Math.max(1, ...values);
    const rawSpan = rawMaximum - rawMinimum || 1;
    const autoInterval = descriptiveNiceInterval(rawSpan / 4);
    const numericYInterval = Number(yInterval);

    const validManualInterval =
        yInterval !== "auto" &&
        Number.isFinite(numericYInterval) &&
        numericYInterval > 0;

    const requestedInterval = validManualInterval
        ? numericYInterval
        : autoInterval;

    const intervalTooSmall =
        yInterval !== "auto" &&
        (!validManualInterval || rawSpan / requestedInterval > 12);

    const axisInterval = intervalTooSmall
        ? autoInterval
        : requestedInterval;

    const minimum = Math.floor(rawMinimum / axisInterval) * axisInterval;
    const maximum = Math.max(
        minimum + axisInterval,
        Math.ceil(rawMaximum / axisInterval) * axisInterval
    );

    const span = maximum - minimum || 1;
    const basePlotWidth = selectedSeries.length ? Math.max(320, containerWidth - 2) : 800;
    const plotWidth = basePlotWidth * zoom;
    const plotHeight = expanded ? 430 : 290;
    const plotTop = 25;
    const plotBottom = plotHeight - 50;

    const xPosition = index =>
        64 + index * (plotWidth - 110) / Math.max(1, points.length - 1);

    const yPosition = value =>
        plotBottom - (value - minimum) / span * (plotBottom - plotTop);

    const xLabelEvery = Math.max(
        1,
        Math.ceil(
            points.length /
            Math.max(4, Math.floor((plotWidth - 100) / 60))
        )
    );

    const xTickIndices = new Set(
        points.length ? [0, points.length - 1] : []
    );

    points.forEach((point, index) => {
        if (
            xInterval === "yearly"
                ? point.month.endsWith("-01")
                : index % xLabelEvery === 0
        ) {
            xTickIndices.add(index);
        }
    });

    const xTicks = thinDescriptiveAxisTicks(
        [...xTickIndices],
        points.length,
        xPosition,
        60
    ).map(index => ({
        index,
        label: xInterval === "yearly"
            ? points[index].month.slice(0, 4)
            : monthLabel(points[index].month)
    }));

    const yTicks = Array.from(
        {
            length: Math.floor(
                (maximum - minimum) / axisInterval
            ) + 1
        },
        (_, index) => minimum + index * axisInterval
    );

    const formatValue = value =>
        metric === "Revenue"
            ? money(value)
            : Number(value).toLocaleString(
                "en-PH",
                { maximumFractionDigits: 2 }
            );

    const formatPeriod = month => {
        const date = new Date(`${month}-01T00:00:00Z`);
        return `${new Intl.DateTimeFormat("en-PH", {
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }).format(date)} (${month})`;
    };

    const linePoints = points.map((point, index) => `${xPosition(index)},${yPosition(point.value)}`).join(" ");
    const linePath = source => {
        let connected = false;
        return source.map((point, index) => {
            if (point.value == null) {
                connected = false;
                return "";
            }
            const command = connected ? "L" : "M";
            connected = true;
            return `${command} ${xPosition(index)} ${yPosition(point.value)}`;
        }).filter(Boolean).join(" ");
    };

    useEffect(() => {
        if (!expanded) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        function closeOnEscape(event) {
            if (event.key === "Escape") setExpanded(false);
        }

        window.addEventListener("keydown", closeOnEscape);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [expanded]);

    useEffect(() => {
        const element = plotScrollRef.current;
        if (!element) return undefined;
        const updateWidth = () => {
            const width = Math.round(element.clientWidth);
            if (width > 0) setContainerWidth(current => current === width ? current : width);
        };
        updateWidth();
        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateWidth);
            return () => window.removeEventListener("resize", updateWidth);
        }
        const observer = new ResizeObserver(updateWidth);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div className={`descriptive-chart-shell ${expanded ? "expanded" : ""}`}>
            <div className="descriptive-chart-toolbar" aria-label="Chart controls">
                <label>
                    <span>X-axis labels</span>
                    <select
                        value={xInterval}
                        onChange={event => setXInterval(event.target.value)}
                    >
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                    </select>
                </label>

                <label>
                    <span>Y-axis interval</span>
                    <input
                        type="number"
                        min="0"
                        step="any"
                        value={yInterval === "auto" ? "" : yInterval}
                        placeholder="Auto"
                        aria-label="Y-axis value interval"
                        onChange={event => setYInterval(event.target.value || "auto")}
                    />
                </label>

                <button
                    type="button"
                    className="descriptive-chart-control"
                    onClick={() => setYInterval("auto")}
                    disabled={yInterval === "auto"}
                >
                    Auto scale
                </button>

                <div
                    className="descriptive-chart-zoom"
                    aria-label="Chart zoom controls"
                >
                    <button
                        type="button"
                        aria-label="Zoom out"
                        onClick={() => setZoom(value => Math.max(1, value - 0.5))}
                        disabled={zoom <= 1}
                    >
                        −
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                        type="button"
                        aria-label="Zoom in"
                        onClick={() => setZoom(value => Math.min(3, value + 0.5))}
                        disabled={zoom >= 3}
                    >
                        +
                    </button>
                </div>

                {!expanded && (
                    <button
                        type="button"
                        className="descriptive-chart-control expand"
                        onClick={() => setExpanded(true)}
                    >
                        Expand chart
                    </button>
                )}

                {expanded && (
                    <button
                        type="button"
                        className="descriptive-chart-control expand"
                        onClick={() => setExpanded(false)}
                    >
                        Close expanded chart ×
                    </button>
                )}
            </div>

            {intervalTooSmall && (
                <p className="descriptive-chart-hint" role="status">
                    That interval is too small for this value range, so the axis uses an automatic interval to keep labels readable.
                </p>
            )}

            <div className="descriptive-chart-scroll" ref={plotScrollRef}>
                <div className="descriptive-chart-plot">
                    {hoveredPoint && (
                        <div
                            className="descriptive-chart-tooltip"
                            role="status"
                        >
                            <strong>{hoveredPoint.category ? `${hoveredPoint.category} · Actual` : "Actual"}</strong>
                            <span>
                                {formatPeriod(hoveredPoint.month)}
                                {hoveredPoint.partial
                                    ? " (part-month, incomplete)"
                                    : ""}
                                {hoveredPoint.heading
                                    ? ` (${hoveredPoint.heading})`
                                    : ""}
                            </span>
                            <b>{formatValue(hoveredPoint.value)}</b>
                            {hoveredPoint.description && (
                                <span>{hoveredPoint.description}</span>
                            )}
                            {hoveredPoint.partial && (
                                <span>
                                    This period is incomplete; its recorded value is still displayed.
                                </span>
                            )}
                        </div>
                    )}

                    <svg
                        className="descriptive-chart-svg"
                        style={{
                            width: selectedSeries.length || zoom > 1 ? `${plotWidth}px` : "100%",
                            height: expanded ? "min(62vh, 560px)" : undefined
                        }}
                        viewBox={`0 0 ${plotWidth} ${plotHeight}`}
                        role="img"
                        aria-label={selectedSeries.length ? `Monthly ${metric.toLowerCase()} trend by ${seriesLabel.toLowerCase()}` : `Monthly actual ${metric.toLowerCase()} trend`}
                    >
                        {yTicks.map(value => (
                            <g key={`y-${value}`}>
                                <line
                                    x1="64"
                                    x2={plotWidth - 26}
                                    y1={yPosition(value)}
                                    y2={yPosition(value)}
                                    className="descriptive-chart-grid"
                                />
                                <text
                                    x="56"
                                    y={yPosition(value) + 4}
                                    textAnchor="end"
                                >
                                    {formatValue(value)}
                                </text>
                            </g>
                        ))}

                        {!selectedSeries.length && points.length > 1 && (
                            <polyline
                                points={linePoints}
                                className="descriptive-chart-line"
                            />
                        )}

                        {selectedSeries.map(category => category.points.length > 1 && <path
                            key={`line-${category.name}`}
                            d={linePath(category.points)}
                            className="descriptive-chart-line descriptive-category-series-line"
                            style={{ stroke: category.color }}
                        />)}

                        {!selectedSeries.length && points.map((point, index) => (
                            <circle
                                key={point.month}
                                cx={xPosition(index)}
                                cy={yPosition(point.value)}
                                r="4.5"
                                tabIndex="0"
                                aria-label={`Actual, ${formatPeriod(point.month)}, ${formatValue(point.value)}`}
                                onPointerEnter={() => setHoveredPoint(point)}
                                onPointerLeave={() => setHoveredPoint(null)}
                                onFocus={() => setHoveredPoint(point)}
                                onBlur={() => setHoveredPoint(null)}
                                className="descriptive-chart-point"
                            >
                                <title>
                                    {`${formatPeriod(point.month)} · Actual · ${formatValue(point.value)}${point.partial ? " · Partial month" : ""}${point.description ? ` · ${point.description}` : ""}`}
                                </title>
                            </circle>
                        ))}
                        {selectedSeries.flatMap(category => category.points.map((point, index) => point.value == null ? null : <circle
                            key={`${category.name}-${point.month}`}
                            cx={xPosition(index)}
                            cy={yPosition(point.value)}
                            r="4.5"
                            tabIndex="0"
                            aria-label={`${category.name}, actual, ${formatPeriod(point.month)}, ${formatValue(point.value)}`}
                            onPointerEnter={() => setHoveredPoint({ ...point, category: category.name })}
                            onPointerLeave={() => setHoveredPoint(null)}
                            onFocus={() => setHoveredPoint({ ...point, category: category.name })}
                            onBlur={() => setHoveredPoint(null)}
                            className="descriptive-chart-point descriptive-category-series-point"
                            style={{ fill: category.color, stroke: category.color }}
                        ><title>{`${category.name} · ${formatPeriod(point.month)} · Actual · ${formatValue(point.value)}${point.partial ? " · Partial month" : ""}${point.description ? ` · ${point.description}` : ""}`}</title></circle>))}

                        {xTicks.map(({ index, label }) => (
                            <text
                                key={`x-${index}`}
                                x={xPosition(index)}
                                y={plotHeight - 15}
                                textAnchor={
                                    index === 0
                                        ? "start"
                                        : index === points.length - 1
                                            ? "end"
                                            : "middle"
                                }
                            >
                                {label}
                            </text>
                        ))}
                    </svg>
                </div>
            </div>

            {selectedSeries.length > 0 && <div className="descriptive-category-series-legend" aria-label={`${seriesLabel} legend`}>
                {selectedSeries.map(category => <span key={category.name}><i style={{ backgroundColor: category.color }} />{category.name}</span>)}
            </div>}

            <p className="descriptive-chart-caption">
                {selectedSeries.length ? `Monthly actual ${metric.toLowerCase()} by ${seriesLabel.toLowerCase()}. Hover or focus a point for its ${seriesLabel.toLowerCase()}, date, value, and any recorded period flag.` : `Monthly actual ${metric.toLowerCase()}. Hover or focus a point for its date, value, and any recorded period flag (Shop Closure, No Sales Recorded, Data Gap, or Anomaly). Historical monthly values and the plotted chart remain unchanged.`}
            </p>

            {dataGapMonths.length > 0 && (
                <p className="descriptive-chart-caption" role="status">
                    Data quality warning: {dataGapMonths.map(
                        point => monthLabel(point.month)
                    ).join(", ")} {dataGapMonths.length === 1 ? "has a" : "have"} recorded data gap. Available sales are shown, but missing transactions must not be interpreted as zero sales.
                </p>
            )}
        </div>
    );
}

function descriptiveNiceInterval(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;

    const magnitude = 10 ** Math.floor(Math.log10(value));
    const fraction = value / magnitude;

    return (
        fraction <= 1
            ? 1
            : fraction <= 2
                ? 2
                : fraction <= 5
                    ? 5
                    : 10
    ) * magnitude;
}

function thinDescriptiveAxisTicks(indices, pointCount, xPosition, minSpacing) {
    if (pointCount <= 2) {
        return [...new Set(indices)].sort((a, b) => a - b);
    }

    const lastIndex = pointCount - 1;
    const ordered = [...new Set(indices)].sort((a, b) => a - b);
    const visible = [0];

    for (const index of ordered) {
        if (index === 0 || index === lastIndex) continue;

        if (
            xPosition(index) - xPosition(visible.at(-1)) >= minSpacing &&
            xPosition(lastIndex) - xPosition(index) >= minSpacing
        ) {
            visible.push(index);
        }
    }

    const previous = visible.at(-1);

    if (
        xPosition(lastIndex) - xPosition(previous) < minSpacing &&
        visible.length > 1
    ) {
        visible.pop();
    }

    if (lastIndex !== 0) visible.push(lastIndex);

    return visible;
}

function AverageMonthlySalesKpi({ metric, trend, comparisonSeries, comparisonLabel, scope }) {
    const [breakdownOpen, setBreakdownOpen] = useState(false);
    const breakdownId = useId();
    const metricKey = metric.toLowerCase();
    const completeMonths = trend.filter(row => !row.partial
        && !periodDetails(row).hasDataGap
        && hasYoYValue(row)
        && isCompleteMonthInScope(row.name, scope));
    const average = rows => completeMonths.length
        ? completeMonths.reduce((total, month) => total + (Number(rows.get(month.name)) || 0), 0) / completeMonths.length
        : null;
    const overallValues = new Map(trend.map(row => [row.name, Number(row[metricKey]) || 0]));
    const averageValue = average(overallValues);
    const formatValue = value => value == null
        ? "N/A"
        : metricKey === "revenue"
            ? money(value)
            : Number(value).toLocaleString("en-PH", { maximumFractionDigits: 2 });
    const breakdown = comparisonSeries.map(series => ({
        name: series.name,
        color: series.color,
        value: average(new Map((series.rows || []).map(row => [row.name, Number(row[metricKey]) || 0])))
    }));
    const hasBreakdown = breakdown.length > 1;
    const metricUnit = metricKey === "quantity" ? "units" : metricKey.toLowerCase();
    const breakdownNote = [
        `Averages use the same ${completeMonths.length} complete months as the overall value.`,
        metricKey === "orders" && comparisonLabel === "Product Category"
            ? "An order containing multiple categories can count once in each category."
            : ""
    ].filter(Boolean).join(" ");

    return <div className="rd-kpi tone-blue descriptive-average-kpi">
        <div className="rd-kpi-icon"><FaChartBar aria-hidden="true" /></div>
        <div className="descriptive-average-kpi-content">
            <div className="descriptive-average-kpi-heading">
                <small>Average Monthly {metric === "Quantity" ? "Units" : metric}</small>
                {hasBreakdown && <button
                    type="button"
                    className={`descriptive-average-kpi-toggle${breakdownOpen ? " expanded" : ""}`}
                    aria-label={`${breakdownOpen ? "Hide" : "Show"} average monthly ${metricUnit} by selected ${comparisonLabel.toLowerCase()}`}
                    aria-expanded={breakdownOpen}
                    aria-controls={breakdownId}
                    title={`${breakdownOpen ? "Hide" : "Show"} ${comparisonLabel.toLowerCase()} breakdown`}
                    onClick={() => setBreakdownOpen(open => !open)}
                ><FaChevronDown aria-hidden="true" /></button>}
            </div>
            <strong>{formatValue(averageValue)}</strong>
            <span>{completeMonths.length
                ? `Average ${metricUnit} per month across ${completeMonths.length} complete months`
                : "No complete months with observed sales"}</span>
            {hasBreakdown && <div id={breakdownId} className="descriptive-average-kpi-breakdown" hidden={!breakdownOpen}>
                <strong>By selected {comparisonLabel.toLowerCase()}</strong>
                <ul>{breakdown.map(item => <li key={item.name}>
                    <i style={{ backgroundColor: item.color || "#718097" }} aria-hidden="true" />
                    <span>{item.name}</span>
                    <b>{formatValue(item.value)}</b>
                </li>)}</ul>
                <small>{breakdownNote}</small>
            </div>}
        </div>
    </div>;
}

function isCompleteMonthInScope(month, scope) {
    if (scope?.period !== "Custom Range") return true;
    if (scope.start?.slice(0, 7) === month && scope.start.slice(8, 10) !== "01") return false;
    if (scope.end?.slice(0, 7) === month) {
        const [year, monthNumber] = month.split("-").map(Number);
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        if (Number(scope.end.slice(8, 10)) !== lastDay) return false;
    }
    return true;
}

function Kpi({ icon, label, value, detail, tone }) {
    return (
        <div className={`rd-kpi tone-${tone}`}>
            <div className="rd-kpi-icon">{icon}</div>
            <div>
                <small>{label}</small>
                <strong>{value}</strong>
                <span>{detail}</span>
            </div>
        </div>
    );
}

export function PeriodAverages({ rows = [], periods = [], metric }) {
    const total = rows.reduce((sum, row) => sum + (Number(row[metric]) || 0), 0);
    const monthsInScope = periods.length;
    const yearsInScope = new Set(periods.map(period => period.name.slice(0, 4))).size;
    const format = value => metric === "revenue"
        ? money(value)
        : `${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })} units`;

    if (!monthsInScope || !yearsInScope) return null;

    return (
        <div className="descriptive-period-averages">
            <span><span>Avg/mo</span><strong>{format(total / monthsInScope)}</strong></span>
            <span><span>Avg/yr</span><strong>{format(total / yearsInScope)}</strong></span>
        </div>
    );
}

function Insight({ title, text }) {
    return (
        <div className="rd-insight">
            <span><FaLightbulb /></span>
            <div>
                <strong>{title}</strong>
                <p>{text}</p>
            </div>
        </div>
    );
}
