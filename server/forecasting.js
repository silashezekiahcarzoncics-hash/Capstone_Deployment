import { analyzeRows, selectAnalyticsRows, datasetBounds, completenessNote, shiftMonth, ORDER_COUNT_NOTE } from './analytics.js';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const nextMonth = shiftMonth;


const FORECAST_HORIZONS = [3, 6, 9, 12];
const MINIMUM_HISTORY = 3;
const meanOf = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const pairKey = (region, province) => JSON.stringify([region, province]);

const MODEL_NAMES = { arima: 'ARIMA(1,1,1)', prophet: 'Prophet-style trend and yearly seasonality', random_forest: 'Random Forest Regression', croston_sba: 'Croston SBA (intermittent demand)', tsb: 'Teunter–Syntetos–Babai (intermittent demand)' };
export const MISSING_MONTH_MODES = Object.freeze(['strict', 'confirmed_zero', 'intermittent']);

function solveLinear(matrix, vector) {
    const size = vector.length;
    const rows = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        const divisor = rows[column][column];
        if (Math.abs(divisor) < 1e-10) continue;
        for (let j = column; j <= size; j += 1) rows[column][j] /= divisor;
        for (let row = 0; row < size; row += 1) {
            if (row === column) continue;
            const factor = rows[row][column];
            for (let j = column; j <= size; j += 1) rows[row][j] -= factor * rows[column][j];
        }
    }
    return rows.map(row => Number.isFinite(row[size]) ? row[size] : 0);
}

function regress(features, labels, ridge = 1e-6) {
    const width = features[0].length;
    const matrix = Array.from({ length: width }, () => Array(width).fill(0));
    const vector = Array(width).fill(0);
    features.forEach((row, sample) => row.forEach((x, i) => {
        vector[i] += x * labels[sample];
        row.forEach((y, j) => { matrix[i][j] += x * y; });
    }));
    for (let i = 1; i < width; i += 1) matrix[i][i] += ridge;
    return solveLinear(matrix, vector);
}

// ARIMA(1,1,1) without drift, estimated by conditional sum of squares on the
// first differences: z[t] = phi*z[t-1] + e[t] + theta*e[t-1]. phi and theta are
// found by a bounded grid search followed by a local refinement, so the fit is
// deterministic and does not depend on any hard-coded MA coefficient.
const ARIMA_MIN_DIFFERENCES = 6;
function arimaResiduals(differences, phi, theta) {
    const residuals = [0];
    for (let index = 1; index < differences.length; index += 1) {
        residuals.push(differences[index] - phi * differences[index - 1] - theta * residuals[index - 1]);
    }
    return residuals;
}
function arimaFit(differences) {
    const sse = (phi, theta) => arimaResiduals(differences, phi, theta).reduce((sum, e) => sum + e * e, 0);
    let best = { phi: 0, theta: 0, score: sse(0, 0) };
    const search = (center, radius, step) => {
        for (let phi = Math.max(-0.95, center.phi - radius); phi <= Math.min(0.95, center.phi + radius) + 1e-9; phi += step) {
            for (let theta = Math.max(-0.95, center.theta - radius); theta <= Math.min(0.95, center.theta + radius) + 1e-9; theta += step) {
                const score = sse(phi, theta);
                if (score < best.score - 1e-9) best = { phi, theta, score };
            }
        }
    };
    search({ phi: 0, theta: 0 }, 0.95, 0.05);
    search(best, 0.05, 0.005);
    return best;
}

function arimaForecast(values, horizon) {
    const differences = values.slice(1).map((value, index) => value - values[index]);
    const estimated = differences.length >= ARIMA_MIN_DIFFERENCES;
    const { phi, theta } = estimated ? arimaFit(differences) : { phi: 0, theta: 0 };
    const residuals = arimaResiduals(differences, phi, theta);
    let step = phi * differences.at(-1) + theta * residuals.at(-1);
    let level = values.at(-1);
    const forecasts = [];
    for (let index = 0; index < horizon; index += 1) {
        level = Math.max(0, level + step);
        forecasts.push(level);
        step = phi * step;
    }
    forecasts.label = estimated
        ? 'ARIMA(1,1,1)'
        : 'ARIMA(0,1,0) random walk (too few months to estimate the AR and MA terms)';
    forecasts.parameters = { phi, theta, estimated };
    return forecasts;
}

function prophetForecast(values, horizon) {
    const featuresAt = time => [1, time / Math.max(values.length, 1), ...[1, 2].flatMap(harmonic => [Math.sin(2 * Math.PI * harmonic * time / 12), Math.cos(2 * Math.PI * harmonic * time / 12)])];
    const features = values.map((_, time) => featuresAt(time));
    const coefficients = regress(features, values, 0.01);
    return Array.from({ length: horizon }, (_, index) => Math.max(0, featuresAt(values.length + index).reduce((sum, feature, i) => sum + feature * coefficients[i], 0)));
}

function randomForestForecast(values, horizon) {
    const first = Math.min(3, values.length - 1);
    const featureAt = time => [time / values.length, ...[1, 2, 3, 6, 12].map(lag => values[Math.max(0, time - lag)]), Math.sin(2 * Math.PI * time / 12), Math.cos(2 * Math.PI * time / 12)];
    const samples = Array.from({ length: values.length - first }, (_, offset) => ({ x: featureAt(first + offset), y: values[first + offset] }));
    const trees = Array.from({ length: 17 }, (_, treeIndex) => {
        // Deterministic bootstrap keeps the model reproducible across requests.
        const nodes = samples.map((_, index) => {
            const bootIndex = Math.floor(Math.abs(Math.sin((treeIndex + 1) * 92821 + (index + 1) * 68917) * 1e9)) % samples.length;
            return samples[bootIndex];
        });
        const build = (items, depth, salt) => {
            const prediction = mean(items.map(item => item.y));
            if (depth >= 4 || items.length < 4) return { prediction };
            let best = null;
            const itemMean = mean(items.map(item => item.y));
            const featureCount = items[0].x.length;
            for (let offset = 0; offset < Math.min(4, featureCount); offset += 1) {
                const feature = (salt + offset * 3) % featureCount;
                const ordered = [...new Set(items.map(item => item.x[feature]))].sort((a, b) => a - b);
                for (let cut = 1; cut < ordered.length; cut += 1) {
                    const threshold = (ordered[cut - 1] + ordered[cut]) / 2;
                    const left = items.filter(item => item.x[feature] <= threshold);
                    const right = items.filter(item => item.x[feature] > threshold);
                    if (left.length < 2 || right.length < 2) continue;
                    const leftMean = mean(left.map(row => row.y));
                    const rightMean = mean(right.map(row => row.y));
                    const score = left.reduce((sum, item) => sum + (item.y - leftMean) ** 2, 0) + right.reduce((sum, item) => sum + (item.y - rightMean) ** 2, 0);
                    if (!best || score < best.score) best = { feature, threshold, left, right, score };
                }
            }
            return best ? { feature: best.feature, threshold: best.threshold, left: build(best.left, depth + 1, salt + 1), right: build(best.right, depth + 1, salt + 3) } : { prediction: itemMean };
        };
        return build(nodes, 0, treeIndex);
    });
    const predictTree = (tree, features) => {
        let node = tree;
        while (node.feature !== undefined) node = features[node.feature] <= node.threshold ? node.left : node.right;
        return node.prediction;
    };
    const forecast = [];
    for (let step = 0; step < horizon; step += 1) {
        const time = values.length + step;
        const features = [time / values.length, ...[1, 2, 3, 6, 12].map(lag => {
            const index = time - lag;
            return index < values.length ? values[Math.max(0, index)] : forecast[index - values.length];
        }), Math.sin(2 * Math.PI * time / 12), Math.cos(2 * Math.PI * time / 12)];
        forecast.push(Math.max(0, mean(trees.map(tree => predictTree(tree, features)))));
    }
    return forecast;
}

