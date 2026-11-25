// One pass over eligible transactions; keep original row positions so sums,
// rounding, stable sorting and distinct-order behavior are unchanged.
export function buildTransactionIndex(rows, { eligible, regionName, provinceName, categoryName }) {
    const eligibleRows = [];
    const dimensions = { category: new Map(), region: new Map(), province: new Map(), provinceKey: new Map() };
    for (const row of rows) {
        if (!eligible(row)) continue;
        const position = eligibleRows.length;
        eligibleRows.push(row);
        const region = regionName(row), province = provinceName(row);
        const keys = { category: categoryName(row), region, province, provinceKey: JSON.stringify([region, province]) };
        for (const [dimension, key] of Object.entries(keys)) {
            const map = dimensions[dimension];
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(position);
        }
    }
    function candidates(constraints) {
        let best = null, size = eligibleRows.length;
        for (const [dimension, values] of constraints) {
            if (!Array.isArray(values)) continue;
            const lists = [...new Set(values)].map(value => dimensions[dimension].get(value) || []);
            const count = lists.reduce((sum, list) => sum + list.length, 0);
            if (count < size) { best = lists; size = count; }
        }
        if (!best || (best.length > 1 && size > eligibleRows.length / 2)) return eligibleRows;
        if (best.length === 1) return best[0].map(position => eligibleRows[position]);
        return best.flat().sort((a, b) => a - b).map(position => eligibleRows[position]);
    }
    return { eligibleRows, candidates };
}
