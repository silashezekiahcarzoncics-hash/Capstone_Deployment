import { useEffect, useMemo, useState } from "react";
import {
    FaArrowRight,
    FaArrowDown,
    FaArrowUp,
    FaCalendarAlt,
    FaCubes,
    FaDatabase,
    FaFileAlt,
    FaMapMarkerAlt,
    FaMapMarkedAlt,
    FaMoneyBillWave,
    FaShoppingCart,
    FaTrophy
} from "react-icons/fa";

import { fetchPredictive, fetchPrescriptive, getCachedPredictive, getCachedPrescriptive } from "../data/analyticsApi";
import { DEFAULT_FORECAST_SETTINGS } from "../data/forecastSettings";
import DemandSignalsSection from "../components/DemandSignalsSection";
import { DEFAULT_SCOPE, monthLabel, money, useAnalytics } from "../hooks/useAnalytics";
import { narrowScope, scopeSelectionLabel } from '../utils/analyticsFilterScope';
import { descriptiveMonthOverMonth, DescriptiveTrendChart, hasYoYValue, PeriodAverages, YearOverYearChart } from "./DescriptiveAnalytics";
import { evidenceSentence, metricValue, monthlyDescription, nextStepText, number as prescriptiveNumber, recommendationText, reviewMetricDescription, reviewMetricDisplay, reviewMetricLabel, ReviewMetricFilter, sortByReviewMetric, StrategyBadge } from "./PrescriptiveAnalytics";
import { ForecastChart, ForecastComparisonChart } from "./PredictiveAnalytics";
import { categorySeriesColor } from '../utils/categorySeriesColor';
import { buildProvinceTrendSeries, provinceComparisonKey } from '../utils/provinceComparison';
import "../styles/executive-overview.css";

const number = value => value == null || !Number.isFinite(Number(value))
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(Number(value));
const percent = value => value == null || !Number.isFinite(Number(value))
    ? "Unavailable"
    : `${Number(value).toFixed(1)}%`;