function crostonForecast(values, horizon, method) {
    const alpha = 0.1;
    const beta = 0.1;
    const firstDemand = values.findIndex(value => value > 0);
    if (firstDemand < 0) return Array.from({ length: horizon }, () => 0);
    let size = values[firstDemand];
    let interval = firstDemand + 1;
    let probability = 1 / interval;
    let gap = 1;
    for (let index = firstDemand + 1; index < values.length; index += 1) {
        const demand = values[index];
        if (method === 'tsb') {
            probability += beta * ((demand > 0 ? 1 : 0) - probability);
            if (demand > 0) size += alpha * (demand - size);
        } else if (demand > 0) {
            size += alpha * (demand - size);
            interval += alpha * (gap - interval);
            gap = 1;
        } else gap += 1;
    }
    const rate = method === 'tsb'
        ? probability * size
        : (1 - alpha / 2) * size / Math.max(interval, 1);
    const forecast = Array.from({ length: horizon }, () => Math.max(0, rate));
    forecast.label = method === 'tsb' ? MODEL_NAMES.tsb : MODEL_NAMES.croston_sba;
    forecast.parameters = method === 'tsb' ? { alpha, beta, probability, size } : { alpha, size, interval };
    return forecast;
}

// Exposed as a pure function so numerical regression tests can independently
// verify the unchanged mathematical cores without constructing database rows.
export function runModel(values, horizon, model) {
    if (model === 'arima') return arimaForecast(values, horizon);
    if (model === 'prophet') return prophetForecast(values, horizon);
    if (model === 'croston_sba' || model === 'tsb') return crostonForecast(values, horizon, model);
    return randomForestForecast(values, horizon);
}

function monthIsLastDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(8, 10) === '01';
}

function customRangeIsComplete(filters) {
    return filters.period !== 'Custom Range' || (filters.start?.slice(-2) === '01' && monthIsLastDay(filters.end));
}

// Part-months are removed, and the series is extended to the anchor month
// (the dataset's last complete month, or the custom range end if earlier).
// Months after a series' last sale therefore count as missing, so an inactive or
// discontinued series cannot produce a forecast that starts in the past.
function verifiedNoSalesMonths(bounds) {
    const trustedAdjustments = (bounds.adjustments || []).filter(adjustment =>
        adjustment.kind === 'no_sales'
        && adjustment.exclude_from_training === false
        && !bounds.warnings.some(warning => warning.type === 'sales_inside' && warning.id === adjustment.id)
    );
    const months = new Set();
    const isFullMonthCovered = month => {
        const start = `${month}-01`;
        const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const intervals = trustedAdjustments
            .filter(item => item.start <= end && item.end >= start)
            .map(item => [item.start < start ? start : item.start, item.end > end ? end : item.end])
            .sort((a, b) => a[0].localeCompare(b[0]));
        let coveredThrough = '';
        for (const [from, to] of intervals) {
            if (!coveredThrough && from > start) return false;
            const nextDay = coveredThrough ? new Date(`${coveredThrough}T00:00:00Z`) : null;
            if (nextDay) nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            if (nextDay && from > nextDay.toISOString().slice(0, 10)) return false;
            if (!coveredThrough || to > coveredThrough) coveredThrough = to;
            if (coveredThrough >= end) return true;
        }
        return false;
    };
    for (const adjustment of trustedAdjustments) {
        for (let month = adjustment.start.slice(0, 7); month <= adjustment.end.slice(0, 7); month = nextMonth(month, 1)) {
            if (isFullMonthCovered(month)) months.add(month);
        }
    }
    return months;
}

function toSeries(analysis, target, anchorEnd = null, adjustedMonths = new Set(), missingMonthMode = 'strict', confirmedZeroMonths = new Set()) {
    const points = analysis.trend
        .filter(month => !month.partial)
        .map(month => {
            const adjusted = adjustedMonths.has(month.name);
            // Adjusted months are withheld from model fitting without being marked as missing.
            const hasObservedSales = month.rows > 0;
            const confirmedZero = !hasObservedSales && !adjusted && missingMonthMode !== 'strict' && confirmedZeroMonths.has(month.name);
            return { month: month.name, value: adjusted ? null : hasObservedSales ? month[target] : confirmedZero ? 0 : null, rows: month.rows, adjusted, ...(confirmedZero ? { confirmedZero: true } : {}) };
        });
    if (anchorEnd && points.length) {
        for (let month = nextMonth(points.at(-1).month, 1); month <= anchorEnd; month = nextMonth(month, 1)) {
            const adjusted = adjustedMonths.has(month);
            const confirmedZero = !adjusted && missingMonthMode !== 'strict' && confirmedZeroMonths.has(month);
            points.push({ month, value: confirmedZero ? 0 : null, rows: 0, adjusted, ...(confirmedZero ? { confirmedZero: true } : {}) });
        }
    }
    return points;
}

// Builds the series the models are fitted on. Adjusted months are not representative demand:
// leading and trailing ones are cut off (a trailing run is skipped again when
// projecting forward), and interior ones are filled by straight-line interpolation
// so the monthly spacing the models rely on is preserved. Filled months are flagged
// and are never scored in the backtest.
function modelSeries(history) {
    const first = history.findIndex(point => !point.adjusted);
    let last = -1;
    history.forEach((point, index) => { if (!point.adjusted) last = index; });
    if (first === -1) return { points: [], tailSkip: history.length };
    const points = [];
    for (let index = first; index <= last; index += 1) {
        const point = history[index];
        if (!point.adjusted) {
            if (point.value !== null) points.push({ month: point.month, value: point.value, imputed: false });
            continue;
        }
        let before = index - 1;
        while (history[before].adjusted) before -= 1;
        let after = index + 1;
        while (history[after].adjusted) after += 1;
        const a = history[before].value;
        const b = history[after].value;
        if (a === null || b === null) continue;
        points.push({ month: point.month, value: a + (b - a) * (index - before) / (after - before), imputed: true });
    }
    return { points, tailSkip: history.length - 1 - last };
}

// Eligibility is model-specific: a 12-month seasonal regression needs at least
// two annual cycles, while the lag-based forest needs a longer history than a
// simple ARIMA random-walk fallback. These are evidence requirements, not new models.
export const MODEL_MINIMUM_OBSERVATIONS = Object.freeze({
    arima: 3, prophet: 24, random_forest: 18, croston_sba: 12, tsb: 12
});

