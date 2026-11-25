// [] is the explicit aggregate option; defaultCategories is an unresolved
// request to select each available category, not the aggregate option.
export function defaultCategoryValues(categories = [], scope = {}) {
    return [...new Set(categories.filter(name => name && (!Array.isArray(scope.categories) || scope.categories.includes(name))))]
        .sort((a, b) => a.localeCompare(b));
}
export function resolveDefaultCategories(selection, values, { forecast = false } = {}) {
    if (!selection.defaultCategories || !values.length) return selection;
    const { defaultCategories, ...rest } = selection;
    return { ...rest, categories: [...values], ...(forecast ? { category: values.length === 1 ? values[0] : '' } : {}) };
}
export function recommendationFilters(selection = {}, availableCategories = []) {
    return {
        categories: selection.defaultCategories ? [...availableCategories] : Array.isArray(selection.categories) ? selection.categories : selection.category && selection.category !== 'All Categories' ? [selection.category] : [],
        provinceKeys: Array.isArray(selection.provinceKeys) ? selection.provinceKeys : selection.provinceKey ? [selection.provinceKey] : []
    };
}
export function matchesRecommendation(row, { categories = [], provinceKeys = [] }) {
    return (!categories.length || categories.includes(row.category)) &&
        (!provinceKeys.length || provinceKeys.includes(JSON.stringify([row.region, row.province])));
}
export function recommendationSelectionLabel(categories = [], provinceKeys = []) {
    const label = categories.length === 0 ? 'All categories' : categories.length === 1 ? categories[0] : `${categories.length} selected categories`;
    return `${label}${provinceKeys.length ? ` · ${provinceKeys.length} selected ${provinceKeys.length === 1 ? 'province' : 'provinces'}` : ''}`;
}
