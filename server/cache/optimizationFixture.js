// Deterministic synthetic data for regression tests and the local benchmark.
export function fixture({ months = 18, categories = 3, provinces = 2, orders = 3 } = {}) {
    const rows = [];
    for (let m = 0; m < months; m++) {
        const month = new Date(Date.UTC(2023, m, 1)).toISOString().slice(0, 7);
        const last = new Date(Date.UTC(2023, m + 1, 0)).toISOString().slice(0, 10);
        for (let p = 0; p < provinces; p++) for (let o = 0; o < orders; o++) for (let c = 0; c < categories; c++) {
            const returned = o === 1 && m % 4 === 0 ? 1 : 0;
            rows.push({ id: String(rows.length + 1), order_id: `${m}-${p}-${o}`, order_creation_date: o === 0 ? `${month}-01` : last,
                year_month: month, region: `R${p % 2}`, province: `P${p}`, category: `C${c}`, line_revenue: (m + 2) * (c + 1) * 1.13 + o * 0.23,
                quantity: 3, net_quantity: 3 - returned, returned_quantity: returned, return_refund_status: returned ? 'Approved' : '',
                is_included_in_analysis: true, is_exact_duplicate: false });
        }
    }
    rows.push({ ...rows[0], id: 'excluded', is_included_in_analysis: false }, { ...rows[0], id: 'duplicate', is_exact_duplicate: true });
    return rows;
}
export const adjustment = [{ id: 'test-gap', start_date: '2023-03-01', end_date: '2023-03-31', kind: 'data_gap', exclude_from_training: true, reason: 'Test gap' }];
