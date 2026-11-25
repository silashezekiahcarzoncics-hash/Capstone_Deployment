const PAGE_SIZE = 1000;
const REQUIRED_TRANSACTION_FIELDS = [
  "id", "etl_run_id", "order_id", "order_status", "return_refund_status",
  "order_creation_date", "year_month", "region", "province", "raw_province",
  "raw_city", "raw_product_name", "category", "quantity", "returned_quantity",
  "net_quantity", "line_revenue", "is_exact_duplicate", "is_included_in_analysis"
];

async function readAll(client, table, orderColumn) {
  let countExpected = null;
  let offset = 0;
  let pageSize = PAGE_SIZE;
  const rows = [];
  while (countExpected === null || offset < countExpected) {
    const { data, error, count } = await client.from(table)
      .select("*", { count: "exact" })
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(20000));
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error(`Supabase returned an incomplete ${table} response.`);
    }
    if (countExpected === null) {
      countExpected = count;
      if (countExpected > 0 && data.length === 0) throw new Error(`${table} returned an empty page for a nonempty table.`);
      if (countExpected > 0) pageSize = data.length;
    } else if (countExpected !== count) {
      throw new Error(`${table} changed during synchronization. Retry the operation.`);
    }
    const expectedLength = Math.min(pageSize, countExpected - offset);
    if (data.length !== expectedLength) throw new Error(`The ${table} download is incomplete at row ${offset + data.length + 1}.`);
    rows.push(...data);
    offset += data.length;
  }
  return rows;
}

function assertUnique(rows, key, label) {
  const values = new Set();
  for (const row of rows) {
    const value = key(row);
    if (values.has(value)) throw new Error(`Supabase returned duplicate ${label} entries.`);
    values.add(value);
  }
}

function validateTransactions(rows) {
  if (!rows.length) throw new Error("Supabase has no published transactions to synchronize.");
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const missing = REQUIRED_TRANSACTION_FIELDS.filter(field => !(field in row));
    if (missing.length) throw new Error(`Transaction row ${index + 1} is missing required fields: ${missing.join(", ")}.`);
    if (row.id == null || !String(row.order_id ?? "").trim() || !String(row.raw_product_name ?? "").trim()) {
      throw new Error(`Transaction row ${index + 1} is missing a record ID, order ID, or product name.`);
    }
    if (typeof row.is_exact_duplicate !== "boolean" || typeof row.is_included_in_analysis !== "boolean") {
      throw new Error(`Transaction row ${index + 1} has invalid analysis flags.`);
    }
    for (const field of ["quantity", "net_quantity", "line_revenue"]) {
      if (row[field] == null || !Number.isFinite(Number(row[field]))) throw new Error(`Transaction row ${index + 1} has an invalid ${field} value.`);
    }
  }
  assertUnique(rows, row => String(row.id), "transaction ID");
}

const distinctCount = values => new Set(values.map(value => String(value ?? "").trim()).filter(Boolean)).size;

export async function downloadPublishedSnapshot(client) {
  if (!client) throw new Error("Supabase is not configured on the backend.");
  const transactions = await readAll(client, "master_transactions", "id");
  validateTransactions(transactions);
  const productMapping = (await readAll(client, "product_mapping", "id")).map(row => ({
    raw_product_name: row.raw_product_name, category: row.category,
    mapping_status: row.mapping_status, updated_at: row.updated_at
  }));
  const geographicMapping = (await readAll(client, "geographic_mapping", "id")).map(row => ({
    raw_province: row.raw_province, raw_city: row.raw_city, region: row.region,
    province: row.province, updated_at: row.updated_at
  }));
  assertUnique(productMapping, row => String(row.raw_product_name ?? "").trim(), "product mapping");
  assertUnique(geographicMapping, row => JSON.stringify([row.raw_province ?? null, row.raw_city ?? null]), "geographic mapping");

  const { data: runs, error: runError } = await client.from("etl_runs")
    .select("run_id,created_at,status,source_row_count")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .abortSignal(AbortSignal.timeout(20000));
  if (runError) throw new Error(`Could not read publication metadata: ${runError.message}`);
  if (!Array.isArray(runs)) throw new Error("Supabase returned incomplete publication metadata.");

  const dates = transactions.map(row => String(row.order_creation_date ?? "").slice(0, 10))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))).sort();
  const sourceFiles = distinctCount(transactions.map(row => row.source_file_name));
  const summary = {
    profile: {
      filesImported: sourceFiles,
      transactionLines: transactions.length,
      uniqueOrders: distinctCount(transactions.map(row => row.order_id)),
      uniqueProducts: distinctCount(transactions.map(row => row.raw_product_name)),
      dateCoverage: { min: dates[0] || null, max: dates.at(-1) || null }
    },
    quality: {
      invalidDateRecords: transactions.filter(row => !/^\d{4}-\d{2}-\d{2}/.test(String(row.order_creation_date ?? ""))).length,
      invalidNumericRecords: transactions.filter(row => [row.quantity, row.net_quantity, row.line_revenue].some(value => value == null || !Number.isFinite(Number(value)))).length,
      duplicateRows: transactions.filter(row => row.is_exact_duplicate === true).length
    }
  };
  const latest = runs[0] ? {
    run_id: runs[0].run_id, created_at: runs[0].created_at,
    status: runs[0].status, source_row_count: runs[0].source_row_count
  } : null;
  return {
    version: 1,
    source: "supabase",
    syncedAt: new Date().toISOString(),
    records: transactions.length,
    mappingCounts: { products: productMapping.length, geography: geographicMapping.length },
    latestRun: latest,
    summary,
    transactions: transactions.map(({ subcategory: _removedSubcategory, ...row }) => row),
    productMapping,
    geographicMapping
  };
}
