import { normalizeGeographicScope } from "./geographicScope.js";
/** Module selections may only narrow the applied global Analysis Scope. */
export function narrowScope(scope = {}, { categories = [], provinceKeys = [] } = {}) {
    const globalCategories = Array.isArray(scope.categories) ? scope.categories : null;
    const chosenCategories = [...new Set(categories.filter(Boolean))];
    const validCategories = globalCategories === null ? chosenCategories : chosenCategories.filter(name => globalCategories.includes(name));
    const globalProvinceKeys = Array.isArray(scope.provinceKeys) ? scope.provinceKeys : null;
    const chosenProvinces = [...new Set(provinceKeys.filter(Boolean))];
    const validProvinces = globalProvinceKeys === null ? chosenProvinces : chosenProvinces.filter(key => globalProvinceKeys.includes(key));
    return normalizeGeographicScope({
        ...scope,
        categories: chosenCategories.length ? validCategories : scope.categories,
        provinceKeys: chosenProvinces.length ? validProvinces : scope.provinceKeys
    });
}
export function provinceKey(region, province) {
    return JSON.stringify([region, province]);
}
export function scopeSelectionLabel(categories = [], provinceKeys = [], category = '', province = '') {
    return [categories.length ? `${categories.length} selected ${categories.length === 1 ? 'category' : 'categories'}` : category || 'All Categories',
        provinceKeys.length ? `${provinceKeys.length} selected ${provinceKeys.length === 1 ? 'province' : 'provinces'}` : province || 'All Provinces'].join(' × ');
}
