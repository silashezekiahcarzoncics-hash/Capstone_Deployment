import { categorySeriesColor } from './categorySeriesColor.js';

export const provinceComparisonKey = (region, province) => JSON.stringify([region, province]);

export function buildProvinceTrendSeries({ regions = [], months = [], selected = [], available = [] } = {}) {
    const availableLabels = available.map(item => item.label || item.name || String(item));
    const provinceByKey = new Map(regions.flatMap(region => (region.provinces || []).map(province => [
        provinceComparisonKey(region.name, province.name),
        { ...province, region: region.name }
    ])));
    return selected.flatMap(key => {
        const option = available.find(item => item.value === key);
        const province = provinceByKey.get(key);
        const name = option?.label || `${province?.name || key} · ${province?.region || ''}`.trim();
        const monthly = new Map((province?.monthly || []).map(row => [row.name, row]));
        return [{
            name,
            color: categorySeriesColor(name, availableLabels),
            rows: months.map(period => ({
                ...period,
                ...(monthly.get(period.name) || { revenue: 0, orders: 0, quantity: 0, rows: 0 })
            }))
        }];
    });
}
