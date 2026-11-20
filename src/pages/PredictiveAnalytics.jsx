import { useEffect, useMemo, useRef, useState } from 'react';
import { FaLightbulb, FaChartLine, FaInfoCircle, FaSlidersH } from 'react-icons/fa';
import CategoryMultiSelect from '../components/CategoryMultiSelect';
import { categorySeriesColor } from '../utils/categorySeriesColor';
import { narrowScope } from '../utils/analyticsFilterScope';
import { provinceComparisonKey } from '../utils/provinceComparison';
import { fetchPredictive, getCachedPredictive } from '../data/analyticsApi';
import DemandSignalsSection from '../components/DemandSignalsSection';
import { DEFAULT_FORECAST_SETTINGS } from '../data/forecastSettings';
import { describeAdjustment } from '../data/adjustmentText';
import { DEFAULT_SCOPE, monthLabel, useAnalytics } from '../hooks/useAnalytics';
import '../styles/analytics-redesign.css';
import '../styles/predictive.css';

const formatValue = (value, target) => {
    if (value == null || !Number.isFinite(Number(value))) return 'N/A';
    return new Intl.NumberFormat('en-PH', target === 'revenue'
        ? { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }
        : { maximumFractionDigits: 2 }).format(value);
};

const formatPercent = value => value == null ? 'N/A' : `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(value)}%`;
const formatChange = (current, forecast, target) => current == null || forecast == null ? 'N/A' : `${forecast - current > 0 ? '+' : ''}${formatValue(forecast - current, target)}`;
const HISTORICAL_BASELINE_EXPLANATION = 'Historical monthly baseline calculated from up to the latest 12 eligible model-series observations.';
const FORECAST_AGGREGATION_EXPLANATION = 'Forecasts are independently calculated at each geographic and product level. Aggregated forecasts may differ from the sum of individual forecasts.';
const forecastModelLabel = value => ({ arima: 'ARIMA', prophet: 'Prophet-style', random_forest: 'Random Forest Regression', auto: 'Auto (Least Error)' }[value] || value);
const missingMonthModeLabel = value => ({
    strict: 'Complete Sales History',
    confirmed_zero: 'Count Confirmed No-Sales Months',
    intermittent: 'For Occasional Sales'
}[value] || value);
const MISSING_MONTH_MODE_COPY = {
    strict: 'Use products with a complete sales history. Months with missing data are left out.',
    confirmed_zero: 'Count a month as zero sales only when records confirm there were no sales. Missing data is left out.',
    intermittent: 'For products that sell occasionally. Months with missing data are still left out.'
};
const emptyForecastMessage = mode => mode === 'strict'
    ? 'No province-category pairs meet strict history checks. Unknown missing months and incomplete records remain unavailable; review each pair’s eligibility reason below.'
    : 'No province-category pairs meet the selected forecasting requirements. Some categories may have intermittent sales or unresolved missing months. Review the eligibility details or select another handling mode.';
const reliabilityLabel = value => ({ very_low: 'Early projection', low: 'Moderate history', backtested: 'Backtested · beats last-month benchmark', backtested_weak: 'Backtested · no better than last-month benchmark', exploratory: 'Exploratory · limited validation' }[value] || 'Needs more history');
const provinceSelectionLabel = key => {
    if (!key) return 'All Provinces';
    try {
        const [region, province] = JSON.parse(key);
        return province ? `${province} · ${region}` : 'Selected province';
    } catch {
        return 'Selected province';
    }
};
const ROWS_PER_PAGE = 30;
const EMPTY_FORECAST_SELECTION = Object.freeze({ category: '', categories: [], provinceKey: '' });
const adjustmentInfo = (completeness, month) => {
    const rows = (completeness?.adjustments || []).filter(item => item.start?.slice(0, 7) <= month && item.end?.slice(0, 7) >= month && item.exclude_from_training);
    return { kinds: [...new Set(rows.map(item => item.kind))], reason: rows.find(item => item.reason)?.reason || '' };
};