export default function ExecutiveOverview({ descriptiveFilters = { compareBy: 'category', categories: [], province: '', provinces: [] }, scope = DEFAULT_SCOPE, forecastSettings = DEFAULT_FORECAST_SETTINGS, forecastSelection = { category: "", provinceKey: "" }, prescriptiveSelection = { category: "All Categories", pairKey: "" }, prescriptiveReviewMetric = "forecastChange", onPrescriptiveReviewMetricChange = () => {}, onPrescriptiveSelectionChange = () => {}, descriptiveMetric = "Revenue", onDescriptiveMetricChange = () => {}, descriptiveTrendMode = "monthly", onDescriptiveTrendModeChange = () => {}, descriptivePreviousYear = "", onDescriptivePreviousYearChange = () => {}, descriptiveCurrentYear = "", onDescriptiveCurrentYearChange = () => {}, onViewPredictive = () => {}, onNavigate = () => {} }) {
    const effectiveDescriptiveFilters = {
        categories: descriptiveFilters.categories,
        province: descriptiveFilters.compareBy === 'province' ? '' : descriptiveFilters.province,
        provinceKeys: descriptiveFilters.compareBy === 'province' ? descriptiveFilters.provinces : (descriptiveFilters.provinceKey ? [descriptiveFilters.provinceKey] : [])
    };
    const { data: analytics, loading: descriptiveLoading, error: descriptiveError } = useAnalytics(scope, true, effectiveDescriptiveFilters);
    const forecastScope = narrowScope(scope, {
        categories: forecastSelection.categories || (forecastSelection.category ? [forecastSelection.category] : []),
        provinceKeys: forecastSelection.compareBy === 'province' ? forecastSelection.provinceKeys || [] : []
    });
    const forecastParams = { scope: forecastScope, ...forecastSettings,
        category: forecastSelection.compareBy === 'province' ? '' : forecastSelection.category || '',
        provinceKey: forecastSelection.compareBy === 'province' ? '' : forecastSelection.provinceKey || '' };
    const [sourceProfile, setSourceProfile] = useState(null);
    const [geographicProfile, setGeographicProfile] = useState(null);
    const trendMetric = descriptiveMetric;
    const [forecastState, setForecastState] = useState(() => {
        const data = getCachedPredictive(forecastParams);
        return { data, error: "", loading: !data };
    });
    const [forecastComparison, setForecastComparison] = useState({ key: '', loading: false, series: [] });
    const forecastComparisonMode = forecastSelection.compareBy === 'province' && (forecastSelection.provinceKeys || []).length > 0
        ? 'province' : (forecastSelection.categories || []).length > 1 ? 'category' : '';
    const comparisonColorOptions = forecastComparisonMode === 'province'
        ? (analytics?.scope?.geography || []).flatMap(region => (region.provinces || []).map(name => `${name} · ${region.region}`))
        : (analytics?.scope?.categories || []).filter(name => !Array.isArray(scope.categories) || scope.categories.includes(name));
    const forecastComparisonKey = JSON.stringify({ forecastScope, forecastSettings, forecastSelection,
        mode: forecastComparisonMode, colorOptions: comparisonColorOptions });
    useEffect(() => {
        if (!forecastComparisonMode) {
            setForecastComparison({ key: forecastComparisonKey, loading: false, series: [] });
            return undefined;
        }
        const controller = new AbortController();
        const categories = forecastSelection.categories || [];
        const provinceKeys = forecastSelection.provinceKeys || [];
        const choices = forecastComparisonMode === 'province' ? provinceKeys : categories;
        setForecastComparison({ key: forecastComparisonKey, loading: true, series: [] });
        Promise.all(choices.map(async choice => {
            const label = forecastComparisonMode === 'province'
                ? (() => { try { const [region, province] = JSON.parse(choice); return `${province} · ${region}`; } catch { return choice; } })()
                : choice;
            const options = { scope: forecastScope, ...forecastSettings,
                category: forecastComparisonMode === 'category' ? choice : '',
                provinceKey: forecastComparisonMode === 'province' ? choice : '',
                chartOnly: true };
            try {
                const result = await fetchPredictive(options, controller.signal);
                return { name: label, color: categorySeriesColor(label, comparisonColorOptions.length ? comparisonColorOptions : choices.map(item => {
                    if (forecastComparisonMode !== 'province') return item;
                    try { const [region, province] = JSON.parse(item); return `${province} · ${region}`; } catch { return item; }
                })), chart: result.chart };
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                return { name: label, error: error.message, chart: null };
            }
        })).then(series => {
            if (!controller.signal.aborted) setForecastComparison({ key: forecastComparisonKey, loading: false, series });
        }).catch(() => {
            if (!controller.signal.aborted) setForecastComparison({ key: forecastComparisonKey, loading: false, series: [] });
        });
        return () => controller.abort();
    }, [forecastComparisonKey]);

    const [prescriptiveState, setPrescriptiveState] = useState(() => {
        const data = getCachedPrescriptive({ scope, ...forecastSettings });
        return { data, error: "", loading: !data };
    });
    const [showPrescriptiveDetails, setShowPrescriptiveDetails] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        fetchProfile("/api/dataset-profile", controller.signal).then(profile => {
            // Counts that feed analytics (eligible lines/orders) so the cards reconcile with every KPI.
            setSourceProfile({
                filesImported: profile.filesImported,
                transactionLines: profile.eligibleLines,
                uniqueOrders: profile.eligibleOrders,
                uniqueProducts: profile.uniqueProducts,
                dateCoverage: profile.dateCoverage,
                loadedLines: profile.transactionLines,
                excludedLines: profile.excludedLines
            });
            setGeographicProfile({ regions: profile.regions, provinces: profile.provinces });
        }).catch(error => {
            if (error.name !== "AbortError") {
                setSourceProfile({ error: true, message: error.message });
                setGeographicProfile({ error: true });
            }
        });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const options = forecastParams;
        const cached = getCachedPredictive(options);
        let current = true;
        setForecastState({ data: cached, error: "", loading: !cached });
        fetchPredictive(options, controller.signal)
            .then(data => { if (current) setForecastState({ data, error: "", loading: false }); })
            .catch(error => {
                if (current && error.name !== "AbortError") {
                    setForecastState({ data: cached, error: error.message, loading: false });
                }
            });
        return () => { current = false; controller.abort(); };
    }, [JSON.stringify(scope), forecastSettings.target, forecastSettings.horizon, forecastSettings.model, forecastSettings.missingMonthMode, JSON.stringify(forecastParams)]);

    useEffect(() => {
        const controller = new AbortController();
        const options = { scope, ...forecastSettings };
        const cached = getCachedPrescriptive(options);
        let current = true;
        setPrescriptiveState({ data: cached, error: "", loading: !cached });
        fetchPrescriptive(options, controller.signal)
            .then(data => { if (current) setPrescriptiveState({ data, error: "", loading: false }); })
            .catch(error => {
                if (current && error.name !== "AbortError") {
                    setPrescriptiveState({ data: cached, error: error.message, loading: false });
                }
            });
        return () => { current = false; controller.abort(); };
    }, [JSON.stringify(scope), forecastSettings.target, forecastSettings.horizon, forecastSettings.model, forecastSettings.missingMonthMode]);

    const provinces = useMemo(() => (analytics?.regions || [])
        .flatMap(region => region.provinces || [])
        .sort((a, b) => (b.revenue || 0) - (a.revenue || 0)), [analytics]);
    const summary = analytics?.summary;
    const categories = analytics?.categories || [];
    const peakMonth = analytics?.trend?.length ? analytics.trend.reduce(
        (peak, row) => (row.revenue || 0) > (peak.revenue || 0) ? row : peak,
        analytics.trend[0]
    ) : null;
    const topProvince = provinces.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
    const topRevenueCategory = categories.slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
    const topVolumeCategory = categories.slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0))[0];
    const averageOrderSpend = summary?.orders > 0 && summary?.revenue > 0 ? summary.revenue / summary.orders : 0;
    const trendRows = analytics?.trend || [];
    const comparisonSeriesLabel = descriptiveFilters.compareBy === 'province' ? 'Province' : 'Product Category';
    const overviewCategorySeries = (descriptiveFilters.categories || []).map(name => {
        const category = (analytics?.categories || []).find(item => item.name === name);
        const monthly = new Map((category?.monthly || []).map(row => [row.name, row]));
        return { name, color: categorySeriesColor(name, (analytics?.scope?.categories || []).filter(item => !Array.isArray(scope.categories) || scope.categories.includes(item))),
            rows: trendRows.map(period => ({ ...period, ...(monthly.get(period.name) || { revenue: 0, orders: 0, quantity: 0, rows: 0 }) })) };
    });
    const overviewProvinceOptions = (analytics?.scope?.geography || []).flatMap(region =>
        (region.provinces || []).map(name => ({ value: provinceComparisonKey(region.region, name), label: `${name} · ${region.region}`, name, region: region.region })));
    const overviewProvinceSeries = descriptiveFilters.compareBy === 'province' && descriptiveFilters.provinces?.length
        ? buildProvinceTrendSeries({ regions: analytics?.regions || [], months: trendRows,
            selected: descriptiveFilters.provinces, available: overviewProvinceOptions }) : [];
    const overviewComparisonSeries = descriptiveFilters.compareBy === 'province' ? overviewProvinceSeries : overviewCategorySeries;
    const mom = descriptiveMonthOverMonth(trendRows, trendMetric.toLowerCase());
    const availableTrendYears = [...new Set(trendRows.filter(hasYoYValue).map(row => row.name.slice(0, 4)))].sort();
    const previousYear = availableTrendYears.includes(descriptivePreviousYear) ? descriptivePreviousYear : availableTrendYears.at(-2) || "";
    const currentYear = availableTrendYears.includes(descriptiveCurrentYear) ? descriptiveCurrentYear : availableTrendYears.at(-1) || "";
    const latestTrendRow = mom.latestMonth ? { name: mom.latestMonth } : null;
    const latestTrendValue = mom.latest;
    const trendChange = mom.change;
    const formattedLatestTrend = trendMetric === "Revenue"
        ? money(latestTrendValue)
        : latestTrendValue.toLocaleString("en-PH");
    const forecast = forecastState.data;
    const selectedForecastProvince = forecast?.options?.provinces?.find(item => item.key === forecastSelection.provinceKey);
    const forecastScopeLabel = scopeSelectionLabel(
        forecastSelection.categories || [],
        forecastSelection.compareBy === 'province' ? forecastSelection.provinceKeys || [] : [],
        forecastSelection.category || '', selectedForecastProvince?.name || ''
    );
    const prescriptiveData = prescriptiveState.data;
    const allScopePairs = prescriptiveData?.pairs || [];
    const allEligiblePairs = allScopePairs.filter(pair => pair.eligible);
    const prescriptiveCategory = prescriptiveSelection.category || "All Categories";
    const prescriptiveProvinceKey = prescriptiveSelection.provinceKey || '';
    const visibleOpportunity = pair => (prescriptiveCategory === 'All Categories' || pair.category === prescriptiveCategory)
        && (!prescriptiveProvinceKey || JSON.stringify([pair.region, pair.province]) === prescriptiveProvinceKey);
    const visibleEligibleCount = allEligiblePairs.filter(visibleOpportunity).length;
    const topOpportunities = [
        ...sortByReviewMetric(allEligiblePairs, prescriptiveReviewMetric),
        ...sortByReviewMetric(allScopePairs.filter(pair => !pair.eligible), prescriptiveReviewMetric)
    ].filter(visibleOpportunity).slice(0, 5);
    const prescriptivePairs = (prescriptiveData?.pairs || []).filter(pair =>
        visibleOpportunity(pair)
    );
    const eligiblePairs = prescriptivePairs.filter(pair => pair.eligible);
    const selectedPair = prescriptivePairs.find(pair => pair.key === prescriptiveSelection.pairKey)
        || eligiblePairs[0]
        || prescriptivePairs[0];
    const selectedPairRank = selectedPair?.eligible
        ? sortByReviewMetric(allEligiblePairs, prescriptiveReviewMetric).findIndex(pair => pair.key === selectedPair.key) + 1
        : null;
    const scoreFactors = selectedPair?.factors || {};

    return (
        <div className="executive-overview-page">
            <div className="overview-descriptive-layout">
                <p className="overview-filter-context" role="status">Descriptive overview: {descriptiveFilters.categories.length ? descriptiveFilters.categories.join(', ') : 'All Categories'} · {descriptiveFilters.compareBy === 'province' && descriptiveFilters.provinces.length ? `${descriptiveFilters.provinces.length} selected provinces` : descriptiveFilters.province || 'All Provinces'}. Dataset import counts below describe the full published source.</p>
                {descriptiveLoading && <p role="status">Updating descriptive overview…</p>}
                {descriptiveError && <p role="alert">Unable to refresh descriptive overview: {descriptiveError}</p>}
                {!descriptiveLoading && !descriptiveError && analytics?.summary?.rows === 0 && <p role="status">No published sales records match the current Descriptive filters.</p>}
                <div className="overview-analytics-row-label">Descriptive Analytics</div>
                <div className="overview-descriptive-left">
            <section className="overview-dataset-section" aria-labelledby="overview-dataset-title">
                <header className="overview-section-header">
                    <div>
                        <h1 id="overview-dataset-title">Dataset Overview</h1>
                    </div>
                </header>

                <div className="overview-dataset-grid">
                    <DatasetMetric icon={<FaDatabase />} label="Files Imported" value={formatSourceCount(sourceProfile, "filesImported")} />
                    <DatasetMetric icon={<FaFileAlt />} label="Transaction Lines" value={formatSourceCount(sourceProfile, "transactionLines")} hint={sourceProfile?.loadedLines != null ? `${number(sourceProfile.loadedLines)} lines loaded from Supabase; ${number(sourceProfile.excludedLines)} excluded (non-completed orders). Eligible lines are counted here.` : undefined} />
                    <DatasetMetric icon={<FaShoppingCart />} label="Unique Orders" value={formatSourceCount(sourceProfile, "uniqueOrders")} />
                    <DatasetMetric icon={<FaCalendarAlt />} label="Data Coverage" value={formatDateCoverage(sourceProfile?.dateCoverage)} />
                    <DatasetMetric icon={<FaCubes />} label="Product Listings" value={formatSourceCount(sourceProfile, "uniqueProducts")} />
                    <DatasetMetric
                        icon={<FaMapMarkedAlt />}
                        label="Geographic Coverage"
                        value={geographicProfile?.error
                            ? "Unavailable"
                            : geographicProfile
                                ? `${number(geographicProfile.regions)} Regions / ${number(geographicProfile.provinces)} Provinces`
                                : "Loading…"}
                    />
                </div>
            </section>

            <section className="overview-takeaways-section" aria-labelledby="overview-takeaways-title">
                <header className="overview-takeaways-header">
                    <div>
                        <h2 id="overview-takeaways-title">Key Business Takeaways</h2>
                        <p>Core commercial facts and sales benchmarks established from historical records.</p>
                    </div>
                    <span className="overview-benchmark-tag">Sales Benchmarks</span>
                </header>

                <div className="overview-takeaways-grid">
                    <Takeaway
                        tone="amber"
                        icon={<FaTrophy />}
                        label="Peak Sales Month"
                        value={peakMonth ? monthLabel(peakMonth.name) : "N/A"}
                        detail={<><b>{money(peakMonth?.revenue || 0)}</b> in record monthly revenue</>}
                    />
                    <Takeaway
                        tone="blue"
                        icon={<FaShoppingCart />}
                        label="Average Order Spend"
                        value={averageOrderSpend == null ? "Unavailable" : money(averageOrderSpend)}
                        detail={<>Across <b>{number(summary?.orders)}</b> completed customer orders</>}
                    />
                    <Takeaway
                        tone="green"
                        icon={<FaMapMarkerAlt />}
                        label="Top Buyer Province"
                        value={topProvince?.name || "N/A"}
                        detail={<>
                            <span>Drives <b>{percent(summary?.revenue > 0 && topProvince?.revenue ? topProvince.revenue / summary.revenue * 100 : 0)}</b> of total sales ({money(topProvince?.revenue || 0)})</span>
                            <PeriodAverages rows={topProvince?.monthly} periods={analytics?.trend} metric="revenue" />
                        </>}
                    />
                    <Takeaway
                        tone="indigo"
                        icon={<FaMoneyBillWave />}
                        label="Top Revenue Product"
                        value={topRevenueCategory?.name || "N/A"}
                        detail={<>
                            <span>Generates <b>{percent(summary?.revenue > 0 && topRevenueCategory?.revenue ? topRevenueCategory.revenue / summary.revenue * 100 : 0)}</b> of sales ({money(topRevenueCategory?.revenue || 0)})</span>
                            <PeriodAverages rows={topRevenueCategory?.monthly} periods={analytics?.trend} metric="revenue" />
                        </>}
                    />
                    <Takeaway
                        tone="purple"
                        icon={<FaCubes />}
                        label="Top Volume Product"
                        value={topVolumeCategory?.name || "N/A"}
                        detail={<>
                            <span>Represents <b>{percent(summary?.quantity > 0 && topVolumeCategory?.quantity ? topVolumeCategory.quantity / summary.quantity * 100 : 0)}</b> of units sold ({number(topVolumeCategory?.quantity || 0)} units)</span>
                            <PeriodAverages rows={topVolumeCategory?.monthly} periods={analytics?.trend} metric="quantity" />
                        </>}
                    />
                </div>
            </section>
                </div>

            <section className="rd-card overview-trend-section" id="ov-trend" aria-labelledby="overview-trend-title">
                <div className="rd-card-head between overview-trend-heading">
                    <div>
                        <h2 id="overview-trend-title">Historical Trend</h2>
                        <p>Track sales performance over time across monthly periods.</p>
                    </div>
                    <div className="overview-heading-actions">
                        <div className="rd-segmented" aria-label="Historical trend measure">
                            {["Revenue", "Orders", "Quantity"].map(metric => (
                                <button
                                    key={metric}
                                    type="button"
                                    className={trendMetric === metric ? "active" : ""}
                                    aria-pressed={trendMetric === metric}
                                    onClick={() => onDescriptiveMetricChange(metric)}
                                >
                                    {metric}
                                </button>
                            ))}
                        </div>
                        <div className="rd-segmented" aria-label="Historical trend chart mode">
                            <button type="button" className={descriptiveTrendMode === "monthly" ? "active" : ""} aria-pressed={descriptiveTrendMode === "monthly"} onClick={() => onDescriptiveTrendModeChange("monthly")}>Monthly Trend</button>
                            <button type="button" className={descriptiveTrendMode === "yoy" ? "active" : ""} aria-pressed={descriptiveTrendMode === "yoy"} onClick={() => onDescriptiveTrendModeChange("yoy")}>Year-over-Year</button>
                        </div>
                        <button type="button" className="overview-analytics-link" aria-label="Open Descriptive Analytics" onClick={() => onNavigate("descriptive-analytics")}>
                            Descriptive analytics <FaArrowRight aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {trendRows.length && descriptiveTrendMode === "monthly" ? (
                    <DescriptiveTrendChart rows={trendRows} metric={trendMetric} series={overviewComparisonSeries} seriesLabel={comparisonSeriesLabel} />
                ) : trendRows.length ? (
                    <YearOverYearChart
                        rows={trendRows}
                        metric={trendMetric}
                        series={overviewComparisonSeries}
                        seriesLabel={comparisonSeriesLabel}
                        years={availableTrendYears}
                        previousYear={previousYear}
                        currentYear={currentYear}
                        onPreviousYearChange={onDescriptivePreviousYearChange}
                        onCurrentYearChange={onDescriptiveCurrentYearChange}
                    />
                ) : (
                    <div className="overview-trend-empty" role="status">
                        {analytics ? "No sales records match this scope." : "Loading historical analytics…"}
                    </div>
                )}

                {descriptiveTrendMode === "monthly" && <div className="rd-trend-foot overview-trend-foot">
                    <div>
                        <span>Latest complete month{latestTrendRow ? ` · ${monthLabel(latestTrendRow.name)}` : ""}</span>
                        <strong>{latestTrendRow ? formattedLatestTrend : "Unavailable"}</strong>
                    </div>
                    <div className={trendChange == null ? "" : trendChange >= 0 ? "positive" : "negative"}>
                        {trendChange !== null && (trendChange >= 0 ? <FaArrowUp aria-hidden="true" /> : <FaArrowDown aria-hidden="true" />)}
                        {trendChange == null
                            ? "N/A — see comparison note"
                            : `${Math.abs(trendChange).toFixed(1)}% vs ${monthLabel(mom.previousMonth)}`}
                    </div>
                </div>}
                {descriptiveTrendMode === "monthly" && mom.warning && <p className="descriptive-chart-caption" role="status">Comparison note: {mom.warning}</p>}
                {descriptiveTrendMode === "monthly" && mom.context.map((note, index) => <p key={`overview-mom-context-${index}`} className="descriptive-chart-caption">{note} The month is retained in chronological comparisons unless a data gap makes the comparison unreliable.</p>)}
                {descriptiveTrendMode === "monthly" && mom.partialMonths.length > 0 && <p className="descriptive-chart-caption">Incomplete periods ({mom.partialMonths.map(monthLabel).join(", ")}) remain visible with their recorded values. The MoM comparison uses the latest complete month and only its immediately preceding calendar month; it never skips a month to obtain a percentage.</p>}
            </section>
            </div>

            <div className="overview-predictive-layout">
            <div className="overview-analytics-row-label">Predictive Analytics</div>
            <section className="rd-card predictive-chart-card overview-predictive-chart" id="ov-predictive-chart" aria-labelledby="overview-predictive-chart-title">
                <div className="rd-card-head between">
                    <div>
                        <h2 id="overview-predictive-chart-title">Historical Sales vs Projected Demand</h2>
                        <p>{forecastScopeLabel} · monthly {forecast?.unit || "sales"} · {forecast?.model || "Forecast model"}. {forecastComparisonMode ? 'Each line represents a separately forecast category or province.' : 'Aggregated forecast for the selected population.'}</p>
                    </div>
                    <div className="overview-heading-actions">
                        {forecast && <span className={`predictive-status-pill ${forecast.chart.status}`}>
                            {forecast.chart.status === "available" ? "Forecast ready" : "Insufficient sales history"}
                        </span>}
                        <button type="button" className="overview-analytics-link" aria-label="Open Predictive Analytics" onClick={() => onNavigate("predictive-analytics")}>
                            Predictive analytics <FaArrowRight aria-hidden="true" />
                        </button>
                    </div>
                </div>
                {forecastComparisonMode && (forecastComparison.key !== forecastComparisonKey || forecastComparison.loading) ? (
                    <div className="overview-predictive-empty" role="status">Loading selected category/province comparisons…</div>
                ) : forecastComparisonMode ? (
                    <ForecastComparisonChart series={forecastComparison.series} target={forecastSettings.target}
                        seriesLabel={forecastComparisonMode === 'province' ? 'Province' : 'Product Category'} />
                ) : forecastState.loading && !forecast ? (
                    <div className="overview-predictive-empty" role="status">Loading historical demand and forecast…</div>
                ) : forecastState.error && !forecast ? (
                    <div className="overview-predictive-empty" role="alert">{forecastState.error}</div>
                ) : forecast?.chart?.history?.length ? (
                    <ForecastChart result={forecast.chart} target={forecast.target} />
                ) : (
                    <div className="overview-predictive-empty" role="status">No matching transactions are available for this scope.</div>
                )}
            </section>
            <DemandSignalsSection
                id="ov-predictive-signals"
                className="overview-predictive-signals"
                data={forecast}
                target={forecast?.target || forecastSettings.target}
                horizon={forecast?.horizon || forecastSettings.horizon}
                loading={forecastState.loading}
                error={forecastState.error}
            />
            </div>

            <section className="overview-prescriptive-section" aria-label="Prescriptive sales pattern review">
                <div className="overview-analytics-row-label">Prescriptive Analytics</div>
                {prescriptiveData?.status === 'returns_scope_not_supported' && <div className="rd-card" role="status">{prescriptiveData.message}</div>}
                {prescriptiveData && prescriptiveData.status !== 'returns_scope_not_supported' && <section className="rd-card prescriptive-notable-card overview-prescriptive-notable" id="ov-prescriptive-notable">
                    <div className="rd-card-head between">
                        <div>
                            <h2>Top opportunities within Prescriptive filters</h2>
                            <p>{reviewMetricDescription(prescriptiveReviewMetric, prescriptiveData.target)}</p>
                        </div>
                        <div className="prescriptive-review-controls">
                            <ReviewMetricFilter id="overview-areas-review-metric" value={prescriptiveReviewMetric} onChange={onPrescriptiveReviewMetricChange} />
                            <span className="rd-tag">{visibleEligibleCount ? `Top ${Math.min(5, visibleEligibleCount)} of ${visibleEligibleCount} matching areas with enough records` : "No eligible matching areas"}</span>
                        </div>
                    </div>
                    {topOpportunities.length ? <div className="prescriptive-notable-list">{topOpportunities.map((row, index) => <button
                        type="button"
                        key={row.key}
                        className={`prescriptive-notable ${prescriptiveSelection.pairKey === row.key ? "selected" : ""}`}
                        onClick={() => {
                            const category = prescriptiveSelection.category || "All Categories";
                            const nextCategory = category !== "All Categories" && row.category !== category ? "All Categories" : category;
                            onPrescriptiveSelectionChange({ category: nextCategory, provinceKey: prescriptiveSelection.provinceKey || '', pairKey: row.key });
                        }}
                    >
                        <span className="prescriptive-notable-rank" title="Position within the filtered shortlist">{index + 1}</span>
                        <span className="prescriptive-notable-copy">
                            <strong>{row.province} <i>×</i> {row.category}</strong>
                            <small>{row.region} · Recent average: {monthlyDescription(row.demand, prescriptiveData.target)}</small>
                            <small title={reviewMetricDescription(prescriptiveReviewMetric, prescriptiveData.target, row)}>{reviewMetricLabel(prescriptiveReviewMetric)}: {reviewMetricDisplay(row, prescriptiveReviewMetric, prescriptiveData.target)}</small>
                        </span>
                        <StrategyBadge strategy={row.strategy} />
                        <span className="prescriptive-arrow" aria-hidden="true">→</span>
                    </button>)}</div> : <div className="overview-prescriptive-status" role="status">No sales records match the current scope.</div>}
                    <button type="button" className="prescriptive-button secondary prescriptive-notable-view-all" onClick={() => onNavigate("prescriptive-analytics", "prescriptive-notable-opportunities")}>Open Prescriptive Analytics <span aria-hidden="true">→</span></button>
                </section>}
                {prescriptiveState.loading && !prescriptiveData ? (
                    <div className="rd-card overview-prescriptive-status" role="status">Loading prescriptive sales review…</div>
                ) : prescriptiveState.error && !prescriptiveData ? (
                    <div className="rd-card overview-prescriptive-status" role="alert">{prescriptiveState.error}</div>
                ) : selectedPair ? (
                    <>
                        <article className={`prescriptive-featured overview-prescriptive-featured ${selectedPair.eligible ? "" : "insufficient"}`}>
                            <div className="prescriptive-featured-kicker">
                                <span>{selectedPair.eligible ? "SALES PATTERN REVIEW" : "MORE RECORDS NEEDED"}</span>
                                <span>{prescriptiveCategory === 'All Categories' ? 'All categories' : prescriptiveCategory}{prescriptiveProvinceKey ? ' · Filtered province' : ''}</span>
                                {selectedPairRank && <span className="prescriptive-rank">Priority rank #{selectedPairRank}</span>}
                            </div>
                            <div className="prescriptive-featured-main">
                                <div className="prescriptive-featured-place">
                                    <span>{selectedPair.category}</span>
                                    <h2>{selectedPair.province}</h2>
                                    <small>{selectedPair.region}</small>
                                    <StrategyBadge strategy={selectedPair.strategy} />
                                </div>
                                <div className={`prescriptive-featured-metrics ${showPrescriptiveDetails ? "expanded" : ""}`}>
                                    <OverviewMetric
                                        label={prescriptiveData.target === "revenue" ? "Average Monthly Sales" : prescriptiveData.target === "orders" ? "Average Monthly Orders" : "Average Units Sold per Month"}
                                        value={metricValue(selectedPair.demand, prescriptiveData.target)}
                                    />
                                    <OverviewMetric
                                        label={prescriptiveData.target === "revenue" ? "Estimated Monthly Sales" : prescriptiveData.target === "orders" ? "Estimated Monthly Orders" : "Estimated Units Sold per Month"}
                                        value={selectedPair.forecastAvailable ? metricValue(selectedPair.forecastDemand, prescriptiveData.target) : "Unavailable"}
                                    />
                                    <OverviewMetric
                                        label="Estimated Monthly Change"
                                        value={selectedPair.forecastAvailable && selectedPair.forecastDemand != null && selectedPair.demand != null
                                            ? metricValue(Number(selectedPair.forecastDemand) - Number(selectedPair.demand), prescriptiveData.target)
                                            : "Unavailable"}
                                        tone={selectedPair.forecastAvailable && selectedPair.forecastDemand != null && selectedPair.demand != null
                                            ? selectedPair.forecastDemand - selectedPair.demand > 0 ? "positive" : selectedPair.forecastDemand - selectedPair.demand < 0 ? "negative" : ""
                                            : ""}
                                    />
                                    {showPrescriptiveDetails && <>
                                        <OverviewMetric label="Orders in Records" value={prescriptiveNumber(selectedPair.orders)} />
                                        <OverviewMetric label="Change Compared with Last Year" value={signedPercent(selectedPair.yoyGrowth)} />
                                        <OverviewMetric label="Forecast Growth" value={selectedPair.forecastAvailable ? signedPercent(selectedPair.forecastGrowth) : "Unavailable"} />
                                        <OverviewMetric label="Months with Sales Records" value={`${selectedPair.activeMonths} of ${selectedPair.calendarMonths} months`} />
                                        <OverviewMetric label="Past Estimate Check" value={selectedPair.forecastAvailable
                                            ? selectedPair.forecastMape == null ? "Not enough past sales to compare" : `About ${prescriptiveNumber(selectedPair.forecastMape)}% average error`
                                            : "No estimate available"} />
                                    </>}
                                    <button
                                        type="button"
                                        className="prescriptive-metrics-toggle-btn"
                                        aria-expanded={showPrescriptiveDetails}
                                        onClick={() => setShowPrescriptiveDetails(value => !value)}
                                    >
                                        {showPrescriptiveDetails ? "Hide extra details" : "Show extra details"}
                                    </button>
                                </div>
                            </div>
                            <div className="prescriptive-recommendation">
                                <div>
                                    <span>SALES PATTERN · WHAT THE RECORDS SHOW</span>
                                    <strong>{recommendationText(selectedPair)}</strong>
                                    <p>{evidenceSentence(selectedPair, prescriptiveData.target, prescriptiveData.horizon)}</p>
                                    <p className="prescriptive-next-step">{nextStepText(selectedPair)}</p>
                                    <button
                                        type="button"
                                        className="prescriptive-link-button"
                                        disabled={!selectedPair.category || !selectedPair.province}
                                        onClick={() => onViewPredictive({
                                            category: selectedPair.category,
                                            provinceKey: JSON.stringify([selectedPair.region, selectedPair.province]),
                                            pairKey: selectedPair.key,
                                            region: selectedPair.region,
                                            province: selectedPair.province
                                        })}
                                    >
                                        View {selectedPair.province} Sales Estimates and Trends →
                                    </button>
                                </div>
                            </div>
                        </article>

                        <section className="rd-card prescriptive-evidence-card overview-prescriptive-evidence">
                            <div className="rd-card-head between">
                                <div>
                                    <span className="prescriptive-section-kicker">SCORING EVIDENCE</span>
                                    <h2>Sales evidence for {selectedPair.province} <span>({selectedPair.category})</span></h2>
                                    <p>These four comparisons explain how this area’s sales result compares with other areas.</p>
                                </div>
                                <div className="overview-heading-actions">
                                    <span className={`prescriptive-eligibility ${selectedPair.eligible ? "eligible" : "insufficient"}`}>
                                        {selectedPair.eligible ? "✓ Minimum record requirements met" : "! More records needed"}
                                    </span>
                                    <button type="button" className="overview-analytics-link" aria-label="Open Prescriptive Analytics" onClick={() => onNavigate("prescriptive-analytics")}>
                                        Prescriptive analytics <FaArrowRight aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                            <div className="prescriptive-eligibility-grid">
                                <EvidenceCheck pass={selectedPair.orders >= prescriptiveData.minimumOrders} label={`At least ${prescriptiveData.minimumOrders} orders recorded (${prescriptiveNumber(selectedPair.orders)} found)`} />
                                <EvidenceCheck pass={selectedPair.activeMonths >= prescriptiveData.minimumActiveMonths} label={`Sales recorded in at least ${prescriptiveData.minimumActiveMonths} different months (${selectedPair.activeMonths} found)`} />
                                <EvidenceCheck pass={selectedPair.calendarMonths > 0} label={selectedPair.calendarMonths ? `${selectedPair.calendarMonths} months of records reviewed` : "No dated sales records found"} />
                                <EvidenceCheck pass={selectedPair.growthEvidenceAvailable} label={selectedPair.growthEvidenceAvailable ? "A change from last year or an estimate is available" : "Not enough history to show a change"} />
                                <EvidenceCheck pass={selectedPair.forecastAvailable} neutral={!selectedPair.forecastAvailable} label={selectedPair.forecastAvailable
                                    ? `${prescriptiveData.horizon}-month sales estimate is available`
                                    : "No sales estimate is available"} />
                            </div>
                            <div className="prescriptive-evidence-layout">
                                <div className="prescriptive-factor-list">
                                    <EvidenceFactor label="Sales Compared with Other Areas" score={scoreFactors.demandStrength} description={`Average monthly ${prescriptiveMetricName(prescriptiveData.target)}: ${metricValue(selectedPair.demand, prescriptiveData.target)}.`} tone="blue" />
                                    <EvidenceFactor label="Change in Sales" score={scoreFactors.growthMomentum} description={prescriptiveGrowthDescription(selectedPair)} tone="green" />
                                    <EvidenceFactor label="Months with Sales" score={scoreFactors.demandConsistency} description={`Sales were recorded in ${selectedPair.activeMonths} of ${selectedPair.calendarMonths} months reviewed.`} tone="purple" />
                                    <EvidenceFactor label="Share of Local Sales" score={scoreFactors.categoryAffinity} description={selectedPair.categoryShare == null || selectedPair.overallCategoryShare == null
                                        ? "Sales share comparison is unavailable."
                                        : `${prescriptiveNumber(selectedPair.categoryShare)}% of revenue here, compared with ${prescriptiveNumber(selectedPair.overallCategoryShare)}% across the areas in this report.`} tone="amber" />
                                </div>
                                <div className="prescriptive-score-card">
                                    <span>Sales Comparison Score</span>
                                    <strong>{selectedPair.opportunityScore == null ? "N/A" : prescriptiveNumber(selectedPair.opportunityScore)}</strong>
                                    <small>out of 100</small>
                                    <StrategyBadge strategy={selectedPair.strategy} />
                                </div>
                            </div>
                            <p className="overview-prescriptive-note">This relative sales score summarizes demand, growth, sales consistency, and category share. It does not include inventory, costs, capacity, or marketing spend.</p>
                        </section>
                    </>
                ) : (
                    <div className="rd-card overview-prescriptive-status" role="status">No sales records match the current scope.</div>
                )}
            </section>
        </div>
    );
}

