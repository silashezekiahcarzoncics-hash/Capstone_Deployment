// Read-only representation of the published dataset for Data Preparation.
// Never consults local preparation files or writes to Supabase.
const LIVE_COLUMNS = [
  'id', 'etl_run_id', 'source_file_name', 'source_row_number', 'order_id',
  'order_status', 'return_refund_status', 'order_creation_date', 'year_month',
  'region', 'province', 'raw_province', 'raw_city', 'raw_product_name',
  'category', 'quantity', 'returned_quantity', 'net_quantity',
  'line_revenue', 'is_exact_duplicate', 'is_included_in_analysis', 'exclusion_reason'
].join(',');
const FALLBACK = 'Other / Unclassified';
const s = value => String(value ?? '').trim();
const dateOnly = value => s(value).slice(0, 10);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(dateOnly(value)) && !Number.isNaN(Date.parse(dateOnly(value)));
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : null;
const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true });

export function createLivePreparationService(client, { ttl = 60000 } = {}) {
  let cached = null;
  let expires = 0;
  let inFlight = null;
  async function load(force = false) {
    if (!client) throw new Error('Supabase is not configured.');
    if (!force && cached && Date.now() < expires) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const rows = [];
      let expected = null;
      let offset = 0;
      let pageSize = 1000;
      // Adapt to a lower project-level PostgREST row limit on the first request.
      while (expected === null || offset < expected) {
        const { data, error, count } = await client.from('master_transactions')
          .select(LIVE_COLUMNS, { count: 'exact' }).order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`Could not read published transactions: ${error.message}`);
        if (!Array.isArray(data) || count === null) throw new Error('Published transaction response is incomplete.');
        if (expected === null) {
          expected = count;
          if (expected > 0 && data.length === 0) throw new Error('Supabase returned an empty first page of a populated dataset.');
          pageSize = data.length || pageSize;
        }
        if (expected !== count) throw new Error('Published data changed while reading; refresh and try again.');
        const required = Math.min(pageSize, expected - offset);
        if (data.length !== required) throw new Error('Published data page was incomplete; refresh and try again.');
        rows.push(...data);
        offset += data.length;
      }
      if (rows.length !== expected || new Set(rows.map(row => row.id)).size !== rows.length) {
        throw new Error('Published dataset changed during loading; refresh and try again.');
      }
      const productMap = new Map();
      const geographyMap = new Map();
      const orders = new Set();
      const months = new Set();
      const regions = new Set();
      const provinces = new Set();
      const sourceFiles = new Set();
      const nonCompletedOrders = new Map();
      const returnOrders = new Map();
      const duplicateRows = [];
      let included = 0, invalidDates = 0, invalidNumbers = 0, noDate = 0;
      let minDate = null, maxDate = null;
      for (const row of rows) {
        if (row.is_included_in_analysis === true && row.is_exact_duplicate !== true) included++;
        if (s(row.source_file_name)) sourceFiles.add(s(row.source_file_name));
        if (s(row.order_id)) orders.add(s(row.order_id));
        if (s(row.region)) regions.add(s(row.region));
        if (s(row.province)) provinces.add(s(row.province));
        if (s(row.year_month)) months.add(s(row.year_month));
        const date = dateOnly(row.order_creation_date);
        if (validDate(row.order_creation_date)) {
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        } else { invalidDates++; if (!date) noDate++; }
        if ([row.quantity, row.net_quantity, row.line_revenue].some(value => value == null || safeNumber(value) === null)) invalidNumbers++;
        if (row.is_exact_duplicate === true) duplicateRows.push(row);
        if (s(row.order_status).toLowerCase() !== 'completed') nonCompletedOrders.set(s(row.order_id) || row.id, {
          orderId: row.order_id, orderStatus: row.order_status, sourceFile: row.source_file_name
        });
        if (s(row.return_refund_status)) returnOrders.set(s(row.order_id) || row.id, {
          orderId: row.order_id, returnRefundStatus: row.return_refund_status,
          returnedQuantity: row.returned_quantity, sourceFile: row.source_file_name
        });
        const product = s(row.raw_product_name);
        if (product && !productMap.has(product)) productMap.set(product, {
          rawProductName: product, category: s(row.category) || FALLBACK,
          status: s(row.category) && s(row.category) !== FALLBACK ? 'Mapped' : 'Review'
        });
        const geographyKey = JSON.stringify([row.raw_province, row.raw_city]);
        if (!geographyMap.has(geographyKey)) geographyMap.set(geographyKey, {
          rawProvince: row.raw_province, rawCity: row.raw_city,
          region: row.region, province: row.province,
          status: s(row.region) && s(row.province) ? 'Mapped' : 'Review'
        });
      }
      const products = [...productMap.values()].sort((a,b) => compare(a.rawProductName,b.rawProductName));
      const geography = [...geographyMap.values()].sort((a,b) => compare(s(a.province),s(b.province)));
      const monthsSorted = [...months].filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
      const { data: runData, error: runError } = await client.from('etl_runs')
        .select('run_id,created_at,status,source_row_count').eq('status', 'completed')
        .order('created_at', { ascending: false }).limit(1);
      if (runError) throw new Error(`Could not read live publication metadata: ${runError.message}`);
      const latest = runData?.[0] || null;
      return {
        status: 'Live', source: 'supabase', records: rows.length,
        latestRunId: latest?.run_id ?? null,
        lastPublishedAt: latest?.created_at ?? null,
        profile: {
          filesImported: sourceFiles.size, transactionLines: rows.length,
          uniqueOrders: orders.size, productListings: products.length,
          regions: regions.size, provinces: provinces.size,
          coverage: minDate && maxDate ? `${minDate} – ${maxDate}` : 'No valid dates'
        },
        quality: {
          invalidDateRecords: invalidDates, missingDateRecords: noDate,
          invalidNumericRecords: invalidNumbers, duplicateRows: duplicateRows.length,
          nonCompletedOrders: nonCompletedOrders.size, returnRefundOrders: returnOrders.size,
          includedRows: included, excludedRows: rows.length - included
        },
        products, geography,
        time: { preparedRecords: rows.length - invalidDates, periods: monthsSorted, needsReview: invalidDates },
        statusReview: [...nonCompletedOrders.values()],
        returnReview: [...returnOrders.values()],
        duplicateReview: duplicateRows.map(row => ({
          orderId: row.order_id, sourceFile: row.source_file_name, sourceRow: row.source_row_number
        }))
      };
    })();
    try {
      const result = await inFlight;
      cached = result;
      expires = Date.now() + ttl;
      return result;
    } finally { inFlight = null; }
  }
  function invalidate() { cached = null; expires = 0; }
  return { load, invalidate };
}
