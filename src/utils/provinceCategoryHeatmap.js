const metricValue = (item, metric) => {
    if (item?.[metric] == null || item[metric] === "") return null;
    const value = Number(item?.[metric]);
    return Number.isFinite(value) ? value : null;
};

const compareByMetric = metric => (left, right) =>
    (metricValue(right, metric) ?? -Infinity) - (metricValue(left, metric) ?? -Infinity)
    || left.name.localeCompare(right.name)
    || String(left.region || "").localeCompare(String(right.region || ""));

export function buildProvinceCategoryHeatmap(regions = [], categories = [], metric = "revenue", limit = 10) {
    const maximumEntries = Math.max(0, Math.min(10, Math.floor(Number(limit) || 0)));
    const provinceRows = regions.flatMap(region => (region.provinces || [])
        .map(province => ({ ...province, region: region.name })));
    const provinces = provinceRows
        .filter(province => metricValue(province, metric) !== null)
        .sort(compareByMetric(metric))
        .slice(0, maximumEntries);
    const rankedCategories = categories
        .filter(category => metricValue(category, metric) !== null)
        .sort(compareByMetric(metric))
        .slice(0, maximumEntries);

    const cells = provinces.map(province => {
        const categoryValues = new Map((province.categories || []).map(category => [category.name, category]));
        return rankedCategories.map(category => {
            const entry = categoryValues.get(category.name);
            return entry ? metricValue(entry, metric) : null;
        });
    });
    const availableValues = cells.flat().filter(value => value !== null);

    return {
        provinces,
        categories: rankedCategories,
        cells,
        maxValue: Math.max(0, ...availableValues)
    };
}

export function provinceCategorySelectionFilters(province, category) {
    return {
        compareBy: "category",
        categories: [category.name],
        province: province.name,
        provinceKey: JSON.stringify([province.region, province.name]),
        provinces: []
    };
}
