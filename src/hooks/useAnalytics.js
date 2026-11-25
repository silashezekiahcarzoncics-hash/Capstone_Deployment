import { useEffect, useState } from "react";
import {
    fetchDescriptiveAnalytics,
    fetchScopedAnalytics,
    getCachedDescriptiveAnalytics,
    getCachedScopedAnalytics
} from "../data/analyticsApi";
import { describeAdjustment } from "../data/adjustmentText";

export const DEFAULT_SCOPE = {
    period: "All Available Data", returns: "Include All",
    region: "All Regions", province: "All Provinces", categories: null, start: "", end: ""
};

export function useAnalytics(scope = DEFAULT_SCOPE, active = true, descriptiveFilters = null, { keepPreviousOnError = false, keepPreviousData = false } = {}) {
    const selectedCategories = [...new Set(descriptiveFilters?.categories || [])].sort();
    const provinceKeys = [...new Set(descriptiveFilters?.provinceKeys || [])].sort();
    const hasDescriptiveFilters = Boolean(selectedCategories.length || descriptiveFilters?.category || descriptiveFilters?.province || provinceKeys.length);
    const descriptiveKey = hasDescriptiveFilters
        ? { category: descriptiveFilters.category || "", categories: selectedCategories, province: descriptiveFilters.province || "", provinceKeys }
        : null;
    const key = JSON.stringify(hasDescriptiveFilters ? [scope, descriptiveKey] : scope);
    const getCachedData = () => hasDescriptiveFilters
        ? getCachedDescriptiveAnalytics(scope, descriptiveKey)
        : getCachedScopedAnalytics(scope);
    const [state, setState] = useState(() => {
        const data = getCachedData();
        return { data, error: "", loading: !data, key };
    });
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!active) return undefined;
        const controller = new AbortController();
        let refreshRequested = retry > 0;
        let running = false;
        async function load() {
            if (running || controller.signal.aborted) return;
            running = true;
            try {
                const result = hasDescriptiveFilters
                    ? await fetchDescriptiveAnalytics(scope, descriptiveKey, controller.signal, refreshRequested)
                    : await fetchScopedAnalytics(scope, controller.signal, refreshRequested);
                refreshRequested = false;
                if (controller.signal.aborted) return;
                setState({ data: result, error: "", loading: false, key });
            } catch (error) {
                if (!controller.signal.aborted && error.name !== "AbortError") setState(previous => ({ data: keepPreviousOnError ? previous.data : null, error: error.message, loading: false, key }));
            } finally { running = false; }
        }
        load();
        window.addEventListener("focus", load);
        return () => {
            controller.abort();
            window.removeEventListener("focus", load);
        };
    }, [key, retry, active]);
    const current = state.key === key ? state : (() => {
        const data = getCachedData();
        return { data: data || (keepPreviousData ? state.data : null), error: "", loading: !data, key };
    })();
    return { ...current, refresh: () => setRetry(value => value + 1) };
}

// Month-over-month comparison between the two latest COMPLETE months. A part-month
// (data ends before the month-end) is never compared as if it were a full month.
export function monthOverMonth(trend = [], key = "revenue") {
    // Part-months and explicitly adjusted months are not comparable with a normal month.
    const complete = trend.filter(row => !row.partial && !row.adjusted);
    const latest = complete.at(-1);
    const previous = complete.at(-2);
    const latestValue = Number(latest?.[key]) || 0;
    const previousValue = Number(previous?.[key]) || 0;
    const adjustedMonths = trend.filter(row => row.adjusted && row.name > (complete.at(-2)?.name ?? ""));
    return {
        latestMonth: latest?.name ?? null,
        latest: latestValue,
        change: previous && previousValue ? (latestValue - previousValue) / previousValue * 100 : null,
        partialMonth: trend.find(row => row.partial && row.name > (latest?.name ?? ""))?.name ?? null,
        adjustedMonths: adjustedMonths.map(row => row.name),
        adjustmentText: adjustedMonths.length
            ? `${adjustedMonths.map(row => monthLabel(row.name)).join(", ")} include ${describeAdjustment([...new Set(adjustedMonths.flatMap(row => row.adjustmentKinds))], adjustedMonths.find(row => row.adjustmentReason)?.adjustmentReason || "")} and are left out of the month-over-month comparison.`
            : "",
        adjustmentHasNoSalesOnly: adjustedMonths.length > 0 && adjustedMonths.every(row => row.adjustmentKinds.length > 0 && row.adjustmentKinds.every(kind => kind === "closure" || kind === "no_sales"))
    };
}

export const money = value => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(value || 0);
export const monthLabel = value => value ? new Date(`${value.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" }) : "No data";
export const dateRange = scope => scope?.dateMin ? `${monthLabel(scope.dateMin)} – ${monthLabel(scope.dateMax)}` : "No prepared data";
