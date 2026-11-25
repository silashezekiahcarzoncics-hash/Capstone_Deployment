import { forecastAccuracyVerdict } from './forecastAccuracy.js';
const finite = value => value != null && Number.isFinite(Number(value));

export function filterForecastScatterRows(rows = []) {
    const points = [];
    let omitted = 0;
    for (const row of rows) {
        if (!finite(row?.forecastDemand) || !finite(row?.growth)) {
            omitted += 1;
            continue;
        }
        points.push({ row, x: Number(row.forecastDemand), y: Number(row.growth) });
    }
    return { points, omitted };
}

export function canUseForecastLogScale(points = []) {
    return points.length > 0 && points.every(point => point.x > 0 && Number.isFinite(point.x));
}

export function median(values = []) {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted, proportion) {
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * proportion;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function paddedRange(minimum, maximum, ratio = 0.08) {
    if (minimum === maximum) {
        const padding = Math.abs(minimum) > 0 ? Math.abs(minimum) * ratio : 1;
        return [minimum - padding, maximum + padding];
    }
    const padding = (maximum - minimum) * ratio;
    return [minimum - padding, maximum + padding];
}

function centeredDomainAtZero(value) {
    if (value === 0) return { min: -1, max: 1 };
    return value > 0 ? { min: 0, max: value * 2 } : { min: value * 2, max: 0 };
}

export function forecastScatterYDomain(points = []) {
    if (!points.length) return { min: -1, max: 1, clamped: false };
    const sorted = points.map(point => point.y).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return { min: -1, max: 1, clamped: false };
    if (sorted[0] === sorted[sorted.length - 1]) {
        return { ...centeredDomainAtZero(sorted[0]), clamped: sorted.length >= 10 };
    }

    if (sorted.length < 10) {
        let min = Math.min(0, sorted[0]);
        let max = Math.max(0, sorted[sorted.length - 1]);
        if (min === max) [min, max] = paddedRange(min, max);
        return { min, max, clamped: false };
    }

    const [paddedMin, paddedMax] = paddedRange(quantile(sorted, 0.02), quantile(sorted, 0.98));
    let min = Math.min(0, paddedMin);
    let max = Math.max(0, paddedMax);
    if (min === max) [min, max] = paddedRange(min, max);
    return { min, max, clamped: true };
}

export function niceTicks(minimum, maximum, count = 5) {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0];
    if (minimum === maximum) {
        const padding = Math.abs(minimum) > 0 ? Math.abs(minimum) * 0.1 : 1e-9;
        minimum -= padding;
        maximum += padding;
    }
    const rawStep = (maximum - minimum) / Math.max(1, count - 1);
    const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rawStep)));
    const normalized = rawStep / magnitude;
    const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = niceFactor * magnitude;
    const first = Math.ceil(minimum / step - 1e-10) * step;
    const ticks = [];
    for (let value = first, index = 0; value <= maximum + step * 1e-9 && index < 100; value += step, index += 1) {
        ticks.push(Math.abs(value) < step * 1e-10 ? 0 : Number(value.toPrecision(12)));
    }
    return ticks.length ? ticks : [minimum, maximum];
}

export function logTicks(minimum, maximum) {
    if (!(minimum > 0) || !(maximum >= minimum)) return [];
    const lowPower = Math.floor(Math.log10(minimum));
    const highPower = Math.ceil(Math.log10(maximum));
    const ticks = [];
    for (let power = lowPower; power <= highPower; power += 1) {
        for (const factor of [1, 2, 5]) {
            const value = factor * (10 ** power);
            if (value >= minimum && value <= maximum) ticks.push(value);
        }
    }
    return ticks.length > 8 ? ticks.filter((_, index) => index % Math.ceil(ticks.length / 8) === 0) : ticks;
}

export function compactNumber(value, { currency = false, signed = false } = {}) {
    if (!Number.isFinite(value)) return 'N/A';
    const abs = Math.abs(value);
    const prefix = value < 0 ? '-' : signed && value > 0 ? '+' : '';
    const currencyPrefix = currency ? '₱' : '';
    if (abs > 0 && abs < 0.001) return `${prefix}${currencyPrefix}${abs.toExponential(1)}`;
    const divisor = abs >= 1_000_000 ? 1_000_000 : abs >= 1_000 ? 1_000 : 1;
    const suffix = divisor === 1_000_000 ? 'M' : divisor === 1_000 ? 'k' : '';
    const digits = divisor === 1 ? (abs % 1 === 0 ? 0 : 2) : 1;
    const number = new Intl.NumberFormat('en-PH', { maximumFractionDigits: digits }).format(abs / divisor);
    return `${prefix}${currencyPrefix}${number}${suffix}`;
}