const modelEligible = (history, model) => {
    const points = modelSeries(history).points;
    const observed = points.filter(point => !point.imputed).length;
    return observed >= MODEL_MINIMUM_OBSERVATIONS[model];
};

// One chronological origin. Crucially, the training interpolation is rebuilt
// using ONLY history prior to origin, never the complete series containing the
// final holdout. Adjusted holdout months are not included in accuracy metrics.
function backtestAtOrigin(history, origin, horizon, model) {
    const trainingHistory = history.slice(0, origin);
    if (!modelEligible(trainingHistory, model)) return null;
    const { points: trainingPoints, tailSkip } = modelSeries(trainingHistory);
    const trainingValues = trainingPoints.map(point => point.value);
    const predicted = runModel(trainingValues, horizon + tailSkip, model).slice(tailSkip);
    const scorePoints = history.slice(origin, origin + horizon).flatMap((point, index) =>
        point.adjusted || point.value === null ? [] : [{ month: point.month, actual: point.value, predicted: predicted[index], baseline: trainingValues.at(-1) }]
    );
    if (!scorePoints.length) return null;
    return { points: scorePoints, trainingMonths: trainingValues.length };
}

function metricsForBacktest(backtest) {
    if (!backtest?.points.length) return null;
    const points = backtest.points;
    const errors = points.map(point => point.actual - point.predicted);
    const baselineErrors = points.map(point => point.actual - point.baseline);
    const mae = mean(errors.map(Math.abs));
    const baselineMae = mean(baselineErrors.map(Math.abs));
    const percentages = points.flatMap((point, index) => point.actual === 0 ? [] : [Math.abs(errors[index] / point.actual) * 100]);
    const baselinePercentages = points.flatMap((point, index) => point.actual === 0 ? [] : [Math.abs(baselineErrors[index] / point.actual) * 100]);
    return {
        mae, rmse: Math.sqrt(mean(errors.map(error => error ** 2))),
        mape: meanOf(percentages), mapeExcludedMonths: points.length - percentages.length,
        baselineMae, baselineRmse: Math.sqrt(mean(baselineErrors.map(error => error ** 2))),
        baselineMape: meanOf(baselinePercentages), beatsBaseline: mae < baselineMae,
        improvementVsBaseline: baselineMae > 0 ? (1 - mae / baselineMae) * 100 : null,
        scoredMonths: points.length,
        points: points.map(({ month, actual, predicted }) => ({ month, actual, predicted }))
    };
}

// Candidate selection uses rolling one-step origins BEFORE the independent
// final holdout. Each origin rebuilds the model only from what was known then.
function rollingSelection(history, model, start, end, forecastHorizon = 3) {
    // Every candidate must be eligible at the SAME first selection origin;
    // otherwise a complex model could win using fewer/easier validation months.
    if (!modelEligible(history.slice(0, start), model)) return null;
    const points = [];
    const foldMonths = Math.min(Math.max(1, forecastHorizon), end - start);
    // Evaluate non-overlapping out-of-sample blocks; match the requested
    // forecasting horizon where the selection window is long enough.
    for (let origin = start; origin < end; origin += foldMonths) {
        const backtest = backtestAtOrigin(history, origin, Math.min(foldMonths, end - origin), model);
        if (backtest) points.push(...backtest.points);
    }
    const metrics = metricsForBacktest({ points });
    return metrics ? { model, mae: metrics.mae, rmse: metrics.rmse, scoredMonths: metrics.scoredMonths } : null;
}

const holdoutLength = observed => observed < 6 ? 0 : observed >= 36 ? 12 : Math.min(6, observed - 3);

function forecastAnchor(rows, filters) {
    const lastComplete = datasetBounds(rows).lastCompleteMonth;
    if (!lastComplete) return null;
    return filters.period === 'Custom Range' && /^\d{4}-\d{2}/.test(filters.end || '') && filters.end.slice(0, 7) < lastComplete
        ? filters.end.slice(0, 7)
        : lastComplete;
}