export default function PredictiveAnalytics({ scope = DEFAULT_SCOPE, active = true, forecastSettings = DEFAULT_FORECAST_SETTINGS, onForecastSettingsChange = () => {}, forecastSelection = EMPTY_FORECAST_SELECTION, onForecastSelectionChange = () => {}, onViewPrescriptive = () => {}, onReturnToStrategy = () => {}, onExitPairForecast = () => {}, selectionRequest = null, prescriptiveReturn = null }) {
    const { data: scopeAnalytics } = useAnalytics(scope, active);
    const [target, setTarget] = useState(forecastSettings.target);
    const [horizon, setHorizon] = useState(forecastSettings.horizon);
    const [forecastModel, setForecastModel] = useState(forecastSettings.model);
    const [missingMonthMode, setMissingMonthMode] = useState(forecastSettings.missingMonthMode || 'strict');
    const [modelAssignment, setModelAssignment] = useState(forecastSettings.modelAssignment || null);
    const [category, setCategory] = useState(forecastSelection.category || '');
    const [chartCategories, setChartCategories] = useState(forecastSelection.categories || (forecastSelection.category ? [forecastSelection.category] : []));
    const [provinceKey, setProvinceKey] = useState(forecastSelection.provinceKey || '');
    const [compareBy, setCompareBy] = useState('category');
    const [comparisonProvinceKeys, setComparisonProvinceKeys] = useState([]);
    const [draftTarget, setDraftTarget] = useState(forecastSettings.target);
    const [draftHorizon, setDraftHorizon] = useState(forecastSettings.horizon);
    const [draftForecastModel, setDraftForecastModel] = useState(forecastSettings.model);
    const [draftMissingMonthMode, setDraftMissingMonthMode] = useState(forecastSettings.missingMonthMode || 'strict');
    const [draftCategories, setDraftCategories] = useState(forecastSelection.categories || (forecastSelection.category ? [forecastSelection.category] : []));
    const [draftProvinceKey, setDraftProvinceKey] = useState('');
    const [draftCompareBy, setDraftCompareBy] = useState('category');
    const [draftComparisonProvinceKeys, setDraftComparisonProvinceKeys] = useState([]);
    const [revision, setRevision] = useState(0);
    const [provincePage, setProvincePage] = useState(1);
    const [overviewPage, setOverviewPage] = useState(1);
    const [overviewView, setOverviewView] = useState('chart');
    const [highlightedOverviewKey, setHighlightedOverviewKey] = useState('');
    const [insufficientPage, setInsufficientPage] = useState(1);
    const [reliabilityPage, setReliabilityPage] = useState(1);
    const [rangePage, setRangePage] = useState(1);
    const [showReliabilityModal, setShowReliabilityModal] = useState(false);
    const [showForecastControlsModal, setShowForecastControlsModal] = useState(false);
    const [showCategoryForecast, setShowCategoryForecast] = useState(false);
    const [showProvinceForecast, setShowProvinceForecast] = useState(false);
    const forceRefresh = useRef(false);
    const resolvedRequestKey = useRef(null);
    const comparisonRefreshRevision = useRef(0);
    const scopeKey = JSON.stringify(scope);
    const comparisonScope = useMemo(() => narrowScope(scope, {
        categories: chartCategories,
        provinceKeys: compareBy === 'province' ? comparisonProvinceKeys : []
    }), [scope, compareBy, chartCategories, comparisonProvinceKeys]);
    const comparisonProvinceMode = compareBy === 'province' && comparisonProvinceKeys.length > 0;
    const categoryComparisonMode = compareBy === 'category' && chartCategories.length > 1;
    const showForecastComparison = categoryComparisonMode || comparisonProvinceMode;
    const requestKey = JSON.stringify({ scopeKey, target, horizon, forecastModel, missingMonthMode, category, provinceKey, compareBy, categories: chartCategories, revision });
    const [state, setState] = useState(() => {
        const data = getCachedPredictive({ scope: comparisonScope, target, horizon, model: forecastModel, missingMonthMode, category: compareBy === 'province' ? '' : category, provinceKey: compareBy === 'province' ? '' : provinceKey });
        return { key: data ? requestKey : '', loading: !data, data };
    });
    const categoryForecastModel = modelAssignment?.requested === 'auto' ? 'auto' : forecastModel;
    const comparisonRequestKey = JSON.stringify({ scopeKey, target, horizon, model: categoryForecastModel, missingMonthMode, compareBy, provinceKey, provinceKeys: comparisonProvinceKeys, categories: chartCategories, revision });
    const [comparisonState, setComparisonState] = useState({ key: '', loading: false, series: [] });

    useEffect(() => {
        if (!highlightedOverviewKey) return undefined;
        const timeout = window.setTimeout(() => setHighlightedOverviewKey(''), 2400);
        return () => window.clearTimeout(timeout);
    }, [highlightedOverviewKey]);

    useEffect(() => {
        setTarget(forecastSettings.target);
        setHorizon(forecastSettings.horizon);
        setForecastModel(forecastSettings.model);
        setMissingMonthMode(forecastSettings.missingMonthMode || 'strict');
        setModelAssignment(forecastSettings.modelAssignment || null);
        setDraftTarget(forecastSettings.target);
        setDraftHorizon(forecastSettings.horizon);
        setDraftForecastModel(forecastSettings.model);
        setDraftMissingMonthMode(forecastSettings.missingMonthMode || 'strict');
    }, [forecastSettings.target, forecastSettings.horizon, forecastSettings.model, forecastSettings.missingMonthMode, forecastSettings.modelAssignment]);

    useEffect(() => {
        setCategory('');
        setChartCategories([]);
        setProvinceKey('');
        setCompareBy('category');
        setComparisonProvinceKeys([]);
        setDraftCategories([]);
        setDraftProvinceKey('');
        setDraftCompareBy('category');
        setDraftComparisonProvinceKeys([]);
    }, [scopeKey]);

    useEffect(() => {
        const nextCategory = forecastSelection.category || '';
        const nextProvinceKey = forecastSelection.provinceKey || '';
        const nextCategories = Array.isArray(forecastSelection.categories)
            ? forecastSelection.categories
            : (nextCategory ? [nextCategory] : []);
        setCategory(nextCategory);
        setChartCategories(nextCategories);
        setProvinceKey(nextProvinceKey);
        setDraftCategories(nextCategories);
        setDraftProvinceKey(nextProvinceKey);
    }, [forecastSelection.category, forecastSelection.provinceKey, JSON.stringify(forecastSelection.categories || [])]);

    useEffect(() => {
        if (!selectionRequest) return;
        setCompareBy('category');
        setDraftCompareBy('category');
        setComparisonProvinceKeys([]);
        setDraftComparisonProvinceKeys([]);
        setCategory(selectionRequest.category);
        setChartCategories(selectionRequest.category ? [selectionRequest.category] : []);
        setDraftCategories(selectionRequest.category ? [selectionRequest.category] : []);
        setProvinceKey(selectionRequest.provinceKey);
        setDraftProvinceKey(selectionRequest.provinceKey);
    }, [selectionRequest?.requestId]);

    useEffect(() => {
        setProvincePage(1);
        setOverviewPage(1);
        setInsufficientPage(1);
        setReliabilityPage(1);
        setRangePage(1);
    }, [scopeKey, target, horizon, forecastModel, missingMonthMode, category, provinceKey, revision]);

    useEffect(() => {
        if (!active || (!categoryComparisonMode && !comparisonProvinceMode)) {
            setComparisonState({ key: comparisonRequestKey, loading: false, series: [] });
            return undefined;
        }
        const controller = new AbortController();
        const refreshSeries = revision > comparisonRefreshRevision.current;
        if (refreshSeries) comparisonRefreshRevision.current = revision;
        setComparisonState({ key: comparisonRequestKey, loading: true, series: [] });
        const comparisonOptions = comparisonProvinceMode
            ? comparisonProvinceKeys.map(key => controlProvinces.find(item => item.key === key) || { key, name: provinceSelectionLabel(key), label: provinceSelectionLabel(key) })
            : chartCategories.map(name => ({ name, label: name }));
        Promise.all(comparisonOptions.map(async (item, index) => {
            try {
                const result = await fetchPredictive({
                    scope: comparisonScope,
                    target,
                    horizon,
                    model: categoryForecastModel,
                    missingMonthMode,
                    category: comparisonProvinceMode ? '' : item.name,
                    provinceKey: comparisonProvinceMode ? item.key : provinceKey,
                    chartOnly: true,
                    refresh: refreshSeries && index === 0
                }, controller.signal);
                const name = item.label || item.name;
                const colors = comparisonProvinceMode ? controlProvinces.map(province => province.label) : controlCategories;
                return { name, color: categorySeriesColor(name, colors), chart: result.chart, dataCompleteness: result.dataCompleteness };
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                const name = item.label || item.name;
                const colors = comparisonProvinceMode ? controlProvinces.map(province => province.label) : controlCategories;
                return { name, color: categorySeriesColor(name, colors), error: error.message, chart: null };
            }
        })).then(series => {
            if (!controller.signal.aborted) setComparisonState({ key: comparisonRequestKey, loading: false, series });
        }).catch(error => {
            if (error.name !== 'AbortError' && !controller.signal.aborted) setComparisonState({ key: comparisonRequestKey, loading: false, series: [] });
        });
        return () => controller.abort();
    }, [active, comparisonRequestKey, categoryComparisonMode, comparisonProvinceMode, comparisonProvinceKeys, chartCategories, comparisonScope, scope, target, horizon, forecastModel, missingMonthMode, provinceKey, revision]);

    useEffect(() => {
        if (!active) return undefined;
        if (resolvedRequestKey.current === requestKey && !forceRefresh.current) return undefined;
        resolvedRequestKey.current = null;
        const controller = new AbortController();
        const requestParams = {
            scope: comparisonScope,
            target,
            horizon,
            model: forecastModel,
            missingMonthMode,
            category: compareBy === 'province' ? '' : category,
            provinceKey: compareBy === 'province' ? '' : provinceKey
        };
        const cached = forceRefresh.current ? null : getCachedPredictive(requestParams);
        if (cached) {
            if (cached.modelAssignment?.assignedModel) {
                const assignment = cached.modelAssignment;
                const assignedModel = assignment.assignedModel;
                const assignedSettings = { target, horizon, model: assignedModel, modelAssignment: assignment, missingMonthMode };
                const assignedKey = JSON.stringify({ scopeKey, target, horizon, forecastModel: assignedModel, missingMonthMode, category: compareBy === 'province' ? '' : category, provinceKey: compareBy === 'province' ? '' : provinceKey, compareBy, categories: chartCategories, revision });
                setModelAssignment(assignment);
                setForecastModel(assignedModel);
                setDraftForecastModel(assignedModel);
                onForecastSettingsChange(assignedSettings);
                resolvedRequestKey.current = assignedKey;
                setState({ key: assignedKey, loading: false, data: cached });
            } else {
                resolvedRequestKey.current = requestKey;
                setState({ key: requestKey, loading: false, data: cached });
            }
            return () => controller.abort();
        }
        setState({ key: requestKey, loading: true });

        async function load() {
            try {
                const refresh = forceRefresh.current;
                forceRefresh.current = false;
                const result = await fetchPredictive({
                    ...requestParams,
                    refresh
                }, controller.signal);
                if (result.modelAssignment?.assignedModel) {
                    const assignment = result.modelAssignment;
                    const assignedModel = assignment.assignedModel;
                    const assignedSettings = { target, horizon, model: assignedModel, modelAssignment: assignment, missingMonthMode };
                    const assignedKey = JSON.stringify({ scopeKey, target, horizon, forecastModel: assignedModel, missingMonthMode, category: compareBy === 'province' ? '' : category, provinceKey: compareBy === 'province' ? '' : provinceKey, compareBy, categories: chartCategories, revision });
                    setModelAssignment(assignment);
                    setForecastModel(assignedModel);
                    setDraftForecastModel(assignedModel);
                    onForecastSettingsChange(assignedSettings);
                    resolvedRequestKey.current = assignedKey;
                    setState({ key: assignedKey, loading: false, data: result });
                } else {
                    resolvedRequestKey.current = requestKey;
                    setState({ key: requestKey, loading: false, data: result });
                }
            } catch (error) {
                if (error.name !== 'AbortError') setState({ key: requestKey, loading: false, error: error.message });
            }
        }

        load();
        return () => controller.abort();
    }, [scopeKey, target, horizon, forecastModel, missingMonthMode, category, provinceKey, compareBy, chartCategories, revision, requestKey, active, comparisonScope, onForecastSettingsChange]);

    const current = state.key === requestKey ? state : (() => {
        const data = getCachedPredictive({ scope: comparisonScope, target, horizon, model: forecastModel, missingMonthMode, category: compareBy === 'province' ? '' : category, provinceKey: compareBy === 'province' ? '' : provinceKey });
        return data ? { key: requestKey, loading: false, data } : { loading: true };
    })();
    const data = current.data;
    const loading = current.loading;
    const controlCategories = (scopeAnalytics?.scope?.categories || data?.options.categories || [])
        .filter(name => !Array.isArray(scope.categories) || scope.categories.includes(name));
    const controlProvinces = scopeAnalytics?.scope?.geography?.flatMap(region => region.provinces.map(name => ({ key: provinceComparisonKey(region.region, name), name, region: region.region, label: `${name} · ${region.region}` })))
        || data?.options.provinces?.map(item => ({ ...item, label: `${item.name} · ${item.region}` })) || [];
    const selectedProvince = controlProvinces.find(item => item.key === provinceKey);
    const selectedProvinceLabel = selectedProvince
        ? `${selectedProvince.name} · ${selectedProvince.region}`
        : provinceSelectionLabel(provinceKey);
    const selectedCategoriesLabel = chartCategories.length ? chartCategories.join(', ') : 'All Categories';
    const selectedCategoriesSummaryLabel = chartCategories.length > 1 ? `${chartCategories.length} categories picked` : selectedCategoriesLabel;
    const comparisonProvinceLabels = comparisonProvinceKeys.map(key => controlProvinces.find(item => item.key === key)?.label || provinceSelectionLabel(key));
    const comparisonProvinceSummaryLabel = comparisonProvinceKeys.length > 1
        ? `${comparisonProvinceKeys.length} provinces picked`
        : comparisonProvinceLabels.length ? comparisonProvinceLabels.join(', ') : 'All Provinces';
    const selectionLabel = compareBy === 'province' && comparisonProvinceKeys.length
        ? `${comparisonProvinceKeys.length} selected provinces × ${selectedCategoriesLabel}`
        : `${selectedProvince?.name || 'All Provinces'} × ${selectedCategoriesLabel}`;
    const targetLabel = target === 'revenue' ? 'Revenue' : target === 'orders' ? 'Orders' : 'Units Sold';
    const globalCategoriesLabel = scope.categories == null
        ? 'All Categories'
        : scope.categories.length ? scope.categories.join(', ') : 'No Categories';
    const globalPeriodLabel = scope.period === 'Custom Range'
        ? `${scope.start || 'Start date'} – ${scope.end || 'End date'}`
        : scope.period || 'All Available Data';
    const hasPendingChanges = draftTarget !== target || draftHorizon !== horizon || draftForecastModel !== forecastModel || draftMissingMonthMode !== missingMonthMode
        || JSON.stringify([...draftCategories].sort()) !== JSON.stringify([...chartCategories].sort())
        || draftProvinceKey !== provinceKey || draftCompareBy !== compareBy
        || JSON.stringify([...draftComparisonProvinceKeys].sort()) !== JSON.stringify([...comparisonProvinceKeys].sort());

    function generateForecast() {
        setTarget(draftTarget);
        setHorizon(draftHorizon);
        setForecastModel(draftForecastModel);
        setMissingMonthMode(draftMissingMonthMode);
        setModelAssignment(null);
        setCompareBy(draftCompareBy);
        setComparisonProvinceKeys([...draftComparisonProvinceKeys]);
        onForecastSettingsChange({ target: draftTarget, horizon: draftHorizon, model: draftForecastModel, missingMonthMode: draftMissingMonthMode, modelAssignment: null });
        const selectedCategory = draftCompareBy === 'category' && draftCategories.length === 1 ? draftCategories[0] : '';
        setCategory(selectedCategory);
        setChartCategories([...draftCategories]);
        setProvinceKey(draftProvinceKey);
        onForecastSelectionChange({ category: selectedCategory, categories: [...draftCategories], provinceKey: draftProvinceKey,
            compareBy: draftCompareBy, provinceKeys: [...draftComparisonProvinceKeys] });
    }

    function openForecastControls() {
        setDraftTarget(target);
        setDraftHorizon(horizon);
        setDraftForecastModel(forecastModel);
        setDraftMissingMonthMode(missingMonthMode);
        setDraftCategories([...chartCategories]);
        setDraftProvinceKey(provinceKey);
        setDraftCompareBy(compareBy);
        setDraftComparisonProvinceKeys([...comparisonProvinceKeys]);
        setShowForecastControlsModal(true);
    }

    function closeForecastControls() {
        setDraftTarget(target);
        setDraftHorizon(horizon);
        setDraftForecastModel(forecastModel);
        setDraftMissingMonthMode(missingMonthMode);
        setDraftCategories([...chartCategories]);
        setDraftProvinceKey(provinceKey);
        setDraftCompareBy(compareBy);
        setDraftComparisonProvinceKeys([...comparisonProvinceKeys]);
        setShowForecastControlsModal(false);
    }

    function applyForecastControls() {
        generateForecast();
        setShowForecastControlsModal(false);
    }

    function selectOverviewProvince(row) {
        setDraftProvinceKey(JSON.stringify([row.region, row.province]));
        document.getElementById('pa-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function selectOverviewCategory(row) {
        setDraftCategories([row.category]);
        document.getElementById('pa-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function selectOverviewPair(row) {
        setDraftProvinceKey(JSON.stringify([row.region, row.province]));
        setDraftCategories([row.category]);
        document.getElementById('pa-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function navigateToOverview(row) {
        setHighlightedOverviewKey(row.key);
        document.getElementById('pa-overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    useEffect(() => {
        if (!showForecastControlsModal) return undefined;
        const handleKeyDown = event => {
            if (event.key === 'Escape') closeForecastControls();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showForecastControlsModal, target, horizon, forecastModel, category, provinceKey]);

    function exitPairForecast() {
        setCategory('');
        setChartCategories([]);
        setProvinceKey('');
        setDraftCategories([]);
        setDraftProvinceKey('');
        onExitPairForecast();
    }

    function regenerate() {
        forceRefresh.current = true;
        setRevision(value => value + 1);
    }

    const monthlyDemandVal = data ? formatValue(data.chart.forecastDemand, target) : '';
    const totalHorizonVal = data?.chart.forecastDemand != null ? formatValue(data.chart.forecastDemand * data.horizon, target) : '';
    const unitWord = target === 'revenue' ? 'revenue' : target === 'orders' ? 'orders' : 'product units';
    const growthVal = data ? formatPercent(data.chart.growth) : '';
    const isGrowthPos = data && data.chart.growth > 0;
    const isGrowthNeg = data && data.chart.growth < 0;
    const readyPairs = data?.options.forecastablePairs || 0;
    const totalPairs = data?.options.totalPairs || 0;
    const selectedValidatedPairs = data?.overview.filter(row => row.forecastStatus === 'Available — Validated' || (!row.forecastStatus && row.reliability === 'backtested')).length || 0;
    const selectedExploratoryPairs = (data?.overview.length || 0) - selectedValidatedPairs;
    const unavailablePairCount = data?.insufficient.length || 0;
    const readyPct = totalPairs > 0 ? Math.round((readyPairs / totalPairs) * 100) : 0;
    return <div className="rd-page predictive-page">
        <header className="rd-header" id="pa-parameters">
            <div>
                <span className="rd-eyebrow">PREDICTIVE ANALYTICS</span>
                <div className="predictive-page-title">
                    <h1>Demand Forecast</h1>
                    <AggregationHelp id="demand-forecast" />
                </div>
                <p>Compare expected demand across product categories and provinces, then inspect any province × category forecast.</p>
            </div>
            <div className="rd-header-note predictive-header-note" aria-label="Active forecast settings">
                <div className="predictive-header-note-title">
                    <span>Forecast settings</span>
                    <button type="button" className="predictive-edit-settings" onClick={openForecastControls}>
                        <FaSlidersH aria-hidden="true" /> Edit settings
                    </button>
                </div>
                <div className="predictive-header-settings-scroll">
                    <div className="predictive-header-settings-grid">
                        <div><small>Sales metric</small><strong>{targetLabel}</strong></div>
                        <div><small>Product category</small><strong>{selectedCategoriesSummaryLabel}</strong></div>
                        <div><small>{compareBy === 'province' ? 'Compared provinces' : 'Province'}</small><strong>{compareBy === 'province' ? comparisonProvinceSummaryLabel : selectedProvinceLabel}</strong></div>
                        <div><small>Forecast duration</small><strong>{horizon} months</strong></div>
                        <div><small>Model preference</small><strong>{forecastModelLabel(forecastModel)}</strong>{modelAssignment?.requested === 'auto' && <em className="predictive-auto-assigned-label">Auto-assigned · earlier-window RMSE</em>}</div>
                        <div><small>Missing-month handling</small><strong>{missingMonthModeLabel(missingMonthMode)}</strong></div>
                    </div>
                </div>
                {data?.dataCompleteness?.partialMonths?.length > 0 && <p className="predictive-inline-warning" role="status">Forecasts use complete months only. {data.dataCompleteness.partialMonths.map(monthLabel).join(', ')} {data.dataCompleteness.partialMonths.length === 1 ? 'is' : 'are'} excluded because the data runs only through {data.dataCompleteness.dataThrough}.</p>}
                {data?.notes?.map(note => <p key={note} className="predictive-method-note">{note}</p>)}
                <p className="predictive-header-global-scope">
                    Analysis scope: {scope.region || 'All Regions'} · {scope.province || 'All Provinces'} · {globalCategoriesLabel} · {globalPeriodLabel} · {scope.returns || 'Include All'}
                </p>
            </div>
        </header>

        {loading && <p className="predictive-status" role="status">Loading scoped history and calculating forecasts…</p>}
        {current.error && <section className="rd-card predictive-error" role="alert"><h2>Forecast unavailable</h2><p>{current.error}</p><button type="button" className="rd-link-button" onClick={regenerate}>Retry</button></section>}

        {data && <>
            <section className="rd-card predictive-chart-card" id="pa-chart">
                <div className="rd-card-head between">
                    <div>
                        <h2>Historical Sales vs Projected Demand</h2>
                <p>{selectionLabel} · monthly {data.unit} · {showForecastComparison ? `each comparison series uses its own history and ${categoryForecastModel === 'auto' ? 'automatic model selection' : forecastModelLabel(categoryForecastModel)}` : data.chart.model || forecastModelLabel(forecastModel)}</p>
                    </div>
                <div className="predictive-chart-head-actions">
                        <span className={`predictive-status-pill ${showForecastComparison || data.chart.status === 'available' ? 'available' : data.chart.status}`}>{showForecastComparison ? (compareBy === 'province' ? 'Province comparison' : 'Category comparison') : data.chart.forecastStatus || (data.chart.status === 'available' ? 'Forecast ready' : 'Insufficient sales history')}</span>
                    </div>
                </div>
                {showForecastComparison
                    ? comparisonState.key !== comparisonRequestKey || comparisonState.loading
                        ? <p className="predictive-status" role="status">Calculating a separate forecast for each selected {compareBy}…</p>
                        : <ForecastComparisonChart series={comparisonState.series} target={target} seriesLabel={compareBy === 'province' ? 'Province' : 'Product Category'} />
                    : data.chart.history.length ? <ForecastChart result={data.chart} target={target} dataCompleteness={data.dataCompleteness} /> : <EmptyState message="No matching transactions are available for this scope." />}
                {!showForecastComparison && data.chart.status !== 'available' && data.chart.history.length > 0 && <p className="predictive-inline-warning">{data.chart.reason}</p>}
                {!showForecastComparison && data.chart.modelSelection && <p className="predictive-method-note">{data.chart.modelSelection.criteria}. Selected method: {forecastModelLabel(data.chart.modelSelection.selected)}. Earlier selection errors: {data.chart.modelSelection.candidates.map(candidate => `${forecastModelLabel(candidate.model)} MAE ${formatValue(candidate.mae, target)}`).join('; ') || 'insufficient history'}. These candidate scores are not the independent final accuracy test.</p>}
                {!showForecastComparison && data.chart.forecastStatus === 'Available — Exploratory' && <p className="predictive-inline-warning" role="status">Exploratory forecast: the history or final holdout did not meet the validation rule. Treat this as an initial estimate, not a validated forecast. Its displayed holdout-error range is not a confidence interval.</p>}
            </section>

            <DemandSignalsSection
                id="pa-signals"
                data={data}
                target={target}
                horizon={horizon}
                onSelect={navigateToOverview}
            />

        {data && <div className="predictive-summary-shell">
          <section className="rd-card predictive-summary-card">
            <div className="predictive-summary-heading">
                <h2>Forecast Summary</h2>
                <button type="button" className="predictive-kpi-inspect-btn" onClick={() => setShowReliabilityModal(true)}>Inspect Accuracy &amp; Bounds ⓘ</button>
            </div>
            <section className="rd-kpi-grid predictive-kpis" aria-label="Forecast summary">
                <Kpi
                    label="Projected Monthly Demand"
                    value={monthlyDemandVal}
                    detail="Average projected sales per month across the selected duration"
                    meaning={`This ${monthlyDemandVal} is the forecasted average monthly ${unitWord} for ${selectionLabel} over the upcoming ${data.horizon} months using ${data.chart.model || forecastModelLabel(forecastModel)} (accumulating to ~${totalHorizonVal} over the entire ${data.horizon}-month horizon).`}
                />
                <Kpi
                    label="Projected Growth"
                    value={growthVal}
                    detail="Projected monthly average vs. historical baseline"
                    meaning={`${growthVal} compares the average projected month over the next ${data.horizon} months with the historical monthly baseline. ${HISTORICAL_BASELINE_EXPLANATION}${isGrowthPos ? ' The projection is above the baseline.' : isGrowthNeg ? ' The projection is below the baseline.' : ''} It is not a year-over-year figure and does not adjust for seasonality.${data.chart.growthWithinError ? ' This difference is smaller than the typical monthly forecast error of the backtest, so treat the direction as uncertain.' : ''}`}
                
                />
                <Kpi
                    label="Forecast-Ready Segments"
                    value={`${readyPairs} / ${totalPairs}`}
                    detail="Province × category pairs available in the selected mode"
                    meaning={`${readyPairs} of ${totalPairs} pairs (${readyPct}%) currently produce forecasts under ${missingMonthModeLabel(missingMonthMode)}. Check the Forecast Overview for each result’s validated or exploratory status.`}
                />
            </section>
          </section>
        </div>}

            <section className={`rd-card predictive-fit-card predictive-overview-card${highlightedOverviewKey ? ' overview-highlighted' : ''}`} id="pa-overview">
                <div className="rd-card-head between predictive-overview-head">
                    <div><div className="predictive-aggregation-section-title"><h2>Forecast Overview</h2><AggregationHelp id="forecast-overview" /></div><p>Ranked by average monthly forecast demand over the selected horizon. Use a row to open its category and province.</p><p className="predictive-mode-summary"><strong>Forecast Mode: {missingMonthModeLabel(missingMonthMode)}</strong> · {selectedValidatedPairs} validated · {selectedExploratoryPairs} exploratory · {unavailablePairCount} unavailable</p></div>
                    <div className="predictive-overview-actions">
                        <div className="rd-segmented predictive-overview-toggle" role="group" aria-label="Forecast Overview display mode">
                            <button type="button" className={overviewView === 'chart' ? 'active' : ''} aria-pressed={overviewView === 'chart'} onClick={() => setOverviewView('chart')}>Chart View</button>
                            <button type="button" className={overviewView === 'table' ? 'active' : ''} aria-pressed={overviewView === 'table'} onClick={() => setOverviewView('table')}>Table View</button>
                        </div>
                        <span className="rd-tag">{data.overview.length} forecastable pairs</span>
                    </div>
                </div>
                {overviewView === 'table' ? <>
                    <div className="forecast-panel-scroll">
                        {data.overview.length ? <div className="rd-table-wrap predictive-ranked-wrap"><table className="rd-table predictive-table"><thead><tr><th>Rank</th><th>Province</th><th>Region</th><th>Category</th><th>Current / month</th><th>Forecast / month</th><th>Growth</th><th>Trend</th><th>Sales History</th><th>Forecast Status</th></tr></thead><tbody>
                            {rowsForPage(data.overview, overviewPage).map((row, index) => {
                                const fcastStr = formatValue(row.forecastDemand, target);
                                const currentStr = formatValue(row.currentDemand, target);
                                const gStr = formatPercent(row.growth);
                                const historyTone = row.reliability === 'backtested'
                                    ? 'beats'
                                    : row.reliability === 'backtested_weak'
                                        ? 'weak'
                                        : 'unknown';
                                return <tr key={row.key} className={highlightedOverviewKey === row.key ? 'predictive-overview-row-highlighted' : ''}>
                                    <td>{(overviewPage - 1) * ROWS_PER_PAGE + index + 1}</td>
                                    <td><button type="button" className="predictive-select-link" onClick={() => selectOverviewProvince(row)} title={`Select ${row.province}`}>{row.province}</button></td>
                                    <td>{row.region}</td>
                                    <td><button type="button" className="predictive-select-link" onClick={() => selectOverviewCategory(row)} title={`Select ${row.category}`}>{row.category}</button></td>
                                    <td title={`Current average monthly demand: ${currentStr} for ${row.category} in ${row.province}. ${HISTORICAL_BASELINE_EXPLANATION}`}>{currentStr}</td>
                                    <td title={`Specific projected monthly demand: ${fcastStr} for ${row.category} in ${row.province}.`}>{fcastStr}</td>
                                    <td title={`Specific projected growth: ${gStr} relative to the historical monthly baseline. ${HISTORICAL_BASELINE_EXPLANATION}`}><span className={`predictive-overview-growth ${growthTone(row.growth)}`}>{gStr}</span></td>
                                    <td title={`Trend: ${trendLabel(row.trend)}`}><span className={`predictive-overview-trend ${trendTone(row.trend)}`}>{trendLabel(row.trend)}</span></td>
                                    <td title={`History coverage: ${row.coverage.calendarMonths} calendar months of data with ${reliabilityLabel(row.reliability)} reliability.`}>
                                        <span className={`predictive-overview-history ${historyTone}`}>
                                            <i aria-hidden="true" />
                                            {row.coverage.calendarMonths} mo - {reliabilityLabel(row.reliability)}
                                        </span>
                                    </td>
                                    <td>{row.forecastStatus || (row.reliability === 'backtested' ? 'Available — Validated' : 'Available — Exploratory')}<small className="predictive-status-text">{row.model}</small></td>
                                </tr>;
                            })}
                        </tbody></table></div> : <EmptyState message={emptyForecastMessage(missingMonthMode)} />}
                    </div>
                    <SectionPagination total={data.overview.length} page={overviewPage} setPage={setOverviewPage} label="Forecast overview" />
                </> : data.overview.length ? <ForecastOverviewChart rows={data.overview} target={target} onSelect={selectOverviewPair} highlightedKey={highlightedOverviewKey} /> : <EmptyState message={emptyForecastMessage(missingMonthMode)} />}
                {data.insufficient.length > 0 && <details className="predictive-insufficient">
                    <summary>Unavailable forecast pairs ({data.insufficient.length} pairs)</summary>
                    <p>Each pair includes an eligibility reason. Unknown gaps, incomplete periods, inactive demand, and insufficient verified history remain unavailable.</p>
                    <div className="rd-table-wrap"><table className="rd-table predictive-table"><thead><tr><th>Province</th><th>Region</th><th>Category</th><th>Orders</th><th>Available months</th><th>Requirement status</th></tr></thead><tbody>
                        {rowsForPage(data.insufficient, insufficientPage).map(row => <tr key={row.key}><td>{row.province}</td><td>{row.region}</td><td>{row.category}</td><td>{row.coverage.orders.toLocaleString()}</td><td>{row.coverage.activeMonths} / {row.coverage.calendarMonths}</td><td>{row.reason}</td></tr>)}
                    </tbody></table></div>
                    <SectionPagination total={data.insufficient.length} page={insufficientPage} setPage={setInsufficientPage} label="Insufficient history" />
                </details>}
            </section>

            {data.detail && (() => {
                const curDetailVal = formatValue(data.detail.currentDemand, target);
                const fcastDetailVal = formatValue(data.detail.forecastDemand, target);
                const chgDetailVal = formatChange(data.detail.currentDemand, data.detail.forecastDemand, target);
                const growthDetailVal = formatPercent(data.detail.growth);
                const endDetailVal = formatValue(data.detail.endDemand, target);
                const diffVal = data.detail.forecastDemand != null && data.detail.currentDemand != null ? data.detail.forecastDemand - data.detail.currentDemand : null;
                const diffStr = diffVal == null ? 'N/A' : `${diffVal > 0 ? '+' : ''}${formatValue(diffVal, target)}`;
                const isDetailPos = diffVal != null && diffVal > 0;
                const isDetailNeg = diffVal != null && diffVal < 0;

                return <section className="rd-card predictive-detail-card">
                    <div className="rd-card-head between"><div><h2>{data.detail.province} × {data.detail.category}</h2><p>{data.detail.region} · selected province and product category</p></div><div className="predictive-detail-actions">{prescriptiveReturn && <><button type="button" className="predictive-return-strategy" onClick={onReturnToStrategy}>← Return to this strategy</button><button type="button" className="predictive-return-overview" onClick={exitPairForecast}>Back to Predictive overview</button></>}<span className={`predictive-status-pill ${data.detail.status}`}>{data.detail.forecastStatus || (data.detail.status === 'available' ? 'Available' : 'Insufficient history')}</span></div></div>
                    {data.detail.status === 'available' ? <>
                        <div className="predictive-detail-grid">
                            <Metric
                                label="Current monthly average"
                                value={curDetailVal}
                                meaning={`This ${curDetailVal}/mo is the historical monthly baseline for ${unitWord} in ${data.detail.province} for ${data.detail.category}. ${HISTORICAL_BASELINE_EXPLANATION}`}
                            />
                            <Metric
                                label="Forecast monthly average"
                                value={fcastDetailVal}
                                meaning={`This ${fcastDetailVal}/mo is the projected average monthly demand for ${data.detail.category} in ${data.detail.province} over the upcoming ${horizon}-month period (${draftForecastModel.toUpperCase()} projection). Use this figure to budget monthly stock.`}
                            />
                            <Metric
                                label="Change / month"
                                value={chgDetailVal}
                                meaning={isDetailPos
                                    ? `A projected net gain of ${diffStr} each month compared to historical baseline. Plan to increase supplier orders by ~${formatValue(diffVal, target)}/mo to meet demand without stockouts.`
                                    : isDetailNeg
                                    ? `A projected net drop of ${diffStr} per month compared to baseline. Trim monthly replenishment by ~${formatValue(Math.abs(diffVal), target)}/mo to prevent excess holding costs.`
                                    : `A 0 net difference: Monthly demand is projected to match the historical baseline exactly.`
                                }
                            />
                            <Metric
                                label="Forecast growth"
                                value={growthDetailVal}
                                meaning={data.detail.growth > 0
                                    ? `An expansion of ${growthDetailVal} over baseline demand for ${data.detail.category} in ${data.detail.province}. Indicates healthy market traction and growing buyer demand.`
                                    : data.detail.growth < 0
                                    ? `A contraction of ${growthDetailVal} below baseline demand, indicating softer purchasing activity in this province.`
                                    : `A flat 0.0% growth: Demand trajectory is stable with no change from baseline sales.`
                                }
                            />
                            <Metric
                                label="Expected demand at horizon end"
                                value={endDetailVal}
                                meaning={`By Month ${horizon} (the final month of the ${horizon}-month forecast), monthly demand is predicted to reach ${endDetailVal}. Use this target to plan required end-of-period inventory capacity.`}
                            />
                        </div>
                        <p className="predictive-interpretation">{data.detail.category} in {data.detail.province} is projected to show {data.detail.trend.toLowerCase()} demand over the selected {horizon}-month horizon. This is forecast evidence, not a business recommendation.</p>
                    </> : <p className="predictive-inline-warning">{data.detail.reason || 'There is no transaction history for this province and category.'} {data.detail.coverage.orders ? `${data.detail.coverage.orders} orders across ${data.detail.coverage.activeMonths} active months.` : ''}</p>}
                </section>;
            })()}

            <div className="predictive-breakdown-stack" id="pa-breakdown">
                <section className={`rd-card predictive-fit-card predictive-category-card ${showCategoryForecast ? '' : 'forecast-collapsed'}`}>
                    <div className="rd-card-head between">
                        <div>
                            <div className="predictive-aggregation-section-title"><h2>Product Category Forecast</h2><AggregationHelp id="category-forecast" /></div>
                            <p>{selectedProvince ? `Categories within ${selectedProvince.name}` : 'Compare categories across the current analysis scope.'}</p>
                        </div>
                        <div className="predictive-section-actions">
                            <span className="rd-tag">{data.categoryRows.length} {data.categoryRows.length === 1 ? 'product category' : 'product categories'}</span>
                            <button type="button" className="predictive-collapse-toggle" aria-expanded={showCategoryForecast} aria-controls="product-category-forecast-table" onClick={() => setShowCategoryForecast(value => !value)}>
                                {showCategoryForecast ? 'Hide Product Category Forecast' : 'Show Product Category Forecast'}
                            </button>
                        </div>
                    </div>
                    <div className="rd-table-wrap" id="product-category-forecast-table" hidden={!showCategoryForecast}><table className="rd-table predictive-table"><thead><tr><th>Category</th><th>Current / month</th><th>Forecast / month</th><th>Change / month</th><th>Growth</th><th>Trend</th><th>Status</th></tr></thead><tbody>
                        {data.categoryRows.map(row => {
                            const curStr = formatValue(row.currentDemand, target);
                            const fcastStr = formatValue(row.forecastDemand, target);
                            const chgStr = formatChange(row.currentDemand, row.forecastDemand, target);
                            const gStr = formatPercent(row.growth);
                            return <tr key={row.category} className={draftCategories.includes(row.category) ? 'predictive-selected-row' : ''}>
                                    <td><button type="button" className="predictive-select-link" aria-pressed={draftCategories.includes(row.category)} onClick={() => setDraftCategories([row.category])} title={`Click to filter forecast chart to ${row.category}`}>{row.category}</button></td>
                                <td title={`Specific baseline: ${curStr}. ${HISTORICAL_BASELINE_EXPLANATION}`}>{curStr}</td>
                                <td title={`Specific forecast: ${fcastStr} average monthly sales projected over the next ${horizon} months.`}>{fcastStr}</td>
                                <td title={`Specific change: ${chgStr} net shift per month compared to historical baseline.`}>{chgStr}</td>
                                <td title={`Specific growth: ${gStr} expansion/contraction rate against past baseline.`}><span className={`predictive-overview-growth ${growthTone(row.growth)}`}>{gStr}</span></td>
                                <td title={`Trend classification: ${trendLabel(row.trend)} based on forecast regression.`}><span className={`predictive-overview-trend ${trendTone(row.trend)}`}>{trendLabel(row.trend)}</span></td>
                                <td><Status status={row.status} forecastStatus={row.forecastStatus} /></td>
                            </tr>;
                        })}
                        {!data.categoryRows.length && <tr><td colSpan="7">No categories are available in this scope.</td></tr>}
                    </tbody></table></div>
                </section>

                <section className={`rd-card predictive-fit-card predictive-province-card forecast-fixed-card ${showProvinceForecast ? '' : 'forecast-collapsed'}`}>
                    <div className="rd-card-head between">
                        <div>
                            <div className="predictive-aggregation-section-title"><h2>Province Forecast</h2><AggregationHelp id="province-forecast" /></div>
                            <p>{category ? `Where ${category} is forecast to perform.` : 'Compare provinces across the current analysis scope.'}</p>
                        </div>
                        <div className="predictive-section-actions">
                            <span className="rd-tag">{data.provinceRows.length} provinces</span>
                            <button type="button" className="predictive-collapse-toggle" aria-expanded={showProvinceForecast} aria-controls="province-forecast-table" onClick={() => setShowProvinceForecast(value => !value)}>
                                {showProvinceForecast ? 'Hide Province Forecast' : 'Show all Province Forecast'}
                            </button>
                        </div>
                    </div>
                    <div className="forecast-panel-scroll" id="province-forecast-table" hidden={!showProvinceForecast}><div className="rd-table-wrap"><table className="rd-table predictive-table"><thead><tr><th>Province</th><th>Region</th><th>Current / month</th><th>Forecast / month</th><th>Change / month</th><th>Growth</th><th>Trend</th><th>Status</th></tr></thead><tbody>
                        {rowsForPage(data.provinceRows, provincePage).map(row => {
                            const curStr = formatValue(row.currentDemand, target);
                            const fcastStr = formatValue(row.forecastDemand, target);
                            const chgStr = formatChange(row.currentDemand, row.forecastDemand, target);
                            const gStr = formatPercent(row.growth);
                            return <tr key={row.key} className={draftProvinceKey === row.key ? 'predictive-selected-row' : ''}>
                                <td><button type="button" className="predictive-select-link" aria-pressed={draftProvinceKey === row.key} onClick={() => setDraftProvinceKey(row.key)} title={`Click to filter forecast chart to ${row.name}`}>{row.name}</button></td>
                                <td>{row.region}</td>
                                <td title={`Specific baseline: ${curStr} average monthly sales in ${row.name}. ${HISTORICAL_BASELINE_EXPLANATION}`}>{curStr}</td>
                                <td title={`Specific forecast: ${fcastStr} average monthly sales projected in ${row.name}.`}>{fcastStr}</td>
                                <td title={`Specific change: ${chgStr} net shift per month in ${row.name}.`}>{chgStr}</td>
                                <td title={`Specific growth: ${gStr} projected growth in ${row.name}.`}><span className={`predictive-overview-growth ${growthTone(row.growth)}`}>{gStr}</span></td>
                                <td title={`Trend classification: ${trendLabel(row.trend)} in ${row.name}.`}><span className={`predictive-overview-trend ${trendTone(row.trend)}`}>{trendLabel(row.trend)}</span></td>
                                <td><Status status={row.status} forecastStatus={row.forecastStatus} /></td>
                            </tr>;
                        })}
                        {!data.provinceRows.length && <tr><td colSpan="8">No provinces are available in this scope.</td></tr>}
                    </tbody></table></div></div>
                    {showProvinceForecast && <SectionPagination total={data.provinceRows.length} page={provincePage} setPage={setProvincePage} label="Province forecast" />}
                </section>
            </div>

            <section className="predictive-handoff">
                <div><strong>Continue to Strategic Recommendations (Prescriptive Analytics)</strong><small>Explore automated action plans, target priorities, and resource allocation based on these forecasts.</small></div>
                <button type="button" onClick={onViewPrescriptive}>View Prescriptive Analytics <span aria-hidden="true">→</span></button>
            </section>

            {showForecastControlsModal && (
                <div className="prescriptive-lightbox-backdrop predictive-controls-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeForecastControls(); }}>
                    <section
                        className="prescriptive-lightbox predictive-controls-lightbox"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="predictive-controls-dialog-title"
                        onKeyDown={event => { if (event.key === 'Escape') closeForecastControls(); }}
                    >
                        <div className="prescriptive-lightbox-head">
                            <div>
                                <span>FORECAST CONTROLS</span>
                                <h2 id="predictive-controls-dialog-title">Edit Forecast Settings</h2>
                                <p>Choose the metric, product category, province, forecast duration, and model for this projection.</p>
                            </div>
                            <button type="button" aria-label="Close forecast settings" onClick={closeForecastControls}>×</button>
                        </div>
                        <div className="predictive-modal-control-scroll">
                            <div className="predictive-control-grid predictive-modal-control-grid">
                                <label className="rd-field"><span>Compare By</span><select value={draftCompareBy} onChange={event => setDraftCompareBy(event.target.value)}><option value="category">Product Category</option><option value="province">Province</option></select></label>
                                <label className="rd-field"><span>Sales Metric</span><select value={draftTarget} onChange={event => setDraftTarget(event.target.value)}><option value="revenue">Revenue (₱)</option><option value="orders">Orders</option><option value="quantity">Units Sold</option></select></label>
                                <CategoryMultiSelect
                                    categories={controlCategories}
                                    selected={draftCategories}
                                    onChange={setDraftCategories}
                                    label="Product Category"
                                    portalMenu
                                />
                                {draftCompareBy === 'province' ? <CategoryMultiSelect
                                    categories={controlProvinces.map(item => ({ value: item.key, label: item.label }))}
                                    selected={draftComparisonProvinceKeys}
                                    onChange={setDraftComparisonProvinceKeys}
                                    label="Compare Provinces"
                                    allLabel="All Provinces"
                                    portalMenu
                                /> : <label className="rd-field"><span>Province</span><select value={draftProvinceKey} onChange={event => setDraftProvinceKey(event.target.value)}><option value="">All Provinces</option>{draftProvinceKey && !controlProvinces.some(item => item.key === draftProvinceKey) && <option value={draftProvinceKey}>{provinceSelectionLabel(draftProvinceKey)}</option>}{controlProvinces.map(item => <option key={item.key} value={item.key}>{item.name} · {item.region}</option>)}</select></label>}
                                <label className="rd-field"><span>Forecast duration</span><select value={draftHorizon} onChange={event => setDraftHorizon(Number(event.target.value))}><option value={3}>3 Months Ahead</option><option value={6}>6 Months Ahead</option><option value={9}>9 Months Ahead</option><option value={12}>12 Months Ahead</option></select></label>
                                <label className="rd-field predictive-model-field">
                                    <span>Forecasting model</span>
                                    <select value={draftForecastModel} onChange={event => setDraftForecastModel(event.target.value)}>
                                        <option value="auto">Auto (Least Error)</option>
                                        <option value="arima">ARIMA (Trend &amp; Seasonality)</option>
                                        <option value="prophet">Prophet (Flexible Growth &amp; Cycles)</option>
                                        <option value="random_forest">Random Forest (Pattern-Based ML)</option>
                                    </select>
                                    {draftForecastModel === 'auto' && <small className="predictive-auto-model-note">Compares all models using validation RMSE and assigns the lowest-error model.</small>}
                                </label>
                            </div>
                        </div>
                        <fieldset className="predictive-missing-month-modes">
                            <legend>Missing-Month Handling</legend>
                            {[
                                ['strict', 'Complete Sales History (Default choice)'],
                                ['confirmed_zero', 'Count Confirmed No-Sales Months'],
                                ['intermittent', 'For Occasional Sales']
                            ].map(([value, label]) => <label key={value}>
                                <input type="radio" name="missing-month-mode" value={value} checked={draftMissingMonthMode === value} onChange={() => setDraftMissingMonthMode(value)} />
                                <span>{label}</span>
                            </label>)}
                            <p>{MISSING_MONTH_MODE_COPY[draftMissingMonthMode]}</p>
                        </fieldset>
                        {hasPendingChanges && <p className="predictive-pending-note" role="status">Parameters changed. Select Generate Forecast to update the results.</p>}
                        <details className="predictive-history-requirements">
                            <summary>Forecast History Requirements</summary>
                            <div>
                                <p>Basic exploratory forecasting requires at least 3 eligible monthly observations. Intermittent-demand forecasting requires at least 12 verified months, including at least 3 months with recorded demand.</p>
                                <p>Forecast reliability depends on historical data quality, observation coverage, model suitability, and backtesting performance. Having more historical data supports stronger evaluation but does not guarantee accurate predictions.</p>
                                <p>Intermittent forecasts require at least 24 verified months and successful validation to qualify as validated.</p>
                            </div>
                        </details>
                        <p className="predictive-modal-scope">Analysis scope: {scope.region || 'All Regions'} · {scope.province || 'All Provinces'} · {globalCategoriesLabel} · {globalPeriodLabel} · {scope.returns || 'Include All'} · Missing-Month Handling: {missingMonthModeLabel(draftMissingMonthMode)}</p>
                        <div className="predictive-modal-actions">
                            <button type="button" className="predictive-modal-cancel" onClick={closeForecastControls}>Cancel</button>
                            <button type="button" className="predictive-refresh" onClick={regenerate} disabled={loading || hasPendingChanges}>{loading ? 'Updating…' : 'Refresh data'}</button>
                            <button type="button" className="predictive-generate" onClick={applyForecastControls} disabled={loading && !hasPendingChanges}>{loading && !hasPendingChanges ? 'Generating…' : 'Generate Forecast'}</button>
                        </div>
                    </section>
                </div>
            )}

            {showReliabilityModal && (
                <div className="prescriptive-lightbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowReliabilityModal(false); }}>
                    <section className="prescriptive-lightbox predictive-verification-lightbox" role="dialog" aria-modal="true" aria-label="Forecast Accuracy and Demand Bounds">
                        <div className="prescriptive-lightbox-head">
                            <div>
                                <span>MODEL VERIFICATION & DEMAND BOUNDARIES</span>
                                <h2>Forecast Accuracy & Expected Demand Range</h2>
                                <p className="predictive-modal-sub">{selectionLabel} · Model: {data.chart.model || forecastModelLabel(forecastModel)} · Duration: {horizon} months ahead</p>
                            </div>
                            <button type="button" aria-label="Close modal" onClick={() => setShowReliabilityModal(false)}>×</button>
                        </div>

                        <div className="predictive-modal-grid">
                            <section className="rd-card predictive-fit-card predictive-reliability-card">
                                <div className="rd-card-head">
                                    <div>
                                        <h3>Historical Model Accuracy Test</h3>
                                        <p>{data.chart.validation ? `Chronological holdout: ${data.chart.validation.months} months, not used for model fitting${modelAssignment?.requested === 'auto' ? ' or automatic model selection' : ''}` : `${data.chart.coverage.calendarMonths} months of sales history available`}</p>
                                    </div>
                                </div>
                                <div className="forecast-panel-scroll">
                                {data.chart.validation ? <>
                                    <dl className="predictive-validation-metrics">
                                        <div><dt>Forecasting model</dt><dd>{data.chart.model}</dd></div>
                                        <div><dt>Historical test period</dt><dd>{data.chart.validation.months} months · {monthLabel(data.chart.validation.start)} to {monthLabel(data.chart.validation.end)}</dd></div>
                                        <div><dt>Evaluation method</dt><dd>{data.chart.validation.independent ? 'Independent chronological final holdout' : 'Exploratory evaluation'}</dd></div>
                                        {modelAssignment?.selectionWindow && <div><dt>Automatic model selection</dt><dd>{monthLabel(modelAssignment.selectionWindow.start)} to {monthLabel(modelAssignment.selectionWindow.end)} · earlier chronological forecast-origin tests</dd></div>}
                                        {data.chart.validation.mapeExcludedMonths > 0 && <div><dt>MAPE exclusions</dt><dd>{data.chart.validation.mapeExcludedMonths} months with zero actual values (excluded from percentage error)</dd></div>}
                                        <div><dt>Average Error % (MAPE)</dt><dd>{data.chart.validation.mape == null ? 'Not available' : `${formatValue(data.chart.validation.mape, 'quantity')}%`}</dd></div>
                                        <div><dt>Average Error (MAE)</dt><dd>{formatValue(data.chart.validation.mae, target)}</dd></div>
                                        <div><dt>Error Variation (RMSE)</dt><dd>{formatValue(data.chart.validation.rmse, target)}</dd></div>
                                        <div><dt>Benchmark: repeat last month (MAE)</dt><dd>{formatValue(data.chart.validation.baselineMae, target)} · RMSE {formatValue(data.chart.validation.baselineRmse, target)}{data.chart.validation.baselineMape == null ? '' : ` · MAPE ${formatPercent(data.chart.validation.baselineMape).replace('+', '')}`}</dd></div>
                                        <div><dt>Versus benchmark</dt><dd>{data.chart.validation.improvementVsBaseline == null ? 'Not available' : data.chart.validation.beatsBaseline ? `${formatPercent(data.chart.validation.improvementVsBaseline)} lower error (better)` : `${formatPercent(Math.abs(data.chart.validation.improvementVsBaseline)).replace('+', '')} higher error (worse)`}</dd></div>
                                        <div><dt>Available history</dt><dd>{data.chart.coverage.calendarMonths} monthly records · {data.chart.coverage.activeMonths} active</dd></div>
                                    </dl>
                                    <div className="rd-table-wrap"><table className="rd-table predictive-table"><thead><tr><th>Test month</th><th>Actual sales</th><th>Predicted sales</th></tr></thead><tbody>{rowsForPage(data.chart.validation.points, reliabilityPage).map(point => <tr key={point.month}><td>{monthLabel(point.month)}</td><td>{formatValue(point.actual, target)}</td><td>{formatValue(point.predicted, target)}</td></tr>)}</tbody></table></div>
                                    <p className="predictive-method-note">MAE and RMSE measure errors on past months not used to fit the tested model. MAPE excludes zero-actual months. Automatic model selection uses earlier rolling-origin forecasts, separate from this final holdout. The benchmark repeats the last training month's value. A model that fails to beat the benchmark is exploratory, not validated.</p>
                                </> : data.chart.status === 'available' ? <div className="predictive-inline-warning" role="status"><strong>Limited historical testing data</strong><p>{data.chart.coverage.calendarMonths} consecutive months can produce an early projection, but additional monthly records are needed for a full historical accuracy test. Treat this projection as an initial estimate.</p></div> : <EmptyState message={data.chart.reason || 'An accuracy test is not available for this scope.'} />}
                                </div>
                                {data.chart.validation && <SectionPagination total={data.chart.validation.points.length} page={reliabilityPage} setPage={setReliabilityPage} label="Forecast reliability" always />}
                            </section>

                            <section className="rd-card predictive-fit-card predictive-range-card">
                                <div className="rd-card-head">
                                    <div>
                                        <h3>Expected Demand Range (Lower & Upper)</h3>
                                        <p>Projected monthly demand alongside an indicative lower and upper range.</p>
                                    </div>
                                </div>
                                <div className="forecast-panel-scroll">
                                {data.chart.status === 'available' ? <>
                                    <div className="predictive-range-summary"><span>Projected for final month · {monthLabel(data.chart.forecast.at(-1).month)}</span><strong>{formatValue(data.chart.forecast.at(-1).value, target)}</strong><small>{formatValue(data.chart.forecast.at(-1).lower, target)} – {formatValue(data.chart.forecast.at(-1).upper, target)}</small></div>
                                    <div className="rd-table-wrap"><table className="rd-table predictive-table"><thead><tr><th>Month</th><th>Projected demand</th><th>Lower range</th><th>Upper range</th></tr></thead><tbody>{rowsForPage(data.chart.forecast, rangePage).map(row => <tr key={row.month}><td>{monthLabel(row.month)}</td><td>{formatValue(row.value, target)}</td><td>{formatValue(row.lower, target)}</td><td>{formatValue(row.upper, target)}</td></tr>)}</tbody></table></div>
                                    <p className="predictive-method-note">{data.chart.forecast[0]?.rangeMethod === 'backtest_rmse' ? 'Estimated, uncalibrated range: forecast ± independent holdout RMSE × square root of months ahead. This is NOT a 95% prediction interval.' : 'Illustrative uncalibrated range from historical variability (with a 25% minimum buffer). Not a statistical confidence or prediction interval.'}</p>
                                </> : <EmptyState message={data.chart.reason || 'A forecast range is unavailable for this scope.'} />}
                                </div>
                                <SectionPagination total={data.chart.forecast?.length || 0} page={rangePage} setPage={setRangePage} label="Forecast range" always />
                            </section>
                        </div>

                        <div className="prescriptive-lightbox-actions">
                            <button type="button" onClick={() => setShowReliabilityModal(false)}>Close Details</button>
                        </div>
                    </section>
                </div>
            )}
        </>}
        <button type="button" className="predictive-page-refresh" onClick={regenerate} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
    </div>;
}

function AggregationHelp({ id }) {
    const [open, setOpen] = useState(false);
    const helpRef = useRef(null);
    const tooltipId = `predictive-aggregation-help-${id}`;

    useEffect(() => {
        if (!open) return undefined;
        const closeOnOutsidePointer = event => {
            if (!helpRef.current?.contains(event.target)) setOpen(false);
        };
        const closeOnEscape = event => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePointer);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <span className="predictive-aggregation-help-wrap" ref={helpRef}>
            <button
                type="button"
                className="predictive-aggregation-help"
                aria-label="Explain forecast aggregation"
                aria-expanded={open}
                aria-controls={open ? tooltipId : undefined}
                aria-describedby={open ? tooltipId : undefined}
                onClick={() => setOpen(value => !value)}
            >
                <FaInfoCircle aria-hidden="true" />
            </button>
            {open && <span id={tooltipId} className="predictive-aggregation-popover" role="tooltip">{FORECAST_AGGREGATION_EXPLANATION}</span>}
        </span>
    );
}

function Kpi({ label, value, detail, meaning }) {
    return (
        <div className="rd-kpi predictive-kpi-card" tabIndex="0">
            <div>
                <div className="predictive-kpi-header">
                    <small>{label}</small>
                    {meaning && (
                        <span className="predictive-kpi-info-icon" title={`More about ${label}`}>
                            <FaInfoCircle />
                        </span>
                    )}
                </div>
                <strong>{value}</strong>
                <span>{detail}</span>
            </div>
            {meaning && (
                <div className="predictive-card-hover-popover" role="tooltip">
                    <div className="predictive-popover-title"><strong>{label}</strong></div>
                    <p className="predictive-popover-meaning">{meaning}</p>
                </div>
            )}
        </div>
    );
}

function rowsForPage(rows, page) {
    const start = (page - 1) * ROWS_PER_PAGE;
    return rows.slice(start, start + ROWS_PER_PAGE);
}

function ForecastOverviewChart({ rows, target, onSelect, highlightedKey }) {
    const [showBenchmarkHelp, setShowBenchmarkHelp] = useState(false);
    const numericValues = rows.map(row => row.forecastDemand == null ? null : Number(row.forecastDemand))
        .filter(value => value !== null && Number.isFinite(value));
    const maximum = Math.max(0, ...numericValues.filter(value => value >= 0));
    const hasNegativeForecasts = numericValues.some(value => value < 0);

    useEffect(() => {
        if (!showBenchmarkHelp) return undefined;
        const closeOnEscape = event => {
            if (event.key === 'Escape') setShowBenchmarkHelp(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [showBenchmarkHelp]);

    return (
        <div className="predictive-overview-chart">
            <div className="predictive-overview-chart-legend" aria-label="Forecast validation legend">
                <span><i className="beats" />Beats last-month benchmark</span>
                <span><i className="weak" />Does not beat benchmark</span>
                <span><i className="unknown" />Validation unavailable or not established</span>
                <button
                    type="button"
                    className="predictive-benchmark-help-button"
                    aria-label="What does the last-month benchmark mean?"
                    onClick={() => setShowBenchmarkHelp(true)}
                >?</button>
            </div>
            <div className="predictive-overview-chart-scroll" role="region" aria-label="Ranked monthly forecast comparisons">
                <div className="predictive-overview-chart-list" role="list">
                    <div className="predictive-overview-chart-columns" aria-hidden="true">
                        <span>Rank</span><span>Province / region / category</span><span>Forecast scale</span><span>Current / month</span><span>Forecast / month</span>
                        <span>Growth</span><span>Trend</span><span>Validation / history</span><span>Details</span>
                    </div>
                    {rows.map((row, index) => {
                        const numericForecast = row.forecastDemand == null ? null : Number(row.forecastDemand);
                        const hasForecast = numericForecast !== null && Number.isFinite(numericForecast);
                        const barWidth = hasForecast && numericForecast >= 0 && maximum > 0
                            ? numericForecast / maximum * 100
                            : 0;
                        const validationClass = row.reliability === 'backtested'
                            ? 'beats'
                            : row.reliability === 'backtested_weak'
                                ? 'weak'
                                : 'unknown';
                        const rank = index + 1;
                        const coverageMonths = Number(row.coverage?.calendarMonths) || 0;
                        const salesHistory = `${coverageMonths} calendar months · ${reliabilityLabel(row.reliability)}`;
                        const growth = row.growth == null || !Number.isFinite(Number(row.growth)) ? 'N/A' : formatPercent(row.growth);
                        const currentDemand = formatValue(row.currentDemand, target);
                        const tooltip = `Rank: ${rank}. Province: ${row.province}. Region: ${row.region}. Category: ${row.category}. Current / Month: ${currentDemand}. Forecast / Month: ${formatValue(row.forecastDemand, target)}. Growth: ${growth}. Trend: ${trendLabel(row.trend)}. Sales History: ${salesHistory}.`;

                        return (
                            <article className={`predictive-overview-chart-row${highlightedKey === row.key ? ' predictive-overview-row-highlighted' : ''}`} role="listitem" key={row.key}>
                                <span className="predictive-overview-rank">{rank}</span>
                                <div className="predictive-overview-identity">
                                    <button type="button" className="predictive-select-link" onClick={() => onSelect(row)} title={`Select ${row.province} and ${row.category}`}>{row.province}</button>
                                    <small>Region: {row.region}</small>
                                    <span>{row.category}</span>
                                    {row.forecastStatus && <small className="predictive-status-text">{row.forecastStatus} · {row.model}</small>}
                                </div>
                                <button
                                    type="button"
                                    className="predictive-overview-bar-button"
                                    onClick={() => onSelect(row)}
                                    aria-label={`${tooltip} Select this province and category forecast.`}
                                    title={tooltip}
                                >
                                    <span className="predictive-overview-bar-track" aria-hidden="true">
                                        <span style={{ width: `${barWidth}%` }} />
                                    </span>
                                </button>
                                <strong className="predictive-overview-current">{currentDemand}</strong>
                                <strong className="predictive-overview-value">{formatValue(row.forecastDemand, target)}</strong>
                                <span className={`predictive-overview-growth ${growthTone(row.growth)}`}>{growth}</span>
                                <span className={`predictive-overview-trend ${trendTone(row.trend)}`}>{trendLabel(row.trend)}</span>
                                <span className={`predictive-overview-validation ${validationClass}`} title={reliabilityLabel(row.reliability)}>
                                    <i aria-hidden="true" />
                                    <span>{reliabilityLabel(row.reliability)}</span>
                                    <small>{coverageMonths} mo history</small>
                                </span>
                                <details className="predictive-overview-row-details">
                                    <summary>Details</summary>
                                    <dl>
                                        <div><dt>Rank</dt><dd>{rank}</dd></div>
                                        <div><dt>Province</dt><dd>{row.province}</dd></div>
                                        <div><dt>Region</dt><dd>{row.region}</dd></div>
                                        <div><dt>Category</dt><dd>{row.category}</dd></div>
                                        <div><dt>Current / Month</dt><dd>{currentDemand}</dd></div>
                                        <div><dt>Forecast / Month</dt><dd>{formatValue(row.forecastDemand, target)}</dd></div>
                                        <div><dt>Growth</dt><dd>{growth}</dd></div>
                                        <div><dt>Trend</dt><dd>{trendLabel(row.trend)}</dd></div>
                                    <div><dt>Sales History</dt><dd>{salesHistory}</dd></div>
                                    {row.forecastStatus && <div><dt>Forecast Status</dt><dd>{row.forecastStatus}</dd></div>}
                                    </dl>
                                </details>
                            </article>
                        );
                    })}
                </div>
            </div>
            {hasNegativeForecasts && <p className="predictive-inline-warning" role="status">Negative forecast values are shown exactly but their bars are omitted because the shared magnitude scale begins at zero.</p>}
            {numericValues.length === 0 && <p className="predictive-inline-warning" role="status">Forecast values are unavailable or non-finite; rows remain listed with their original values.</p>}
            <p className="predictive-chart-caption">Bar lengths use one shared scale from zero to the largest nonnegative monthly forecast. Validation colors describe only the existing backtest comparison; they do not guarantee future accuracy.</p>
            {showBenchmarkHelp && (
                <div
                    className="predictive-benchmark-lightbox-backdrop"
                    onMouseDown={event => {
                        if (event.target === event.currentTarget) setShowBenchmarkHelp(false);
                    }}
                >
                    <section
                        className="predictive-benchmark-lightbox"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="predictive-benchmark-title"
                    >
                        <button
                            type="button"
                            className="predictive-benchmark-lightbox-close"
                            aria-label="Close benchmark explanation"
                            onClick={() => setShowBenchmarkHelp(false)}
                        >×</button>
                        <span className="predictive-benchmark-lightbox-eyebrow">FORECAST OVERVIEW</span>
                        <h3 id="predictive-benchmark-title">What does “Beats last-month benchmark” mean?</h3>
                        <ul className="predictive-benchmark-definitions">
                            <li><strong>Beats last-month benchmark:</strong> The forecast was closer to what actually happened than simply assuming sales would stay like the previous month.</li>
                            <li><strong>Does not beat benchmark:</strong> For the past months checked, assuming sales would stay like the previous month was just as accurate or more accurate.</li>
                            <li><strong>Not established:</strong> There is not enough past information to tell which approach would be more accurate.</li>
                        </ul>
                        <p>These labels describe past results. They cannot guarantee how accurate a future forecast will be.</p>
                        <button
                            type="button"
                            className="predictive-benchmark-lightbox-done"
                            onClick={() => setShowBenchmarkHelp(false)}
                        >Got it</button>
                    </section>
                </div>
            )}
        </div>
    );
}

function SectionPagination({ total, page, setPage, label, always = false }) {
    const pageCount = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
    if (!always && pageCount === 1) return null;
    const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
    const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index);
    const firstRecord = total ? (page - 1) * ROWS_PER_PAGE + 1 : 0;
    const lastRecord = Math.min(page * ROWS_PER_PAGE, total);

    return <nav className="forecast-section-pagination" aria-label={`${label} pagination`}>
        <span>{total ? `${firstRecord}–${lastRecord} of ${total}` : '0 records'}</span>
        <div className="forecast-page-buttons">
            <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>‹</button>
            {pages.map(number => <button type="button" key={number} aria-label={`Page ${number}`} aria-current={page === number ? 'page' : undefined} className={page === number ? 'active' : ''} onClick={() => setPage(number)}>{number}</button>)}
            <button type="button" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>›</button>
        </div>
    </nav>;
}

function Metric({ label, value, meaning }) {
    return (
        <div className="predictive-metric" tabIndex="0">
            <div className="predictive-metric-top">
                <small>{label}</small>
                {meaning && <FaInfoCircle className="predictive-metric-info-icon" />}
            </div>
            <strong>{value}</strong>
            {meaning && (
                <div className="predictive-metric-hover-popover" role="tooltip">
                    <div className="predictive-popover-title">
                        <FaLightbulb />
                        <strong>Meaning of {value}</strong>
                    </div>
                    <p className="predictive-popover-meaning">
                        <b>{label}:</b> {meaning}
                    </p>
                </div>
            )}
        </div>
    );
}

function Status({ status, forecastStatus }) {
    const isReady = status === 'available';
    const text = forecastStatus || (isReady ? 'Available' : 'Insufficient history');
    const meaning = isReady
        ? forecastStatus || 'Meets the selected forecast eligibility checks. Review validation and history before using the projection.'
        : 'The selected missing-month mode found insufficient verified history, an unknown gap, or another eligibility issue. Review the pair-specific reason.';
    return (
        <span className="predictive-status-wrap">
            <span className={`predictive-status-pill ${status}`}>{text}</span>
            <span className="predictive-status-hover-popover" role="tooltip">
                <div className="predictive-popover-title">
                    <FaLightbulb />
                    <strong>Status: {text}</strong>
                </div>
                <p className="predictive-popover-meaning">
                    {meaning}
                </p>
            </span>
        </span>
    );
}

function trendLabel(trend) {
    if (trend === 'Increasing') return '↑ Increasing';
    if (trend === 'Decreasing') return '↓ Decreasing';
    if (trend === 'Stable') return '→ Stable';
    return 'N/A';
}

function growthTone(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'unavailable';
    if (Number(value) > 0) return 'positive';
    if (Number(value) < 0) return 'negative';
    return 'neutral';
}

function trendTone(trend) {
    if (trend === 'Increasing') return 'increasing';
    if (trend === 'Decreasing') return 'decreasing';
    if (trend === 'Stable') return 'stable';
    return 'unavailable';
}

function EmptyState({ message }) {
    return <p className="predictive-empty">{message}</p>;
}

export function ForecastComparisonChart({ series, target, seriesLabel = 'Product Category' }) {
    const [zoom, setZoom] = useState(1);
    const [expanded, setExpanded] = useState(false);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const usable = series.filter(item => item.chart?.history?.length);
    const monthSet = new Set(usable.flatMap(item => [...item.chart.history, ...(item.chart.forecast || [])].map(point => point.month)));
    const months = [...monthSet].sort();
    const pointsBySeries = usable.map(item => ({
        ...item,
        history: new Map(item.chart.history.map(point => [point.month, point])),
        forecast: new Map((item.chart.forecast || []).map(point => [point.month, point]))
    }));
    const adjustedMonths = [...new Set(pointsBySeries.flatMap(item => item.chart.history.filter(point => point.adjusted).map(point => point.month)))];
    const values = pointsBySeries.flatMap(item => [...item.chart.history, ...(item.chart.forecast || [])]
        .flatMap(point => [point.value, point.lower, point.upper])
        .filter(value => Number.isFinite(value)));
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(1, ...values);
    const axisInterval = niceAxisInterval((maximum - minimum || 1) / 4);
    const axisMin = Math.floor(minimum / axisInterval) * axisInterval;
    const axisMax = Math.max(axisMin + axisInterval, Math.ceil(maximum / axisInterval) * axisInterval);
    const span = axisMax - axisMin || 1;
    const plotWidth = Math.max(800, months.length * 32 + 110) * zoom;
    const plotHeight = expanded ? 430 : 290;
    const plotTop = 25;
    const plotBottom = plotHeight - 50;
    const columnWidth = (plotWidth - 110) / Math.max(1, months.length - 1);
    const xPosition = index => 64 + index * (plotWidth - 110) / Math.max(1, months.length - 1);
    const yPosition = value => plotBottom - (value - axisMin) / span * (plotBottom - plotTop);
    const xEvery = Math.max(1, Math.ceil(months.length / Math.max(4, Math.floor((plotWidth - 100) / 60))));
    const tickIndices = new Set(months.length ? [0, months.length - 1] : []);
    months.forEach((month, index) => { if (month.endsWith('-01') || index % xEvery === 0) tickIndices.add(index); });
    const xTicks = thinAxisTickIndices([...tickIndices], months.length, xPosition, 60).map(index => ({ index, label: monthLabel(months[index]) }));
    const yTicks = Array.from({ length: Math.floor((axisMax - axisMin) / axisInterval) + 1 }, (_, index) => axisMin + index * axisInterval);
    const periodLabel = month => {
        const date = new Date(`${month}-01T00:00:00Z`);
        return `${new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)} (${month})`;
    };
    const valueLabel = value => formatValue(value, target);
    const pathFor = valuesByMonth => {
        let connected = false;
        return months.map((month, index) => {
            const value = valuesByMonth.get(month);
            if (value == null || !Number.isFinite(value)) { connected = false; return ''; }
            const command = connected ? 'L' : 'M';
            connected = true;
            return `${command} ${xPosition(index)} ${yPosition(value)}`;
        }).filter(Boolean).join(' ');
    };
    const unavailable = series.filter(item => item.error || item.chart?.status !== 'available');

    useEffect(() => {
        if (!expanded) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const closeOnEscape = event => { if (event.key === 'Escape') setExpanded(false); };
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [expanded]);

    if (!usable.length) return <div className="predictive-category-comparison-empty">
        <EmptyState message="No selected comparison series have enough historical data to plot." />
        {unavailable.map(item => <p key={item.name} className="predictive-inline-warning" role="status"><strong>{item.name}:</strong> {item.error || item.chart?.reason || 'Insufficient historical data for a forecast.'}</p>)}
    </div>;

    return <div className={`predictive-chart-shell predictive-comparison-chart ${expanded ? 'expanded' : ''}`}>
        <div className="predictive-chart-toolbar" aria-label="Chart controls">
            <span className="predictive-comparison-scale-note">Shared monthly time axis and value scale</span>
            <div className="predictive-chart-zoom" aria-label="Chart zoom controls"><button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={zoom <= 1}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, value + 0.5))} disabled={zoom >= 3}>+</button></div>
            {!expanded && <button type="button" className="predictive-chart-control expand" onClick={() => setExpanded(true)}>Expand chart</button>}
            {expanded && <button type="button" className="predictive-chart-control expand" onClick={() => setExpanded(false)}>Close expanded chart ×</button>}
        </div>
        <div className="predictive-chart-scroll"><div className="predictive-chart-plot">
            {hoveredPoint && <div className="predictive-chart-tooltip" role="status"><strong>{hoveredPoint.category} · {hoveredPoint.kind}</strong><span>{periodLabel(hoveredPoint.point.month)}</span><b>{valueLabel(hoveredPoint.point.value)}</b>{hoveredPoint.kind === 'Forecast' && <small>Range: {valueLabel(hoveredPoint.point.lower)} – {valueLabel(hoveredPoint.point.upper)}</small>}</div>}
            <svg className="predictive-chart" style={{ width: `${plotWidth}px`, height: expanded ? 'min(62vh, 560px)' : undefined }} viewBox={`0 0 ${plotWidth} ${plotHeight}`} role="img" aria-label={`Historical and projected ${target} comparison for ${series.map(item => item.name).join(', ')}`}>
                {yTicks.map(value => <g key={`y-${value}`}><line x1="64" x2={plotWidth - 26} y1={yPosition(value)} y2={yPosition(value)} className="predictive-chart-grid" /><text x="56" y={yPosition(value) + 4} textAnchor="end">{valueLabel(value)}</text></g>)}
                {adjustedMonths.map(month => <rect key={`adjusted-${month}`} x={xPosition(months.indexOf(month)) - columnWidth / 2} y={plotTop} width={columnWidth} height={plotBottom - plotTop} fill="currentColor" opacity="0.08"><title>{`${periodLabel(month)}: adjusted period; not used for model training`}</title></rect>)}
                {pointsBySeries.map(item => {
                    const historyValues = new Map([...item.history.entries()].map(([month, point]) => [month, point.value]));
                    const lastObserved = [...item.chart.history].reverse().find(point => point.value != null);
                    const forecastValues = new Map();
                    if (lastObserved) forecastValues.set(lastObserved.month, lastObserved.value);
                    for (const [month, point] of item.forecast.entries()) forecastValues.set(month, point.value);
                    return <g key={item.name}>
                        <path d={pathFor(historyValues)} className="predictive-chart-history predictive-category-history" style={{ stroke: item.color }} />
                        <path d={pathFor(forecastValues)} className="predictive-chart-forecast predictive-category-forecast" style={{ stroke: item.color }} />
                        {item.chart.history.map(point => point.value == null ? null : <circle key={`history-${point.month}`} cx={xPosition(months.indexOf(point.month))} cy={yPosition(point.value)} r="3.5" className="predictive-chart-actual predictive-category-point" style={{ fill: item.color, stroke: item.color }} tabIndex="0" aria-label={`${item.name}, actual, ${periodLabel(point.month)}, ${valueLabel(point.value)}`} onPointerEnter={() => setHoveredPoint({ category: item.name, kind: 'Actual', point })} onPointerLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ category: item.name, kind: 'Actual', point })} onBlur={() => setHoveredPoint(null)}><title>{`${item.name} · ${periodLabel(point.month)} · Actual · ${valueLabel(point.value)}`}</title></circle>)}
                        {(item.chart.forecast || []).map(point => <circle key={`forecast-${point.month}`} cx={xPosition(months.indexOf(point.month))} cy={yPosition(point.value)} r="3.5" className="predictive-chart-projected predictive-category-point" style={{ fill: item.color, stroke: item.color }} tabIndex="0" aria-label={`${item.name}, forecast, ${periodLabel(point.month)}, ${valueLabel(point.value)}`} onPointerEnter={() => setHoveredPoint({ category: item.name, kind: 'Forecast', point })} onPointerLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ category: item.name, kind: 'Forecast', point })} onBlur={() => setHoveredPoint(null)}><title>{`${item.name} · ${periodLabel(point.month)} · Forecast · ${valueLabel(point.value)} · Range ${valueLabel(point.lower)}–${valueLabel(point.upper)}`}</title></circle>)}
                    </g>;
                })}
                {xTicks.map(({ index, label }) => <text key={`x-${index}`} x={xPosition(index)} y={plotHeight - 15} textAnchor={index === 0 ? 'start' : index === months.length - 1 ? 'end' : 'middle'}>{label}</text>)}
            </svg>
        </div></div>
        <div className="predictive-chart-legend predictive-comparison-legend" aria-label={`${seriesLabel} comparison legend`}>
            <span><i className="comparison-history-key" />Historical</span><span><i className="comparison-forecast-key" />Forecast</span>{adjustedMonths.length > 0 && <span><i className="adjusted-key" />Adjusted period</span>}
            {series.map(item => <span key={item.name}><i className="comparison-category-key" style={{ backgroundColor: item.color }} />{item.name}</span>)}
        </div>
        <p className="predictive-chart-caption predictive-comparison-caption">Each selected {seriesLabel.toLowerCase()} is forecast from its own history.<br />Dashed lines show forecasts; hover or focus a point for series, month, value, and forecast range.</p>
        {unavailable.map(item => <p key={item.name} className="predictive-inline-warning predictive-category-warning" role="status"><strong>{item.name}:</strong> {item.error || item.chart?.reason || 'Insufficient historical data for a forecast.'}</p>)}
    </div>;
}