export function orderForecastScatterForKeyboard(points = []) {
    return points.slice().sort((a, b) => a.x - b.x || a.y - b.y || String(a.row?.key || '').localeCompare(String(b.row?.key || '')));
}

function truncateLabel(value, maximum = 24) {
    const text = String(value || 'Unknown');
    return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function overlaps(a, b, gap = 4) {
    return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

export function scatterPointName(row, singleCategory = false) {
    const province = row?.province || 'Unknown';
    return singleCategory ? province : `${province} · ${row?.category || 'Unknown'}`;
}

// Places up to `maxLabels` labels. Off-the-chart (edge) points are labelled first, then the largest
// forecasts. A label tries the right of its dot, then the left, then above it (second line for edge
// markers). Labels never overlap each other, the `reserved` areas (reference-line captions), or leave the plot.
export function placeForecastScatterLabels(points = [], { left, top, right, bottom, maxLabels = 5, charWidth = 5.4, lineHeight = 12, singleCategory = false, reserved = [] } = {}) {
    const edgePoints = points.filter(point => point.edge).sort((a, b) => Math.abs(b.y) - Math.abs(a.y)).slice(0, 2);
    const regular = points.filter(point => !point.edge).sort((a, b) => b.x - a.x || a.y - b.y);
    const candidates = [...edgePoints, ...regular].slice(0, maxLabels * 4);
    const placed = [];
    for (const point of candidates) {
        if (placed.length >= maxLabels) break;
        const text = truncateLabel(scatterPointName(point.row, singleCategory));
        const width = Math.min(150, text.length * charWidth);
        const baselines = point.edge === 'high' ? [top + 14, top + 30]
            : point.edge === 'low' ? [bottom - 8, bottom - 24]
                : [point.plotY - 2];
        const options = [];
        for (const baseline of baselines) {
            const vertical = { top: baseline - lineHeight + 2, bottom: baseline + 2 };
            options.push({ anchor: 'start', x: point.plotX + 8, baseline, bounds: { left: point.plotX + 8, right: point.plotX + 8 + width, ...vertical } });
            options.push({ anchor: 'end', x: point.plotX - 8, baseline, bounds: { left: point.plotX - 8 - width, right: point.plotX - 8, ...vertical } });
        }
        if (!point.edge) {
            const baseline = point.plotY - 10;
            const vertical = { top: baseline - lineHeight + 2, bottom: baseline + 2 };
            options.push({ anchor: 'end', x: point.plotX + 4, baseline, bounds: { left: point.plotX + 4 - width, right: point.plotX + 4, ...vertical } });
            options.push({ anchor: 'start', x: point.plotX - 4, baseline, bounds: { left: point.plotX - 4, right: point.plotX - 4 + width, ...vertical } });
        }
        const fit = options.find(option => option.bounds.left >= left && option.bounds.right <= right && option.bounds.top >= top && option.bounds.bottom <= bottom
            && !placed.some(item => overlaps(item.bounds, option.bounds))
            && !reserved.some(area => overlaps(area, option.bounds, 2)));
        if (fit) placed.push({ key: point.key, text, x: fit.x, y: fit.baseline, anchor: fit.anchor, bounds: fit.bounds });
    }
    return placed;
}

export function calculateForecastScatter(rows, { width = 920, height = 500, logScale = false } = {}) {
    const { points, omitted } = filterForecastScatterRows(rows);
    const narrow = width < 560;
    const left = narrow ? 54 : 82;
    const right = width - (narrow ? 16 : 30);
    const top = 30;
    const bottom = height - (narrow ? 58 : 66);
    const yDomain = forecastScatterYDomain(points);
    const xValues = points.map(point => point.x);
    let xMin = xValues.length ? Math.min(...xValues) : 0;
    let xMax = xValues.length ? Math.max(...xValues) : 1;
    const useLog = Boolean(logScale && canUseForecastLogScale(points));

    if (useLog) {
        if (xMin === xMax) {
            xMin /= 1.5;
            xMax *= 1.5;
        }
        // keep the smallest and largest dots off the plot edges
        xMin /= 1.12;
        xMax *= 1.12;
    } else {
        [xMin, xMax] = paddedRange(xMin, xMax, 0.05);
    }
    if (xMin === xMax) [xMin, xMax] = paddedRange(xMin, xMax, 0.05);
    const xScale = value => {
        if (useLog) return left + ((Math.log(value) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin))) * (right - left);
        return left + ((value - xMin) / (xMax - xMin)) * (right - left);
    };
    const yScale = value => bottom - ((value - yDomain.min) / (yDomain.max - yDomain.min)) * (bottom - top);
    const plotted = points.map((point, index) => ({
        ...point,
        key: String(point.row?.key ?? `${point.row?.province || ''}:${point.row?.category || ''}:${index}`),
        plotX: xScale(point.x),
        plotY: yScale(Math.min(yDomain.max, Math.max(yDomain.min, point.y))),
        edge: yDomain.clamped && point.y > yDomain.max ? 'high' : yDomain.clamped && point.y < yDomain.min ? 'low' : ''
    }));
    const singleCategory = new Set(plotted.map(point => point.row?.category)).size <= 1;
    const medianForecast = median(xValues);
    // "No growth" caption: pick the first free spot (right/left, above/below the zero line) that no dot touches
    let noGrowth = null;
    if (yDomain.min <= 0 && yDomain.max >= 0) {
        const zeroY = yScale(0);
        const captionWidth = 56;
        const spots = [
            { anchor: 'end', x: right - 3, y: zeroY - 5, rect: { left: right - 3 - captionWidth, right: right - 3, top: zeroY - 17, bottom: zeroY - 2 } },
            { anchor: 'end', x: right - 3, y: zeroY + 14, rect: { left: right - 3 - captionWidth, right: right - 3, top: zeroY + 3, bottom: zeroY + 17 } },
            { anchor: 'start', x: left + 4, y: zeroY - 5, rect: { left: left + 4, right: left + 4 + captionWidth, top: zeroY - 17, bottom: zeroY - 2 } },
            { anchor: 'start', x: left + 4, y: zeroY + 14, rect: { left: left + 4, right: left + 4 + captionWidth, top: zeroY + 3, bottom: zeroY + 17 } }
        ];
        const touchesDot = rect => plotted.some(point => point.plotX + 7 > rect.left && point.plotX - 7 < rect.right && point.plotY + 7 > rect.top && point.plotY - 7 < rect.bottom);
        noGrowth = spots.find(spot => !touchesDot(spot.rect)) || spots[0];
    }
    // "Typical forecast" caption: next to the median line on the top (or bottom) edge; if a dot or marker is in the way, slide along the edge to the nearest free spot
    let typicalLabel = null;
    if (medianForecast != null) {
        const medianX = xScale(medianForecast);
        const captionWidth = 98;
        const rows = [{ y: top + 11, top, bottom: top + 15 }, { y: bottom - 6, top: bottom - 18, bottom: bottom - 2 }];
        const touches = rect => plotted.some(point => point.plotX + 8 > rect.left && point.plotX - 8 < rect.right && point.plotY + 8 > rect.top && point.plotY - 8 < rect.bottom);
        const spots = [];
        for (const row of rows) {
            const starts = [Math.min(Math.max(medianX + 4, left + 4), right - captionWidth)];
            for (let x = left + 4; x <= right - captionWidth; x += 10) starts.push(x);
            const ordered = [starts[0], ...starts.slice(1).sort((a, b) => Math.abs(a - medianX) - Math.abs(b - medianX))];
            const leftEnd = Math.max(Math.min(medianX - 4, right - 4), left + 4 + captionWidth);
            const candidates = [
                { anchor: 'start', x: ordered[0] }, { anchor: 'end', x: leftEnd },
                ...ordered.slice(1).map(x => ({ anchor: 'start', x }))
            ];
            for (const candidate of candidates) {
                const l = candidate.anchor === 'start' ? candidate.x : candidate.x - captionWidth;
                spots.push({ anchor: candidate.anchor, x: candidate.x, y: row.y, rect: { left: l, right: l + captionWidth, top: row.top, bottom: row.bottom } });
            }
        }
        const straddlesLine = rect => rect.left < medianX + 2 && rect.right > medianX - 2;
        typicalLabel = spots.find(spot => !touches(spot.rect) && !straddlesLine(spot.rect))
            || spots.find(spot => !touches(spot.rect))
            || spots[0];
    }
    // areas taken by the captions, so point labels stay clear of them
    const reserved = [];
    if (noGrowth) reserved.push(noGrowth.rect);
    if (typicalLabel) reserved.push(typicalLabel.rect);
    const labels = placeForecastScatterLabels(plotted, { left, top, right, bottom, singleCategory, reserved });
    const logTickList = useLog ? logTicks(xMin, xMax) : [];
    const xTicks = useLog ? (logTickList.length >= 2 ? logTickList : niceTicks(xMin, xMax, 5)) : niceTicks(xMin, xMax, narrow ? 4 : 6);
    const yTicks = niceTicks(yDomain.min, yDomain.max, 6);
    const ordered = orderForecastScatterForKeyboard(plotted);
    return {
        points: plotted,
        omitted,
        width,
        height,
        left,
        right,
        top,
        bottom,
        xMin,
        xMax,
        yMin: yDomain.min,
        yMax: yDomain.max,
        yClamped: yDomain.clamped,
        useLog,
        medianForecast,
        noGrowth: noGrowth ? { x: noGrowth.x, y: noGrowth.y, anchor: noGrowth.anchor } : null,
        typicalLabel: typicalLabel ? { x: typicalLabel.x, y: typicalLabel.y, anchor: typicalLabel.anchor } : null,
        xTicks,
        yTicks,
        xScale,
        yScale,
        labels,
        singleCategory,
        orderedKeys: ordered.map(point => point.key),
        edgeCount: plotted.filter(point => point.edge).length
    };
}

const insightItem = (point, singleCategory) => {
    const verdict = forecastAccuracyVerdict({
        validation: point.row?.validation,
        forecastStatus: point.row?.forecastStatus,
        reliability: point.row?.reliability,
        status: point.row?.status
    });
    return {
        key: point.key ?? String(point.row?.key ?? ''),
        name: scatterPointName(point.row, singleCategory),
        forecast: point.x,
        growth: point.y,
        mape: verdict.mape,
        tone: verdict.tone,
        tierName: verdict.tierName,
        evidence: verdict.evidence
    };
};

// Rule-based, plain-language facts about the plotted pairs (no AI, no guessing).
export function buildScatterInsights(points = []) {
    const singleCategory = new Set(points.map(point => point.row?.category)).size <= 1;
    const items = points.map(point => insightItem(point, singleCategory));
    const medianForecast = median(items.map(item => item.forecast));
    const bigEnough = item => medianForecast != null && item.forecast >= medianForecast;
    const trusted = item => item.evidence === 'validated' && (item.tone === 'very-close' || item.tone === 'good');
    const top = (list, sorter, count = 3) => list.slice().sort(sorter).slice(0, count);

    const biggest = items.length ? items.reduce((best, item) => (item.forecast > best.forecast ? item : best)) : null;
    const bigGrowing = items.filter(item => bigEnough(item) && item.growth > 0);
    return {
        total: items.length,
        validated: items.filter(item => item.evidence === 'validated').length,
        exploratory: items.filter(item => item.evidence !== 'validated').length,
        growing: items.filter(item => item.growth > 0).length,
        shrinking: items.filter(item => item.growth < 0).length,
        flat: items.filter(item => item.growth === 0).length,
        medianForecast,
        singleCategory,
        biggest,
        bestBets: top(bigGrowing.filter(trusted), (a, b) => b.growth - a.growth),
        watchList: top(bigGrowing.filter(item => !trusted(item)), (a, b) => b.growth - a.growth),
        coolingBig: top(items.filter(item => bigEnough(item) && item.growth < 0), (a, b) => a.growth - b.growth)
    };
}

// Same tier colors used by the tables and the accuracy pill.
export const SCATTER_ACCURACY_COLORS = {
    'very-close': '#08784d',
    good: '#288849',
    reasonable: '#a36d08',
    'high-error': '#b64040',
    unavailable: '#718097'
};