function evaluateSeries(series, horizon, target, filters = {}, orderCount = 0, model = 'arima', missingMonthMode = 'strict', dataGapMonths = new Set()) {
    const history = series.map(point => ({ ...point }));
    const { points: modelPoints, tailSkip } = modelSeries(history);
    const values = modelPoints.map(point => point.value);
    const observedCount = modelPoints.filter(point => !point.imputed).length;
    const active = history.filter(point => point.value !== null);
    // Adjusted months are explicitly known, so they are not "missing".
    const missing = history.filter(point => point.value === null && !point.adjusted).map(point => point.month);
    const result = {
        status: 'insufficient',
        reason: '',
        history,
        forecast: [],
        validation: null,
        model: null,
        currentDemand: meanOf(values.slice(-12)),
        forecastDemand: null,
        growth: null,
        endDemand: null,
        trend: null,
        coverage: {
            calendarMonths: history.length,
            activeMonths: active.length,
            observedMonths: observedCount,
            missingMonths: missing,
            adjustedMonths: history.filter(point => point.adjusted).map(point => point.month),
            imputedMonths: modelPoints.filter(point => point.imputed).map(point => point.month),
            start: history[0]?.month ?? null,
            end: history.at(-1)?.month ?? null,
            orders: orderCount,
            ...(missingMonthMode !== 'strict' ? {
                confirmedZeroMonths: history.filter(point => point.confirmedZero).map(point => point.month),
                nonzeroDemandMonths: modelPoints.filter(point => !point.imputed && point.value > 0).length,
                verifiedZeroShare: observedCount ? modelPoints.filter(point => !point.imputed && point.value === 0).length / observedCount : null
            } : {})
        }
    };

    const affectedDataGaps = [...dataGapMonths].filter(month => history.some(point => point.month === month));
    if (missingMonthMode !== 'strict' && affectedDataGaps.length) result.reason = `An explicit data-gap adjustment affects ${affectedDataGaps.sort().join(', ')}; demand is unknown, so this series is unavailable.`;
    else if (!history.length) result.reason = 'No matching transaction history is available in this scope.';
    else if (!customRangeIsComplete(filters)) result.reason = 'Choose complete calendar months for the selected custom date range.';
    else if (missing.length) {
        const trimmed = history.slice(0, history.length - tailSkip);
        let trailing = 0;
        while (trailing < trimmed.length && trimmed[trimmed.length - 1 - trailing].value === null && !trimmed[trimmed.length - 1 - trailing].adjusted) trailing += 1;
        result.reason = trailing > 0
            ? `No sales records in the latest ${trailing} month${trailing === 1 ? '' : 's'} (through ${history.at(-1).month}); this series looks inactive or discontinued. Missing months are unknown demand, not zero demand.`
            : `History has ${missing.length} month${missing.length === 1 ? '' : 's'} with no records. Missing months are unknown demand, not zero demand.`;
    }
    else if (values.some(value => value < 0)) result.reason = 'Negative monthly demand totals cannot be forecast. Review return treatment or choose another metric.';
    else if (observedCount < MINIMUM_HISTORY) result.reason = `At least ${MINIMUM_HISTORY} consecutive observed months are required for an exploratory forecast; this scope has ${observedCount}.`;
    if (result.reason) {
        if (missingMonthMode !== 'strict') result.forecastStatus = affectedDataGaps.length ? 'Unavailable — Unknown Data Gaps' : 'Unavailable — Insufficient Data';
        return result;
    }

    // Check the requested model against the actual (not interpolated) history.
    if (!modelEligible(history, model)) {
        result.reason = `${MODEL_NAMES[model]} requires at least ${MODEL_MINIMUM_OBSERVATIONS[model]} observed months; this series has ${observedCount}.`;
        result.forecastStatus = 'Unavailable — Insufficient Data';
        return result;
    }

    if (missingMonthMode === 'intermittent') {
        const verifiedPoints = modelPoints.filter(point => !point.imputed);
        const nonzero = verifiedPoints.filter(point => point.value > 0).length;
        const latestDemand = [...verifiedPoints].reverse().find(point => point.value > 0);
        const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
        const monthsSinceDemand = latestDemand ? Math.max(0, monthIndex(history.at(-1).month) - monthIndex(latestDemand.month)) : history.length;
        if (observedCount < 12 || nonzero < 3) {
            result.reason = `Intermittent forecasting requires at least 12 verified months and 3 nonzero-demand months; this series has ${observedCount} verified months and ${nonzero} nonzero months.`;
            result.forecastStatus = 'Unavailable — Insufficient Data';
            return result;
        }
        if (monthsSinceDemand >= 6) {
            const recentPeriods = history.slice(-6);
            if (recentPeriods.length === 6 && recentPeriods.every(point => point.adjusted)) {
                result.reason = 'Recent periods are excluded from training, so current product activity cannot be verified for an active-demand forecast.';
                result.forecastStatus = 'Unavailable — Insufficient Data';
                return result;
            }
            result.reason = `No verified sales activity in the latest ${monthsSinceDemand} months; the product is treated as inactive for forecast eligibility.`;
            result.forecastStatus = 'Unavailable — Inactive Product';
            return result;
        }
        const zeroShare = verifiedPoints.filter(point => point.value === 0).length / Math.max(1, observedCount);
        const isIntermittent = zeroShare >= 0.2;
        const candidates = isIntermittent ? [...new Set([model, 'croston_sba', 'tsb'])] : [model];
        // Reserve the final six months completely. The earlier six months are
        // used for model selection ONLY. Short series get exploratory estimates
        // but cannot claim to possess an independent evaluation window.
        const finalLength = observedCount >= 24 ? 6 : 0;
        const finalOrigin = history.length - tailSkip - finalLength;
        const selectionStart = Math.max(0, finalOrigin - 6);
        const scored = candidates.map(candidate => rollingSelection(history, candidate, selectionStart, finalOrigin, horizon))
            .filter(Boolean).sort((left, right) => left.mae - right.mae || left.model.localeCompare(right.model));
        const chosen = scored[0]?.model || (isIntermittent ? 'croston_sba' : model);
        const finalBacktest = finalLength ? backtestAtOrigin(history, finalOrigin, finalLength, chosen) : null;
        const finalMetrics = metricsForBacktest(finalBacktest);
        const validated = Boolean(finalMetrics && finalMetrics.scoredMonths >= 4 && finalMetrics.beatsBaseline);
        const fullForecast = runModel(values, horizon, chosen);
        const rmse = finalMetrics?.rmse ?? null;
        const fallbackRange = Math.max(Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2))), Math.abs(mean(values)) * 0.25, 1);
        const rangeMethod = rmse == null ? 'historical_variability' : 'backtest_rmse';
        if (finalMetrics) result.validation = {
            months: finalLength, trainingMonths: finalBacktest.trainingMonths,
            start: history[finalOrigin].month, end: history[finalOrigin + finalLength - 1].month,
            ...finalMetrics, independent: true,
            metric: 'MAE / RMSE (zero-safe)', baseline: 'Last training month demand',
            validationWindow: 'Untouched final chronological holdout',
            selectionWindow: { months: finalOrigin - selectionStart, start: history[selectionStart].month, end: history[finalOrigin - 1].month },
            candidateScores: scored
        };
        result.model = fullForecast.label || MODEL_NAMES[chosen];
        result.forecast = fullForecast.map((value, index) => {
            const range = (rmse ?? fallbackRange) * Math.sqrt(index + 1);
            return { month: nextMonth(result.coverage.end, index + 1), value: Math.max(0, value), lower: Math.max(0, value - range), upper: value + range, rangeMethod, intervalCalibrated: false };
        });
        result.forecastDemand = mean(result.forecast.map(point => point.value));
        result.endDemand = result.forecast.at(-1).value;
        result.growth = result.currentDemand === 0 ? null : (result.forecastDemand - result.currentDemand) / result.currentDemand * 100;
        result.trend = result.growth === null ? 'Unavailable' : result.growth > 2 ? 'Increasing' : result.growth < -2 ? 'Decreasing' : 'Stable';
        result.growthWithinError = rmse !== null && Math.abs(result.forecastDemand - result.currentDemand) < rmse;
        result.status = 'available';
        result.reason = validated ? '' : 'Insufficient independent evidence or performance below the naive benchmark; treat this forecast as exploratory.';
        result.reliability = validated ? 'backtested' : 'exploratory';
        result.forecastStatus = validated ? 'Available — Validated' : 'Available — Exploratory';
        result.modelSelection = {
            selected: chosen, detectedIntermittentDemand: isIntermittent, zeroShare,
            criteria: 'Rolling forecast-origin model selection on earlier months, strictly before the final six-month holdout; validation is independent when at least 24 observed months exist',
            candidates: scored, independentlyValidated: finalMetrics !== null
        };
        return result;
    }

    const holdoutMonths = holdoutLength(observedCount);
    const finalOrigin = history.length - tailSkip - holdoutMonths;
    const backtest = holdoutMonths ? backtestAtOrigin(history, finalOrigin, holdoutMonths, model) : null;
    const metrics = metricsForBacktest(backtest);
    const rmse = metrics?.rmse ?? null;
    if (metrics) {
        result.validation = {
            months: holdoutMonths, trainingMonths: backtest.trainingMonths,
            start: history[finalOrigin].month, end: history[finalOrigin + holdoutMonths - 1].month,
            ...metrics, independent: true,
            validationWindow: 'Chronological holdout of a preselected model',
            baseline: 'Repeat the last training month'
        };
    }

    // Project from the last normal month, then skip known adjusted months.
    const rawForecast = runModel(values, horizon + tailSkip, model);
    const valuesForecast = rawForecast.slice(tailSkip);
    valuesForecast.label = rawForecast.label;
    const modelLabel = valuesForecast.label || MODEL_NAMES[model];
    const average = meanOf(values);
    const historicalSpread = Math.sqrt(meanOf(values.map(value => (value - average) ** 2)));
    const fallbackRange = Math.max(historicalSpread, Math.abs(average) * 0.25, 1);
    const rangeMethod = rmse === null ? 'historical_variability' : 'backtest_rmse';
    const next = valuesForecast.map((value, index) => {
        const month = nextMonth(result.coverage.end, index + 1);
        const range = (rmse ?? fallbackRange) * Math.sqrt(index + 1 + tailSkip);
        return {
            month,
            value,
            lower: Math.max(0, value - range),
            upper: value + range,
            rangeMethod,
            intervalCalibrated: false
        };
    });
    const forecastDemand = meanOf(valuesForecast);
    const growth = result.currentDemand === 0 ? null : (forecastDemand - result.currentDemand) / result.currentDemand * 100;

    result.status = 'available';
    result.reason = '';
    result.model = modelLabel;
    result.forecast = next;
    result.forecastDemand = forecastDemand;
    result.endDemand = valuesForecast.at(-1);
    result.growth = growth;
    result.trend = growth === null ? 'Unavailable' : growth > 2 ? 'Increasing' : growth < -2 ? 'Decreasing' : 'Stable';
    result.growthWithinError = rmse !== null && result.currentDemand !== null && Math.abs(forecastDemand - result.currentDemand) < rmse;
    const validated = observedCount >= 24 && metrics?.scoredMonths >= 4 && metrics.beatsBaseline;
    result.reliability = observedCount < 6 ? 'very_low' : observedCount < 18 ? 'low' : validated ? 'backtested' : metrics ? 'backtested_weak' : 'exploratory';
    result.forecastStatus = validated ? 'Available — Validated' : 'Available — Exploratory';
    if (missingMonthMode === 'confirmed_zero' && !validated) {
        result.reason = 'An independent holdout did not provide sufficient evidence of improvement over the baseline; treat this as exploratory.';
    }
    return result;
}

