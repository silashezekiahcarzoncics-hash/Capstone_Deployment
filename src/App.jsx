import { scopeCategoryOptions, forecastCategoryOptions } from "./utils/geographicScope";
import { useEffect, useState } from "react";

import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import SubNav from "./components/SubNav";

import DataManagement from "./pages/DataManagement";
import DataPreparation from "./pages/DataPreparation";
import AnalysisControls from "./pages/AnalysisControls";
import DescriptiveAnalytics from "./pages/DescriptiveAnalytics";
import PredictiveAnalytics from "./pages/PredictiveAnalytics";
import PrescriptiveAnalytics from "./pages/PrescriptiveAnalytics";
import ExecutiveOverview from "./pages/ExecutiveOverview";
import LoginPage from "./pages/LoginPage";
import { DEFAULT_SCOPE, useAnalytics } from "./hooks/useAnalytics";
import { DEFAULT_FORECAST_SETTINGS } from "./data/forecastSettings";
import { defaultCategoryValues, resolveDefaultCategories } from "./utils/checklistSelection";
import { getPageMeta, scrollToSection } from "./data/navigationStructure";

export default function App() {
    const [analysisScope, setAnalysisScope] = useState(DEFAULT_SCOPE);
    const [scopeRevision, setScopeRevision] = useState(0);
    const [forecastSettings, setForecastSettings] = useState(DEFAULT_FORECAST_SETTINGS);
    const [descriptiveFilters, setDescriptiveFilters] = useState({ compareBy: 'category', categories: [], province: '', provinceKey: '', provinces: [], defaultCategories: true });
    const [descriptiveMetric, setDescriptiveMetric] = useState("Revenue");
    const [descriptiveTrendMode, setDescriptiveTrendMode] = useState("monthly");
    const [descriptivePreviousYear, setDescriptivePreviousYear] = useState("");
    const [descriptiveCurrentYear, setDescriptiveCurrentYear] = useState("");
    const [forecastSelection, setForecastSelection] = useState({ category: "", categories: [], provinceKey: "", defaultCategories: true });
    const [prescriptiveSelection, setPrescriptiveSelection] = useState({ categories: [], provinceKeys: [], pairKey: "", defaultCategories: true });
    const [prescriptiveReviewMetric, setPrescriptiveReviewMetric] = useState("forecastChange");
    const [predictiveSelectionRequest, setPredictiveSelectionRequest] = useState(null);
    const [prescriptiveReturn, setPrescriptiveReturn] = useState(null);
    const [prescriptiveReturnRequest, setPrescriptiveReturnRequest] = useState(null);
    const [activePage, setActivePage] = useState("overview");
    const [activeSection, setActiveSection] = useState("ov-answers");
    const [visitedAnalyticsPages, setVisitedAnalyticsPages] = useState(() => new Set(["overview"]));
    const [isAuthenticated, setIsAuthenticated] = useState(() => {
        try {
            return window.sessionStorage.getItem("saipher-dashboard-authenticated") === "true";
        } catch {
            return false;
        }
    });
    const analyticsPages = ["overview", "descriptive-analytics", "predictive-analytics", "prescriptive-analytics"];

    useEffect(() => {
        document.title = isAuthenticated ? "SAIPHER CG DSS" : "Saipher Login";
    }, [isAuthenticated]);

    const { data: categoryScopeData, loading: categoryScopeLoading } = useAnalytics(analysisScope, isAuthenticated);
    useEffect(() => {
        if (!isAuthenticated || !categoryScopeData) return;
        const values = defaultCategoryValues(scopeCategoryOptions(categoryScopeData, analysisScope), analysisScope);
        const forecastValues = defaultCategoryValues(forecastCategoryOptions(categoryScopeData, analysisScope), analysisScope);
        if (values.length) setDescriptiveFilters(previous => resolveDefaultCategories(previous, values));
        if (forecastValues.length) setForecastSelection(previous => resolveDefaultCategories(previous, forecastValues, { forecast: true }));
    }, [isAuthenticated, categoryScopeData, analysisScope]);

    const awaitingDefaultCategories = Boolean(forecastSelection.defaultCategories && (categoryScopeLoading || defaultCategoryValues(forecastCategoryOptions(categoryScopeData, analysisScope), analysisScope).length));

    if (!isAuthenticated) {
        return <LoginPage onAuthenticated={() => {
            try {
                window.sessionStorage.setItem("saipher-dashboard-authenticated", "true");
            } catch {
                // Keep the dashboard available for this tab if session storage is disabled.
            }
            setIsAuthenticated(true);
        }} />;
    }

    function handleLogout() {
        try {
            window.sessionStorage.removeItem("saipher-dashboard-authenticated");
        } catch {
            // The in-memory login gate still closes if session storage is unavailable.
        }
        setIsAuthenticated(false);
    }

    function applyAnalysisScope(scope) {
        setAnalysisScope(scope);
        setScopeRevision(previous => previous + 1);
        setPredictiveSelectionRequest(null);
        setPrescriptiveReturn(null);
        setPrescriptiveReturnRequest(null);
        // Resolve defaults from the newly applied scope, never from the old area's results.
        setForecastSelection({ category: "", categories: [], provinceKey: "", defaultCategories: true });
        setPrescriptiveSelection({ categories: [], provinceKeys: [], pairKey: "", defaultCategories: true });
        setDescriptiveFilters({ compareBy: 'category', categories: [], province: '', provinceKey: '', provinces: [], defaultCategories: true });
    }

    function navigateToPage(page, sectionId = null) {
        if (analyticsPages.includes(page)) {
            setVisitedAnalyticsPages(previous => {
                if (previous.has(page)) return previous;
                return new Set([...previous, page]);
            });
        }
        if (typeof window !== "undefined") {
            window.__dssScrollLockUntil = Date.now() + 500;
        }
        setActivePage(page);
        const container = document.querySelector(".dss-content");
        if (container) {
            container.scrollTo({ top: 0, behavior: "instant" });
        }
        const meta = getPageMeta(page);
        if (sectionId) {
            setActiveSection(sectionId);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    scrollToSection(sectionId);
                });
            });
        } else if (meta?.subSections?.length) {
            setActiveSection(meta.subSections[0].id);
        }
    }

    function openPredictiveForecast({ category, provinceKey, pairKey, region, province }) {
        const requestId = Date.now();
        setForecastSelection({ category, categories: category ? [category] : [], provinceKey });
        setPredictiveSelectionRequest({ category, provinceKey, requestId });
        setPrescriptiveReturn({ category, pairKey, region, province });
        navigateToPage("predictive-analytics");
    }

    function returnToPrescriptiveStrategy() {
        if (!prescriptiveReturn) return;
        setPrescriptiveReturnRequest({ ...prescriptiveReturn, requestId: Date.now() });
        navigateToPage("prescriptive-analytics");
    }

    function exitPrescriptivePairForecast() {
        setPredictiveSelectionRequest(null);
        setPrescriptiveReturn(null);
        const categories = defaultCategoryValues(forecastCategoryOptions(categoryScopeData, analysisScope), analysisScope);
        setForecastSelection(resolveDefaultCategories({ category: "", categories: [], provinceKey: "", defaultCategories: true }, categories, { forecast: true }));
    }

    function renderPage(page = activePage) {

        switch (page) {

            case "overview":
                return (
                    <ExecutiveOverview
                        active={page === activePage}
                        scope={analysisScope}
                        descriptiveFilters={descriptiveFilters}
                        descriptiveMetric={descriptiveMetric}
                        onDescriptiveMetricChange={setDescriptiveMetric}
                        descriptiveTrendMode={descriptiveTrendMode}
                        onDescriptiveTrendModeChange={setDescriptiveTrendMode}
                        descriptivePreviousYear={descriptivePreviousYear}
                        onDescriptivePreviousYearChange={setDescriptivePreviousYear}
                        descriptiveCurrentYear={descriptiveCurrentYear}
                        onDescriptiveCurrentYearChange={setDescriptiveCurrentYear}
                        forecastSettings={forecastSettings}
                        forecastSelection={forecastSelection}
                        awaitingDefaultCategories={awaitingDefaultCategories}
                        prescriptiveSelection={prescriptiveSelection}
                        prescriptiveReviewMetric={prescriptiveReviewMetric}
                        onPrescriptiveReviewMetricChange={setPrescriptiveReviewMetric}
                        onPrescriptiveSelectionChange={setPrescriptiveSelection}
                        onNavigate={navigateToPage}
                        onViewPredictive={openPredictiveForecast}
                    />
                );

            case "data-management":
                return <DataManagement setActivePage={navigateToPage} />;

            case "data-preparation":
                return <DataPreparation setActivePage={navigateToPage} />;

            case "analysis-controls":
                return <AnalysisControls setActivePage={navigateToPage} scope={analysisScope} onApply={applyAnalysisScope} />;

            case "descriptive-analytics":
                return <DescriptiveAnalytics scope={analysisScope} sharedFilters={descriptiveFilters} onSharedFiltersChange={setDescriptiveFilters} active={page === activePage} metric={descriptiveMetric} onMetricChange={setDescriptiveMetric} trendMode={descriptiveTrendMode} onTrendModeChange={setDescriptiveTrendMode} previousYear={descriptivePreviousYear} onPreviousYearChange={setDescriptivePreviousYear} currentYear={descriptiveCurrentYear} onCurrentYearChange={setDescriptiveCurrentYear} onViewPredictive={() => navigateToPage("predictive-analytics")} />;

            case "predictive-analytics":
                return <PredictiveAnalytics scope={analysisScope} active={page === activePage} forecastSettings={forecastSettings} onForecastSettingsChange={setForecastSettings} forecastSelection={forecastSelection} awaitingDefaultCategories={awaitingDefaultCategories} onForecastSelectionChange={setForecastSelection} selectionRequest={predictiveSelectionRequest} prescriptiveReturn={prescriptiveReturn} onReturnToStrategy={returnToPrescriptiveStrategy} onExitPairForecast={exitPrescriptivePairForecast} onViewPrescriptive={() => navigateToPage("prescriptive-analytics")} />;

            case "prescriptive-analytics":
                return <PrescriptiveAnalytics scope={analysisScope} active={page === activePage} forecastSettings={forecastSettings} selectedSelection={prescriptiveSelection} onSelectionChange={setPrescriptiveSelection} reviewMetric={prescriptiveReviewMetric} onReviewMetricChange={setPrescriptiveReviewMetric} returnRequest={prescriptiveReturnRequest} onViewPredictive={openPredictiveForecast} />;

            default:
                return (
                    <ExecutiveOverview
                        active={page === activePage}
                        scope={analysisScope}
                        descriptiveFilters={descriptiveFilters}
                        descriptiveMetric={descriptiveMetric}
                        onDescriptiveMetricChange={setDescriptiveMetric}
                        descriptiveTrendMode={descriptiveTrendMode}
                        onDescriptiveTrendModeChange={setDescriptiveTrendMode}
                        descriptivePreviousYear={descriptivePreviousYear}
                        onDescriptivePreviousYearChange={setDescriptivePreviousYear}
                        descriptiveCurrentYear={descriptiveCurrentYear}
                        onDescriptiveCurrentYearChange={setDescriptiveCurrentYear}
                        forecastSettings={forecastSettings}
                        forecastSelection={forecastSelection}
                        awaitingDefaultCategories={awaitingDefaultCategories}
                        prescriptiveSelection={prescriptiveSelection}
                        prescriptiveReviewMetric={prescriptiveReviewMetric}
                        onPrescriptiveReviewMetricChange={setPrescriptiveReviewMetric}
                        onPrescriptiveSelectionChange={setPrescriptiveSelection}
                        onNavigate={navigateToPage}
                        onViewPredictive={openPredictiveForecast}
                    />
                );

        }

    }

    return (

        <div className="app-shell">

            <Sidebar
                activePage={activePage}
                setActivePage={navigateToPage}
                activeSection={activeSection}
                setActiveSection={setActiveSection}
            />

            <main className="dss-main">

                <Topbar
                    activePage={activePage}
                    activeSection={activeSection}
                    scope={analysisScope}
                    onLogout={handleLogout}
                />

                <SubNav
                    activePage={activePage}
                    setActivePage={navigateToPage}
                    activeSection={activeSection}
                    setActiveSection={setActiveSection}
                    scope={analysisScope}
                />

                <section className="dss-content">
                    {analyticsPages.map(page => visitedAnalyticsPages.has(page) && (
                        <div key={`${page}:${scopeRevision}`} hidden={activePage !== page}>
                            {renderPage(page)}
                        </div>
                    ))}
                    {!analyticsPages.includes(activePage) && renderPage()}

                </section>

            </main>

        </div>

    );

}
