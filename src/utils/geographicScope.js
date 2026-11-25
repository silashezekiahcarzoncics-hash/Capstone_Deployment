import { hasGeographicRestriction } from "../../server/geographicScope.js";
export { normalizeGeographicScope, hasGeographicRestriction } from "../../server/geographicScope.js";

export const geographicProvinceKey = (region, province) => JSON.stringify([region, province]);

export function scopedGeography(geography = [], scope = {}) {
    const regions = Array.isArray(scope.regions) ? new Set(scope.regions) : null;
    const provinces = Array.isArray(scope.provinceKeys) ? new Set(scope.provinceKeys) : null;
    return geography.filter(item => (!regions || regions.has(item.region)) &&
        (!scope.region || scope.region === 'All Regions' || item.region === scope.region))
        .map(item => ({ ...item, provinces: item.provinces.filter(name =>
            (!scope.province || scope.province === 'All Provinces' || name === scope.province) &&
            (!provinces || provinces.has(geographicProvinceKey(item.region, name)))) }))
        .filter(item => item.provinces.length);
}

export function provinceOptions(geography = []) {
    return geography.flatMap(item => item.provinces.map(name => ({
        value: geographicProvinceKey(item.region, name), name, region: item.region, label: `${name} · ${item.region}`
    }))).sort((a, b) => a.label.localeCompare(b.label));
}

export function explicitSelection(choice, available) {
    if (choice == null) return [...available];
    const selected = new Set(choice);
    return available.filter(value => selected.has(value));
}

// All checked is semantically the unrestricted global scope, not a local chart
// aggregation setting. Collapse it to null to avoid long URLs and cache splits.
export function compactSelection(selected, available) {
    const values = explicitSelection(selected, available);
    return available.length && values.length === available.length ? null : [...new Set(values)].sort();
}

export function geographicScopeLabel(scope = {}) {
    const region = Array.isArray(scope.regions)
        ? scope.regions.length === 0 ? 'No Regions' : scope.regions.length === 1 ? scope.regions[0] : `${scope.regions.length} regions selected`
        : scope.region || 'All Regions';
    const province = Array.isArray(scope.provinceKeys)
        ? scope.provinceKeys.length === 0 ? 'No Provinces' : scope.provinceKeys.length === 1 ? JSON.parse(scope.provinceKeys[0]).join(' · ') : `${scope.provinceKeys.length} provinces selected`
        : scope.province || 'All Provinces';
    return `${region} · ${province}`;
}

// Categories without any eligible records in a restricted area must not be
// automatically requested as forecast series. Keep old all-area defaults.
export function scopeCategoryOptions(analytics, scope) {
    return hasGeographicRestriction(scope) && analytics
        ? (analytics.categories || []).map(item => item.name)
        : analytics?.scope?.categories || [];
}

export function forecastCategoryOptions(analytics, scope) {
    return analytics?.forecastScopeOptions?.categories ?? scopeCategoryOptions(analytics, scope);
}