function scopedAnalysis(rows, filters, { category = '', province = null } = {}) {
    const nextFilters = { ...filters };
    if (category) nextFilters.categories = [category];
    if (province) {
        nextFilters.region = province.region;
        nextFilters.province = province.name;
    }
    return analyzeRows(rows, nextFilters, { summaryOnly: true });
}

function summarize(analysis, target, horizon, filters, { includeSeries = false, includeValidationPoints = false, anchorEnd = null, adjustedMonths = new Set(), missingMonthMode = 'strict', confirmedZeroMonths = new Set(), dataGapMonths = new Set() } = {}, model = 'arima') {
    const result = evaluateSeries(toSeries(analysis, target, anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths), horizon, target, filters, analysis.summary.orders, model, missingMonthMode, dataGapMonths);
    const validation = result.validation && !includeValidationPoints
        ? Object.fromEntries(Object.entries(result.validation).filter(([key]) => key !== 'points'))
        : result.validation;
    return {
        status: result.status,
        reason: result.reason,
        model: result.model,
        currentDemand: result.currentDemand,
        forecastDemand: result.forecastDemand,
        endDemand: result.endDemand,
        growth: result.growth,
        growthWithinError: result.growthWithinError ?? null,
        trend: result.trend,
        coverage: result.coverage,
        reliability: result.reliability,
        ...(result.forecastStatus ? { forecastStatus: result.forecastStatus } : {}),
        ...(result.modelSelection ? { modelSelection: result.modelSelection } : {}),
        validation,
        ...(includeSeries ? { history: result.history, forecast: result.forecast } : {})
    };
}

function effectiveForecastFilters(rows, filters) {
    if (filters.period !== 'Last 12 Months' && filters.period !== 'Last 24 Months') return { ...filters };
    // "Last N months" for forecasting means the N most recent COMPLETE months.
    const latestMonth = datasetBounds(rows).lastCompleteMonth;
    if (!latestMonth) return { ...filters };
    const start = nextMonth(latestMonth, -(filters.period === 'Last 12 Months' ? 11 : 23));
    const end = new Date(Date.UTC(Number(latestMonth.slice(0, 4)), Number(latestMonth.slice(5, 7)), 0));
    return {
        ...filters,
        period: 'Custom Range',
        start: `${start}-01`,
        end: end.toISOString().slice(0, 10)
    };
}

function buildPairForecasts(rows, filters, horizon, target, model, missingMonthMode = 'strict', base = analyzeRows(rows, filters)) {
    const pairForecasts = [];
    const bounds = datasetBounds(rows);
    const anchorEnd = forecastAnchor(rows, filters);
    const adjustedMonths = bounds.adjustedMonths;
    const confirmedZeroMonths = verifiedNoSalesMonths(bounds);
    const dataGapMonths = new Set(bounds.adjustments.filter(item => item.kind === 'data_gap').flatMap(item => {
        const months = [];
        for (let month = item.start.slice(0, 7); month <= item.end.slice(0, 7); month = nextMonth(month, 1)) months.push(month);
        return months;
    }));
    for (const region of base.regions) {
        for (const province of region.provinces) {
            for (const item of province.categories) {
                const analysis = scopedAnalysis(rows, filters, {
                    category: item.name,
                    province: { name: province.name, region: region.name }
                });
                pairForecasts.push({
                    key: JSON.stringify([region.name, province.name, item.name]),
                    province: province.name,
                    region: region.name,
                    category: item.name,
                    ...summarize(analysis, target, horizon, filters, { anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths, dataGapMonths }, model)
                });
            }
        }
    }
    return { base, pairForecasts };
}

