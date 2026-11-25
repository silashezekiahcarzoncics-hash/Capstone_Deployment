// A missing/null list means unrestricted; an explicit empty list means no matches.
// Keep legacy scalar scope fields supported for older clients. Canonical ordering
// makes equivalent checklists share caches independent of click order.
export function normalizeGeographicScope(scope = {}) {
    const result = { ...scope };
    for (const field of ['regions', 'provinceKeys']) {
        const values = scope[field];
        if (values == null) { delete result[field]; continue; }
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim())) {
            throw new Error(`Invalid geographic scope: ${field}.`);
        }
        if (field === 'provinceKeys') {
            result[field] = [...new Set(values.map(value => {
                let pair;
                try { pair = JSON.parse(value); } catch { throw new Error('Invalid geographic scope: province key.'); }
                if (!Array.isArray(pair) || pair.length !== 2 || pair.some(part => typeof part !== 'string' || !part.trim())) {
                    throw new Error('Invalid geographic scope: province key.');
                }
                return JSON.stringify(pair);
            }))].sort();
        } else result[field] = [...new Set(values)].sort();
    }
    return result;
}


export function hasGeographicRestriction(scope = {}) {
    return Array.isArray(scope.regions) || Array.isArray(scope.provinceKeys) ||
        Boolean(scope.region && scope.region !== 'All Regions') || Boolean(scope.province && scope.province !== 'All Provinces');
}