function DatasetMetric({ icon, label, value, hint }) {
    return (
        <article className="overview-dataset-card" title={hint}>
            <span className="overview-dataset-icon" aria-hidden="true">{icon}</span>
            <span className="overview-dataset-label">{label}</span>
            <strong className="overview-dataset-value">{value}</strong>
        </article>
    );
}

function Takeaway({ tone, icon, label, value, detail }) {
    return (
        <article className={`overview-takeaway-card ${tone}`}>
            <div className="overview-takeaway-kicker">
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
            </div>
            <strong className="overview-takeaway-value" title={value}>{value}</strong>
            <div className="overview-takeaway-detail">{detail}</div>
        </article>
    );
}

function OverviewMetric({ label, value, tone = "" }) {
    return <div className={`prescriptive-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EvidenceCheck({ pass, label, neutral = false }) {
    return <span className={pass ? "pass" : neutral ? "neutral" : "fail"}><b aria-hidden="true">{pass ? "✓" : neutral ? "i" : "!"}</b>{label}</span>;
}

function EvidenceFactor({ label, score, description, tone }) {
    const value = score == null || !Number.isFinite(Number(score)) ? null : Math.max(0, Math.min(100, Number(score)));
    return (
        <div className={`prescriptive-factor ${tone}`}>
            <div className="prescriptive-factor-head"><strong>{label}</strong><b>{value == null ? "N/A" : `${prescriptiveNumber(value)} / 100`}</b></div>
            <div className="prescriptive-progress"><span style={{ width: `${value || 0}%` }} /></div>
            <small>{description}</small>
        </div>
    );
}

function signedPercent(value) {
    return value == null || !Number.isFinite(Number(value))
        ? "Unavailable"
        : `${Number(value) > 0 ? "+" : ""}${prescriptiveNumber(value)}%`;
}

function prescriptiveMetricName(target) {
    return target === "revenue" ? "sales" : target === "orders" ? "orders" : "units sold";
}

function prescriptiveGrowthDescription(row) {
    const details = [];
    if (row.yoyGrowth != null) details.push(`${signedPercent(row.yoyGrowth)} compared with the previous year`);
    if (row.forecastAvailable && row.forecastGrowth != null) details.push(`forecast change of ${signedPercent(row.forecastGrowth)} vs recent average`);
    return details.length ? details.join("; ") : "There is not enough history to show a change.";
}

function formatSourceCount(profile, key) {
    if (profile?.error) return "Unavailable";
    return profile ? number(profile[key]) : "Loading…";
}

function formatDateCoverage(coverage) {
    if (!coverage?.min || !coverage?.max) return coverage ? "Unavailable" : "Loading…";
    return `${monthLabel(coverage.min)} – ${monthLabel(coverage.max)}`;
}

async function fetchProfile(path, signal) {
    const response = await fetch(path, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the dataset profile.");
    return data;
}