export function predictiveAnalytics(rows, filters = {}, horizon = 6, target = 'revenue', category = '', provinceKey = '', model = 'arima', missingMonthMode = 'strict', chartOnly = false) {
    if (!FORECAST_HORIZONS.includes(horizon)) throw new Error('Choose a 3, 6, 9, or 12 month horizon.');
    if (!['revenue', 'orders', 'quantity'].includes(target)) throw new Error('Choose revenue, orders, or quantity as the forecast metric.');
    if (!MISSING_MONTH_MODES.includes(missingMonthMode)) throw new Error('Choose a supported missing-month handling mode.');
    const supportedModels = missingMonthMode === 'intermittent' ? MODEL_NAMES : { arima: MODEL_NAMES.arima, prophet: MODEL_NAMES.prophet, random_forest: MODEL_NAMES.random_forest };
    if (model !== 'auto' && !Object.hasOwn(supportedModels, model)) throw new Error('Choose a supported forecasting model.');
    if (typeof category !== 'string' || typeof provinceKey !== 'string') throw new Error('Invalid predictive selection.');

    const effectiveFilters = effectiveForecastFilters(rows, filters);
    const anchorEnd = forecastAnchor(rows, effectiveFilters);
    const bounds = datasetBounds(rows);
    const adjustedMonths = bounds.adjustedMonths;
    const confirmedZeroMonths = verifiedNoSalesMonths(bounds);
    const dataGapMonths = new Set(bounds.adjustments.filter(item => item.kind === 'data_gap').flatMap(item => {
        const months = [];
        for (let month = item.start.slice(0, 7); month <= item.end.slice(0, 7); month = nextMonth(month, 1)) months.push(month);
        return months;
    }));
    const base = analyzeRows(rows, effectiveFilters);
    const categories = base.categories.map(item => item.name);
    const provinces = base.regions.flatMap(region => region.provinces.map(province => ({
        key: pairKey(region.name, province.name),
        name: province.name,
        region: region.name
    })));
    const provinceMap = new Map(provinces.map(province => [province.key, province]));
    let selectedProvince = provinceKey ? provinceMap.get(provinceKey) : null;
    if (provinceKey && !selectedProvince) {
        try {
            const [requestedRegion, requestedName] = JSON.parse(provinceKey);
            const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
            const provinceMatches = provinces.filter(item => normalize(item.name) === normalize(requestedName));
            selectedProvince = provinceMatches.find(item => normalize(item.region) === normalize(requestedRegion))
                || (provinceMatches.length === 1 ? provinceMatches[0] : null);
        } catch {
            // The validation below handles malformed or out-of-scope keys.
        }
    }
    if (category && !categories.includes(category)) throw new Error('The selected category is outside the current analysis scope.');
    if (provinceKey && !selectedProvince) throw new Error('The selected province is outside the current analysis scope.');

    if (model === 'auto') {
        const selectionAnalysis = scopedAnalysis(rows, effectiveFilters, { category, province: selectedProvince });
        const history = toSeries(selectionAnalysis, target, anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths);
        const observed = history.filter(point => point.value !== null && !point.adjusted).length;
        const finalMonths = holdoutLength(observed);
        const finalOrigin = history.length - modelSeries(history).tailSkip - finalMonths;
        const selectionMonths = Math.min(6, Math.max(0, Math.floor((finalOrigin - 6) / 2)));
        const selectionStart = finalOrigin - selectionMonths;
        // Nothing from [finalOrigin, end) is inspected during model selection.
        const comparison = ['arima', 'prophet', 'random_forest'].map(candidate => {
            const score = selectionMonths ? rollingSelection(history, candidate, selectionStart, finalOrigin, horizon) : null;
            return { model: candidate, name: MODEL_NAMES[candidate], rmse: score?.rmse ?? null,
                mae: score?.mae ?? null, scoredMonths: score?.scoredMonths ?? 0,
                eligible: Boolean(score) };
        });
        const comparable = comparison.filter(item => Number.isFinite(item.rmse))
            .sort((left, right) => left.rmse - right.rmse || left.model.localeCompare(right.model));
        const assignedModel = comparable[0]?.model || 'arima';
        const modelAssignment = {
            requested: 'auto', assignedModel, assignedModelName: MODEL_NAMES[assignedModel],
            metric: 'RMSE', error: comparable[0]?.rmse ?? null, comparedModels: comparison,
            fallback: comparable.length === 0,
            selectionWindow: selectionMonths ? {
                months: selectionMonths, start: history[selectionStart].month,
                end: history[finalOrigin - 1].month, evaluation: 'Chronological non-overlapping forecast-origin folds'
            } : null,
            finalHoldout: finalMonths ? {
                months: finalMonths, start: history[finalOrigin].month,
                end: history[finalOrigin + finalMonths - 1].month, independentOfSelection: true
            } : null
        };
        const result = predictiveAnalytics(rows, filters, horizon, target, category, provinceKey, assignedModel, missingMonthMode, chartOnly);
        return { ...result, modelAssignment };
    }

    if (chartOnly) {
        const chartAnalysis = scopedAnalysis(rows, effectiveFilters, { category, province: selectedProvince });
        return {
            target,
            horizon,
            model: MODEL_NAMES[model],
            missingMonthMode,
            unit: { revenue: 'PHP', orders: 'orders', quantity: 'units' }[target],
            dataCompleteness: completenessNote(datasetBounds(rows)),
            chart: summarize(chartAnalysis, target, horizon, effectiveFilters, {
                includeSeries: true,
                includeValidationPoints: true,
                anchorEnd,
                adjustedMonths,
                missingMonthMode,
                confirmedZeroMonths,
                dataGapMonths
            }, model)
        };
    }

    const { pairForecasts } = buildPairForecasts(rows, effectiveFilters, horizon, target, model, missingMonthMode, base);

    const pairFilter = pairForecasts.filter(item => (!category || item.category === category)
        && (!selectedProvince || (item.province === selectedProvince.name && item.region === selectedProvince.region)));
    const compareDemand = (left, right) => (right.forecastDemand ?? -Infinity) - (left.forecastDemand ?? -Infinity);
    const overview = pairFilter.filter(item => item.status === 'available').sort(compareDemand);
    const insufficient = pairFilter.filter(item => item.status !== 'available');
    const availablePairCount = pairForecasts.filter(item => item.status === 'available').length;

    const categoryRows = categories.map(name => {
        const analysis = scopedAnalysis(rows, effectiveFilters, { category: name, province: selectedProvince });
        return { category: name, ...summarize(analysis, target, horizon, effectiveFilters, { anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths, dataGapMonths }, model) };
    }).sort(compareDemand);

    const provinceRows = provinces.map(province => {
        const analysis = scopedAnalysis(rows, effectiveFilters, {
            category,
            province: { name: province.name, region: province.region }
        });
        return { ...province, ...summarize(analysis, target, horizon, effectiveFilters, { anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths, dataGapMonths }, model) };
    }).sort(compareDemand);

    const chartAnalysis = scopedAnalysis(rows, effectiveFilters, { category, province: selectedProvince });
    const chart = summarize(chartAnalysis, target, horizon, effectiveFilters, { includeSeries: true, includeValidationPoints: true, anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths, dataGapMonths }, model);
    const detail = selectedProvince && category
        ? {
            province: selectedProvince.name,
            region: selectedProvince.region,
            category,
            ...summarize(scopedAnalysis(rows, effectiveFilters, { category, province: selectedProvince }), target, horizon, effectiveFilters, { anchorEnd, adjustedMonths, missingMonthMode, confirmedZeroMonths, dataGapMonths }, model)
        }
        : null;
    const signals = pairForecasts.filter(item => item.status === 'available'
        && item.growth !== null
        && (missingMonthMode === 'strict' || item.forecastStatus === 'Available — Validated'))
        .sort((left, right) => (right.growth ?? -Infinity) - (left.growth ?? -Infinity))
        .slice(0, 5);

    return {
        target,
        horizon,
        model: MODEL_NAMES[model],
        missingMonthMode,
        unit: { revenue: 'PHP', orders: 'orders', quantity: 'units' }[target],
        filters,
        dataCompleteness: completenessNote(datasetBounds(rows)),
        notes: target === 'orders' ? [ORDER_COUNT_NOTE] : [],
        effectiveRange: { start: chart.coverage.start, end: chart.coverage.end },
        options: {
            categories,
            provinces,
            forecastablePairs: availablePairCount,
            totalPairs: pairForecasts.length
        },
        chart,
        overview,
        insufficient,
        categoryRows,
        provinceRows,
        detail,
        signals
    };
}