export function ForecastChart({ result, target, dataCompleteness }) {
    const [xInterval, setXInterval] = useState('monthly');
    const [yInterval, setYInterval] = useState('auto');
    const [zoom, setZoom] = useState(1);
    const [expanded, setExpanded] = useState(false);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const history = result.history;
    const forecast = result.forecast;
    const points = [...history, ...forecast];
    const chartValues = points.flatMap(point => [point.value, point.lower, point.upper].filter(value => Number.isFinite(value)));
    const rawMinimum = Math.min(0, ...chartValues);
    const rawMaximum = Math.max(1, ...chartValues);
    const rawSpan = rawMaximum - rawMinimum || 1;
    const autoInterval = niceAxisInterval(rawSpan / 4);
    const numericYInterval = Number(yInterval);
    const validManualInterval = yInterval !== 'auto' && Number.isFinite(numericYInterval) && numericYInterval > 0;
    const requestedInterval = validManualInterval ? numericYInterval : autoInterval;
    const manualIntervalTooSmall = yInterval !== 'auto' && (!validManualInterval || rawSpan / requestedInterval > 12);
    const axisInterval = manualIntervalTooSmall ? autoInterval : requestedInterval;
    const minimum = Math.floor(rawMinimum / axisInterval) * axisInterval;
    const maximum = Math.max(minimum + axisInterval, Math.ceil(rawMaximum / axisInterval) * axisInterval);
    const span = maximum - minimum || 1;
    const plotWidth = 800 * zoom;
    const plotHeight = expanded ? 430 : 290;
    const plotTop = 25;
    const plotBottom = plotHeight - 50;
    const xPosition = index => 64 + index * (plotWidth - 110) / Math.max(1, points.length - 1);
    const yPosition = value => plotBottom - (value - minimum) / span * (plotBottom - plotTop);
    const xLabelEvery = Math.max(1, Math.ceil(points.length / Math.max(4, Math.floor((plotWidth - 100) / 60))));
    const xTickIndices = new Set(points.length ? [0, points.length - 1] : []);
    points.forEach((point, index) => {
        if (xInterval === 'yearly' ? point.month.endsWith('-01') : index % xLabelEvery === 0) xTickIndices.add(index);
    });
    const xTicks = thinAxisTickIndices([...xTickIndices], points.length, xPosition, 60).map(index => ({
        index,
        label: xInterval === 'yearly' ? points[index].month.slice(0, 4) : monthLabel(points[index].month)
    }));
    const yTicks = Array.from({ length: Math.floor((maximum - minimum) / axisInterval) + 1 }, (_, index) => minimum + index * axisInterval);
    const formatPeriod = month => {
        const date = new Date(`${month}-01T00:00:00Z`);
        return `${new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)} (${month})`;
    };
    useEffect(() => {
        if (!expanded) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        function closeOnEscape(event) {
            if (event.key === 'Escape') setExpanded(false);
        }
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [expanded]);
    const makeLine = rows => {
        let connected = false;
        return rows.map((point, index) => {
            if (point.value == null) {
                connected = false;
                return '';
            }
            const command = connected ? 'L' : 'M';
            connected = true;
            return `${command} ${xPosition(index)} ${yPosition(point.value)}`;
        }).filter(Boolean).join(' ');
    };
    // Start the forecast line at the last month with real sales; adjusted months at the end have no value.
    const lastObservedIndex = history.reduce((found, point, index) => point.value == null ? found : index, -1);
    const columnWidth = (plotWidth - 110) / Math.max(1, points.length - 1);
    const forecastLine = forecast.length && lastObservedIndex >= 0
        ? [`${xPosition(lastObservedIndex)},${yPosition(history[lastObservedIndex].value)}`, ...forecast.map((point, index) => `${xPosition(history.length + index)},${yPosition(point.value)}`)].join(' ')
        : '';
    const band = forecast.length ? [
        ...forecast.map((point, index) => `${xPosition(history.length + index)},${yPosition(point.upper)}`),
        ...forecast.map((point, index) => `${xPosition(history.length + index)},${yPosition(point.lower)}`).reverse()
    ].join(' ') : '';
    const dividerX = history.length ? xPosition(history.length - 1) : xPosition(0);

    return <>
        <div className={`predictive-chart-shell ${expanded ? 'expanded' : ''}`}>
            <div className="predictive-chart-toolbar" aria-label="Chart controls">
                <label><span>X-axis labels</span><select value={xInterval} onChange={event => setXInterval(event.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
                <label><span>Y-axis interval</span><input type="number" min="0" step="any" value={yInterval === 'auto' ? '' : yInterval} placeholder="Auto" aria-label="Y-axis value interval" onChange={event => setYInterval(event.target.value || 'auto')} /></label>
                <button type="button" className="predictive-chart-control" onClick={() => setYInterval('auto')} disabled={yInterval === 'auto'}>Auto scale</button>
                <div className="predictive-chart-zoom" aria-label="Chart zoom controls"><button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={zoom <= 1}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(3, value + 0.5))} disabled={zoom >= 3}>+</button></div>
                {!expanded && <button type="button" className="predictive-chart-control expand" onClick={() => setExpanded(true)}>Expand chart</button>}
                {expanded && <button type="button" className="predictive-chart-control expand" onClick={() => setExpanded(false)}>Close expanded chart ×</button>}
            </div>
            {manualIntervalTooSmall && <p className="predictive-chart-hint" role="status">That interval is too small for this value range, so the axis uses an automatic interval to keep labels readable.</p>}
            <div className="predictive-chart-scroll">
                <div className="predictive-chart-plot">
                    {hoveredPoint && <div className="predictive-chart-tooltip" role="status"><strong>{hoveredPoint.kind}</strong><span>{formatPeriod(hoveredPoint.point.month)}</span><b>{formatValue(hoveredPoint.point.value, target)}</b>{hoveredPoint.kind === 'Forecast' && <small>Range: {formatValue(hoveredPoint.point.lower, target)} – {formatValue(hoveredPoint.point.upper, target)}</small>}</div>}
                    <svg className="predictive-chart" style={{ width: zoom > 1 ? `${plotWidth}px` : '100%', height: expanded ? 'min(62vh, 560px)' : undefined }} viewBox={`0 0 ${plotWidth} ${plotHeight}`} role="img" aria-label={`Historical and forecast monthly ${target} for the selected scope`}>
                        {yTicks.map(value => <g key={`y-${value}`}><line x1="64" x2={plotWidth - 26} y1={yPosition(value)} y2={yPosition(value)} className="predictive-chart-grid" /><text x="56" y={yPosition(value) + 4} textAnchor="end">{formatValue(value, target)}</text></g>)}
                        {band && <polygon points={band} className="predictive-chart-band" />}
                        {history.map((point, index) => point.adjusted ? <rect key={`adjusted-${point.month}`} x={xPosition(index) - columnWidth / 2} y={plotTop} width={columnWidth} height={plotBottom - plotTop} fill="currentColor" opacity="0.08"><title>{`${formatPeriod(point.month)}: adjusted period (${describeAdjustment(adjustmentInfo(dataCompleteness, point.month).kinds, adjustmentInfo(dataCompleteness, point.month).reason)}); not used for model training`}</title></rect> : null)}
                        <path d={makeLine(history)} className="predictive-chart-history" />
                        {forecastLine && <polyline points={forecastLine} className="predictive-chart-forecast" />}
                        {history.map((point, index) => point.value == null ? null : <circle key={`actual-${point.month}`} cx={xPosition(index)} cy={yPosition(point.value)} r="4" tabIndex="0" aria-label={`Actual, ${formatPeriod(point.month)}, ${formatValue(point.value, target)}`} onPointerEnter={() => setHoveredPoint({ point, kind: 'Actual' })} onPointerLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ point, kind: 'Actual' })} onBlur={() => setHoveredPoint(null)} className="predictive-chart-actual"><title>{`${formatPeriod(point.month)} · Actual · ${formatValue(point.value, target)}`}</title></circle>)}
                        {forecast.map((point, index) => <circle key={`forecast-${point.month}`} cx={xPosition(history.length + index)} cy={yPosition(point.value)} r="4" tabIndex="0" aria-label={`Forecast, ${formatPeriod(point.month)}, ${formatValue(point.value, target)}, range ${formatValue(point.lower, target)} to ${formatValue(point.upper, target)}`} onPointerEnter={() => setHoveredPoint({ point, kind: 'Forecast' })} onPointerLeave={() => setHoveredPoint(null)} onFocus={() => setHoveredPoint({ point, kind: 'Forecast' })} onBlur={() => setHoveredPoint(null)} className="predictive-chart-projected"><title>{`${formatPeriod(point.month)} · Forecast · ${formatValue(point.value, target)} · Range ${formatValue(point.lower, target)}–${formatValue(point.upper, target)}`}</title></circle>)}
                        {history.length > 0 && <line x1={dividerX} x2={dividerX} y1={plotTop} y2={plotBottom} className="predictive-chart-divider" />}
                        {xTicks.map(({ index, label }) => <text key={`x-${index}`} x={xPosition(index)} y={plotHeight - 15} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{label}</text>)}
                    </svg>
                </div>
            </div>
            <div className="predictive-chart-legend"><span><i className="history-key" />Historical demand</span><span><i className="forecast-key" />Forecast demand</span><span><i className="range-key" />{forecast[0]?.rangeMethod === 'backtest_rmse' ? 'Indicative range (±RMSE·√months ahead)' : forecast[0]?.rangeMethod === 'exploratory_holdout_rmse' ? 'Exploratory holdout-error range · not an interval' : 'Estimated range'}</span>{history.some(point => point.adjusted) && <span><i className="adjusted-key" />Adjusted period</span>}</div>
            <p className="predictive-chart-caption">Forecast starts in {forecast[0] ? monthLabel(forecast[0].month) : 'the month after the last actual observation'}. Hover or focus a point for its month, year, value{forecast.length ? ', and forecast range' : ''}. X-axis labels do not change the monthly data.</p>
        </div>
    </>;
}

function niceAxisInterval(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const fraction = value / magnitude;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * magnitude;
}

function thinAxisTickIndices(indices, pointCount, xPosition, minSpacing) {
    if (pointCount <= 2) return [...new Set(indices)].sort((a, b) => a - b);
    const lastIndex = pointCount - 1;
    const ordered = [...new Set(indices)].sort((a, b) => a - b);
    const visible = [0];
    for (const index of ordered) {
        if (index === 0 || index === lastIndex) continue;
        if (xPosition(index) - xPosition(visible.at(-1)) >= minSpacing
            && xPosition(lastIndex) - xPosition(index) >= minSpacing) visible.push(index);
    }
    const previous = visible.at(-1);
    if (xPosition(lastIndex) - xPosition(previous) < minSpacing && visible.length > 1) visible.pop();
    if (lastIndex !== 0) visible.push(lastIndex);
    return visible;
}
