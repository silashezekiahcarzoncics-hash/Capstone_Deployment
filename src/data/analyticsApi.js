const API_BASE = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:4000/api"
).replace(/\/$/, "");

const ANALYTICS_CACHE_TTL = 5 * 60 * 1000;
const ANALYTICS_CACHE_LIMIT = 24;
const analyticsMemoryCache = new Map();

function getCached(key) {
  const entry = analyticsMemoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    analyticsMemoryCache.delete(key);
    return null;
  }
  analyticsMemoryCache.delete(key);
  analyticsMemoryCache.set(key, entry);
  return entry.data;
}

function setCached(key, data) {
  analyticsMemoryCache.delete(key);
  analyticsMemoryCache.set(key, { data, expiresAt: Date.now() + ANALYTICS_CACHE_TTL });
  while (analyticsMemoryCache.size > ANALYTICS_CACHE_LIMIT) {
    analyticsMemoryCache.delete(analyticsMemoryCache.keys().next().value);
  }
}

export function clearAnalyticsMemoryCache() {
  analyticsMemoryCache.clear();
}

export function getCachedScopedAnalytics(scope) {
  const filters = new URLSearchParams({ filters: JSON.stringify(scope) }).get("filters");
  return getCached(`${API_BASE}/analytics?filters=${filters}`);
}

export function getCachedDescriptiveAnalytics(scope, descriptiveFilters = {}) {
  const categories = [...new Set(descriptiveFilters.categories || [])].sort();
  const params = new URLSearchParams({
    filters: JSON.stringify(scope),
    descriptiveCategory: categories.length ? "" : descriptiveFilters.category || "",
    descriptiveCategories: JSON.stringify(categories),
    descriptiveProvince: descriptiveFilters.province || "",
    descriptiveProvinceKeys: JSON.stringify([...new Set(descriptiveFilters.provinceKeys || [])].sort())
  });
  return getCached(`${API_BASE}/analytics?${params}`);
}

export function getCachedPredictive(options) {
  const { scope, horizon, target, model = "arima", missingMonthMode = "strict", category = "", provinceKey = "" } = options;
  const params = new URLSearchParams({ filters: JSON.stringify(scope), horizon: String(horizon), target, model, missingMonthMode, category, provinceKey });
  return getCached(`${API_BASE}/forecasts?${params}`);
}

export function getCachedPrescriptive(options) {
  const { scope, horizon = 6, target = "revenue", model = "arima", missingMonthMode = "strict" } = options;
  const params = new URLSearchParams({ filters: JSON.stringify(scope), horizon: String(horizon), target, model, missingMonthMode });
  return getCached(`${API_BASE}/prescriptive?${params}`);
}

async function request(url, options = {}) {
  const { headers, cacheKey, refresh = false, ...rest } = options;
  const key = cacheKey ? `${API_BASE}${cacheKey}` : null;
  if (key && !refresh) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  let response;

  try {
    response = await fetch(`${API_BASE}${url}`, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(headers || {})
      }
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      `Cannot reach the analytics server at ${API_BASE}. ` +
      "Make sure the backend is running (npm run server)."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Server returned HTTP ${response.status} without valid JSON.`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error || `Request failed with HTTP ${response.status}.`
    );
  }

  if (key) setCached(key, data);
  return data;
}

export function fetchScopedAnalytics(scope, signal, refresh = false) {
  if (refresh) clearAnalyticsMemoryCache();
  const query = new URLSearchParams({ filters: JSON.stringify(scope) });
  if (refresh) query.set("refresh", "1");
  const url = `/analytics?${query}`;
  return request(url, { signal, cacheKey: `/analytics?filters=${query.get("filters")}`, refresh });
}

export function fetchDescriptiveAnalytics(scope, descriptiveFilters = {}, signal, refresh = false) {
  if (refresh) clearAnalyticsMemoryCache();
  const categories = [...new Set(descriptiveFilters.categories || [])].sort();
  const params = new URLSearchParams({
    filters: JSON.stringify(scope),
    descriptiveCategory: categories.length ? "" : descriptiveFilters.category || "",
    descriptiveCategories: JSON.stringify(categories),
    descriptiveProvince: descriptiveFilters.province || "",
    descriptiveProvinceKeys: JSON.stringify([...new Set(descriptiveFilters.provinceKeys || [])].sort())
  });
  if (refresh) params.set("refresh", "1");
  const url = `/analytics?${params}`;
  params.delete("refresh");
  return request(url, { signal, cacheKey: `/analytics?${params}`, refresh });
}

export function fetchAnalyticsOptions(signal) {
  return request("/analytics/options", { signal });
}

export function fetchDescriptive(scope, signal) {
  return request("/analytics/descriptive", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope)
  });
}

export function fetchPredictive({ scope, horizon, target, model = "arima", missingMonthMode = "strict", category = "", provinceKey = "", chartOnly = false, refresh = false }, signal) {
  if (refresh) clearAnalyticsMemoryCache();
  const params = new URLSearchParams({
    filters: JSON.stringify(scope),
    horizon: String(horizon),
    target,
    model,
    missingMonthMode,
    category,
    provinceKey,
    ...(chartOnly ? { chartOnly: "1" } : {})
  });
  if (refresh) params.set("refresh", "1");
  const url = `/forecasts?${params}`;
  params.delete("refresh");
  return request(url, { signal, cacheKey: `/forecasts?${params}`, refresh });
}

export function fetchPrescriptive({ scope, horizon = 6, target = "revenue", model = "arima", missingMonthMode = "strict", refresh = false }, signal) {
  if (refresh) clearAnalyticsMemoryCache();
  const params = new URLSearchParams({ filters: JSON.stringify(scope), horizon: String(horizon), target, model, missingMonthMode });
  if (refresh) params.set("refresh", "1");
  const url = `/prescriptive?${params}`;
  params.delete("refresh");
  return request(url, { signal, cacheKey: `/prescriptive?${params}`, refresh });
}