const PRESCRIPTIVE_MIN_ORDERS = 20;
const PRESCRIPTIVE_MIN_ACTIVE_MONTHS = 6;
const clampScore = value => Math.max(0, Math.min(100, value));
// Relative, uncalibrated scoring heuristics. Weights and cut-offs are exposed in
// the API response so the page can state exactly what the score is made of.
export const PRESCRIPTIVE_WEIGHTS = Object.freeze({ demandStrength: 0.35, growthMomentum: 0.30, demandConsistency: 0.20, categoryAffinity: 0.15 });
export const STRATEGY_THRESHOLDS = Object.freeze({ strongDemandPercentile: 67, moderateDemandPercentile: 34, strongGrowthPercent: 5, steadyGrowthPercent: -5 });
// Growth 0% -> 50, +25% -> 88, +50% -> 98; symmetric and never hard-clipped at +/-25%.
export const growthScore = growth => 50 + 50 * Math.tanh(growth / 25);
// Local-vs-overall sales mix: ratio 1 -> 50, 2 -> 75, 4+ -> 100, 0.5 -> 25, 0.25- -> 0.
export const mixScore = ratio => clampScore(50 + 25 * Math.log2(Math.min(4, Math.max(0.25, ratio))));
// Mid-rank percentile so tied demand values receive identical scores.
export function percentileRanks(entries) {
    const ordered = [...entries].sort((a, b) => a.value - b.value);
    const ranks = new Map();
    for (let start = 0; start < ordered.length;) {
        let end = start;
        while (end + 1 < ordered.length && ordered[end + 1].value === ordered[start].value) end += 1;
        const percentile = ordered.length <= 1 ? 50 : (start + end) / 2 / (ordered.length - 1) * 100;
        for (let index = start; index <= end; index += 1) ranks.set(ordered[index].key, percentile);
        start = end + 1;
    }
    return ranks;
}
const rounded = value => value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;

export function prescriptiveAnalytics(rows, filters = {}, horizon = 6, target = 'revenue', model = 'arima', missingMonthMode = 'strict') {
    if (filters.returns === 'Returned / Refunded Only') {
        return { pairs: [], categories: [], target, horizon, model, missingMonthMode,
            status: 'returns_scope_not_supported',
            message: 'Returns-only activity cannot be used for ordinary demand-growth recommendations. Select a net-sales return treatment in Global Analysis Scope.' };
    }
    if (!FORECAST_HORIZONS.includes(horizon)) throw new Error('Choose a 3, 6, 9, or 12 month horizon.');
    if (!['revenue', 'orders', 'quantity'].includes(target)) throw new Error('Choose revenue, orders, or quantity as the decision metric.');
    if (!Object.hasOwn(MODEL_NAMES, model)) throw new Error('Choose a supported forecasting model.');
    if (!MISSING_MONTH_MODES.includes(missingMonthMode)) throw new Error('Choose a supported missing-month handling mode.');

    const effectiveFilters = effectiveForecastFilters(rows, filters);
    const { selected: selectedWithPartial, scope } = selectAnalyticsRows(rows, effectiveFilters, { summaryOnly: true });
    const bounds = datasetBounds(rows);
    const anchorEnd = forecastAnchor(rows, effectiveFilters);
    const monthOfRow = row => String(row.year_month || row.order_creation_date || '').slice(0, 7);
    // A part-month must not count as a full month of sales.
    const selected = selectedWithPartial.filter(row => !bounds.partialMonths.has(monthOfRow(row)) && !bounds.adjustedMonths.has(monthOfRow(row)));
    const { pairForecasts: sharedPairForecasts } = buildPairForecasts(rows, effectiveFilters, horizon, target, model, missingMonthMode);
    const forecastByPair = new Map(sharedPairForecasts.map(item => [item.key, item]));
    const pairMap = new Map();
    const categoryRevenue = new Map();
    const provinceRevenue = new Map();
    const totalRevenue = selected.reduce((sum, row) => sum + Number(row.line_revenue || 0), 0);
    const monthNames = [];
    for (const row of selected) {
        const month = String(row.year_month || row.order_creation_date || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(month)) monthNames.push(month);
    }
    const orderedMonths = [...new Set(monthNames)].sort();
    if (orderedMonths.length) {
        const cursor = new Date(`${orderedMonths[0]}-01T00:00:00Z`);
        const end = anchorEnd && anchorEnd > orderedMonths.at(-1) ? anchorEnd : orderedMonths.at(-1);
        while (cursor.toISOString().slice(0, 7) <= end) {
            // Preserve missing calendar months so consistency and eligibility do not hide gaps.
            const name = cursor.toISOString().slice(0, 7);
            if (!bounds.adjustedMonths.has(name)) monthNames.push(name);
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
    }
    const months = [...new Set(monthNames)].sort();
    const ordersByPair = new Map();
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const clean = value => String(value ?? '').trim();
    const pairId = (region, province, category) => JSON.stringify([region, province, category]);
    const orderId = row => clean(row.order_id);
    const regionName = row => clean(row.region) || 'Unknown Region';
    const provinceName = row => clean(row.province) || 'Unknown Province';
    const categoryName = row => clean(row.category) || 'Other / Unclassified';

    for (const row of selected) {
        const month = String(row.year_month || row.order_creation_date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const region = regionName(row);
        const province = provinceName(row);
        const category = categoryName(row);
        const key = pairId(region, province, category);
        const revenue = number(row.line_revenue);
        const quantity = number(row.net_quantity);
        if (!pairMap.has(key)) pairMap.set(key, { key, region, province, category, byMonth: new Map(), orders: new Set(), revenue: 0, quantity: 0 });
        const pair = pairMap.get(key);
        if (!pair.byMonth.has(month)) pair.byMonth.set(month, { revenue: 0, quantity: 0, orders: new Set(), rows: 0 });
        const monthly = pair.byMonth.get(month);
        monthly.revenue += revenue;
        monthly.quantity += quantity;
        monthly.rows += 1;
        const id = orderId(row);
        if (id) { monthly.orders.add(id); pair.orders.add(id); }
        pair.revenue += revenue;
        pair.quantity += quantity;
        categoryRevenue.set(category, (categoryRevenue.get(category) || 0) + revenue);
        const provinceKey = JSON.stringify([region, province]);
        provinceRevenue.set(provinceKey, (provinceRevenue.get(provinceKey) || 0) + revenue);
    }

    const pairs = [...pairMap.values()].map(pair => {
        const history = months.map(month => {
            const monthly = pair.byMonth.get(month);
            const value = monthly ? target === 'orders' ? monthly.orders.size : monthly[target] : null;
            return { month, value, rows: monthly?.rows || 0 };
        });
        const activeMonths = history.filter(point => point.value !== null).length;
        const forecast = forecastByPair.get(pair.key);
        // Average over the latest 12 calendar months. Months with no records inside a
        // covered dataset are zero sales, so sparse pairs are not inflated by
        // averaging only their active months.
        const currentDemand = forecast?.status === 'available' ? forecast.currentDemand : meanOf(history.slice(-12).map(point => point.value ?? 0));
        let yoyChange = null;
        let yoyGrowth = null;
        let yoyMonthsCompared = null;
        let yoyMonths = null;
        const firstCoveredMonth = bounds.dateMin?.slice(0, 7);
        const lastCoveredMonth = bounds.coverageEnd?.slice(0, 7);
        const currentMonths = anchorEnd ? Array.from({ length: 12 }, (_, offset) => shiftMonth(anchorEnd, offset - 11)) : [];
        const pairable = currentMonths.filter(month => {
            const priorMonth = shiftMonth(month, -12);
            return month >= firstCoveredMonth && month <= lastCoveredMonth
                && priorMonth >= firstCoveredMonth && priorMonth <= lastCoveredMonth
                && !bounds.partialMonths.has(month) && !bounds.partialMonths.has(priorMonth)
                && !bounds.adjustedMonths.has(month) && !bounds.adjustedMonths.has(priorMonth);
        });
        const monthlyValue = month => {
            const value = pair.byMonth.get(month);
            return value ? target === 'orders' ? value.orders.size : value[target] : null;
        };
        if (pairable.length >= 6 && pairable.every(month => monthlyValue(month) !== null && monthlyValue(shiftMonth(month, -12)) !== null)) {
            const current = pairable.reduce((sum, month) => sum + monthlyValue(month), 0);
            const prior = pairable.reduce((sum, month) => sum + monthlyValue(shiftMonth(month, -12)), 0);
            if (prior > 0) {
                yoyChange = current - prior;
                yoyGrowth = yoyChange / prior * 100;
                yoyMonthsCompared = pairable.length;
                yoyMonths = pairable;
            }
        }
        const provinceKey = JSON.stringify([pair.region, pair.province]);
        const provinceShare = provinceRevenue.get(provinceKey) > 0 ? pair.revenue / provinceRevenue.get(provinceKey) : null;
        const overallShare = totalRevenue > 0 ? (categoryRevenue.get(pair.category) || 0) / totalRevenue : null;
        const affinityRatio = provinceShare != null && overallShare > 0 ? provinceShare / overallShare : null;
        const usableForecastGrowth = forecast?.status === 'available' && forecast.reliability === 'backtested' ? forecast.growth : null;
        const growthEvidence = [yoyGrowth, usableForecastGrowth].filter(value => value != null && Number.isFinite(value));
        const growthEvidenceAvailable = growthEvidence.length > 0;
        const meanGrowth = growthEvidenceAvailable ? growthEvidence.reduce((sum, value) => sum + value, 0) / growthEvidence.length : null;
        const growthMomentum = growthEvidenceAvailable ? growthScore(meanGrowth) : null;
        const demandConsistency = months.length ? activeMonths / months.length * 100 : 0;
        const categoryAffinity = affinityRatio == null ? 50 : mixScore(affinityRatio);
        const insufficientReasons = [];
        if (pair.orders.size < PRESCRIPTIVE_MIN_ORDERS) insufficientReasons.push(`Fewer than ${PRESCRIPTIVE_MIN_ORDERS} distinct orders.`);
        if (activeMonths < PRESCRIPTIVE_MIN_ACTIVE_MONTHS) insufficientReasons.push(`Fewer than ${PRESCRIPTIVE_MIN_ACTIVE_MONTHS} active months.`);
        if (!growthEvidenceAvailable) insufficientReasons.push('No valid year-over-year growth or usable forecast growth is available.');
        const eligible = insufficientReasons.length === 0;
        return {
            key: JSON.stringify([pair.region, pair.province, pair.category]),
            region: pair.region,
            province: pair.province,
            category: pair.category,
            demand: currentDemand,
            revenue: pair.revenue,
            orders: pair.orders.size,
            quantity: pair.quantity,
            yoyChange: rounded(yoyChange),
            yoyGrowth: rounded(yoyGrowth),
            yoyMonthsCompared,
            yoyMonths,
            growthEvidenceAvailable,
            meanGrowth: rounded(meanGrowth),
            forecastDemand: forecast?.forecastDemand ?? null,
            forecastGrowth: rounded(forecast?.status === 'available' ? forecast.growth : null),
            forecastTrend: forecast?.trend ?? 'Unavailable',
            forecastAvailable: forecast?.status === 'available',
            forecastReason: forecast?.reason ?? 'No matching predictive series is available for this combination.',
            forecastModel: forecast?.model ?? null,
            forecastReliability: forecast?.reliability ?? null,
            forecastGrowthUsedForScoring: usableForecastGrowth !== null,
            forecastEvidenceNote: forecast?.status === 'available' && usableForecastGrowth === null ? 'Forecast is exploratory or did not beat the benchmark; only independent historical growth may support opportunity scoring.' : null,
            forecastMape: rounded(forecast?.validation?.mape ?? null),
            forecastBeatsBenchmark: forecast?.validation?.beatsBaseline ?? null,
            forecastBacktestMonths: forecast?.validation?.months ?? null,
            activeMonths,
            calendarMonths: months.length,
            categoryShare: rounded(provinceShare == null ? null : provinceShare * 100),
            overallCategoryShare: rounded(overallShare == null ? null : overallShare * 100),
            affinityRatio: rounded(affinityRatio),
            factors: { demandStrength: null, growthMomentum: rounded(growthMomentum), demandConsistency: rounded(demandConsistency), categoryAffinity: rounded(categoryAffinity) },
            insufficientReasons,
            eligible,
            status: eligible ? 'eligible' : 'insufficient',
            opportunityScore: null,
            strategy: null
        };
    });

    const scoreRows = pairs.filter(pair => pair.eligible);
    const demandRanks = percentileRanks(scoreRows.map(pair => ({ key: pair.key, value: pair.demand ?? 0 })));
    for (const pair of scoreRows) {
        const demandStrength = demandRanks.get(pair.key) ?? 50;
        pair.factors.demandStrength = rounded(demandStrength);
        const w = PRESCRIPTIVE_WEIGHTS;
        pair.opportunityScore = rounded(demandStrength * w.demandStrength + pair.factors.growthMomentum * w.growthMomentum + pair.factors.demandConsistency * w.demandConsistency + pair.factors.categoryAffinity * w.categoryAffinity);
        const t = STRATEGY_THRESHOLDS;
        if (demandStrength >= t.strongDemandPercentile && pair.meanGrowth >= t.strongGrowthPercent) pair.strategy = 'EXPAND SELECTIVELY';
        else if (demandStrength >= t.strongDemandPercentile && pair.meanGrowth >= t.steadyGrowthPercent) pair.strategy = 'SUSTAIN CORE DEMAND';
        else if (demandStrength >= t.moderateDemandPercentile && pair.meanGrowth >= t.strongGrowthPercent) pair.strategy = 'PILOT AND VALIDATE';
        else pair.strategy = 'MONITOR / LOWER PRIORITY';
    }

    const categories = [...new Set(pairs.map(pair => pair.category))].sort((a, b) => a.localeCompare(b));
    return {
        filters,
        horizon,
        target,
        model: MODEL_NAMES[model],
        missingMonthMode,
        minimumOrders: PRESCRIPTIVE_MIN_ORDERS,
        minimumActiveMonths: PRESCRIPTIVE_MIN_ACTIVE_MONTHS,
        scoring: {
            weights: PRESCRIPTIVE_WEIGHTS,
            thresholds: STRATEGY_THRESHOLDS,
            growthMomentum: '50 + 50 x tanh(average growth % / 25)',
            salesMix: '50 + 25 x log2(local category share / overall category share), limited to ratios between 0.25 and 4',
            note: 'Relative heuristics for ranking combinations against each other. They are not calibrated probabilities or return estimates.'
        },
        dataCompleteness: completenessNote(bounds),
        notes: target === 'orders' ? [ORDER_COUNT_NOTE] : [],
        effectiveRange: { start: months[0] || null, end: months.at(-1) || null },
        categories,
        pairs: pairs.sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1) || a.province.localeCompare(b.province) || a.category.localeCompare(b.category)),
        source: 'supabase'
    };
}
