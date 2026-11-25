import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildScatterInsights,
    calculateForecastScatter,
    canUseForecastLogScale,
    compactNumber,
    filterForecastScatterRows,
    forecastScatterYDomain,
    median,
    niceTicks,
    orderForecastScatterForKeyboard,
    placeForecastScatterLabels,
    scatterPointName
} from './forecastScatter.js';
import { forecastAccuracyVerdict } from './forecastAccuracy.js';

const row = (key, forecastDemand, growth, extra = {}) => ({
    key,
    province: `Province ${key}`,
    category: 'Category',
    forecastDemand,
    growth,
    ...extra
});

test('filters pairs without finite forecast or growth values', () => {
    const result = filterForecastScatterRows([
        row('valid', 100, 5),
        row('null-growth', 100, null),
        row('null-forecast', null, 5),
        row('invalid', 'not a number', 5)
    ]);
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].row.key, 'valid');
    assert.equal(result.omitted, 3);
});

test('leaves fewer than ten growth values unclamped and includes zero', () => {
    const domain = forecastScatterYDomain([{ y: 5 }, { y: 25 }]);
    assert.deepEqual(domain, { min: 0, max: 25, clamped: false });
    const negative = forecastScatterYDomain([{ y: -12 }, { y: -4 }]);
    assert.equal(negative.min, -12);
    assert.equal(negative.max, 0);
});

test('clamps the two-percent tails for ten or more points and marks edge outliers', () => {
    const values = Array.from({ length: 10 }, (_, index) => ({ y: index === 9 ? 400 : index }));
    const domain = forecastScatterYDomain(values);
    assert.equal(domain.clamped, true);
    assert.ok(domain.min <= 0 && domain.max >= 0);
    assert.ok(domain.max < 400);
    const plot = calculateForecastScatter(values.map((point, index) => row(String(index), index + 1, point.y)));
    assert.ok(plot.points.some(point => point.y === 400 && point.edge === 'high'));
    assert.ok(plot.edgeCount > 0);
});

test('handles empty, identical, tiny, huge, and negative tick ranges without NaN', () => {
    for (const [minimum, maximum] of [[0, 0], [1e-12, 8e-12], [-1e12, 1e12], [-0.25, 0.75], [1e9, 1e9]]) {
        const ticks = niceTicks(minimum, maximum);
        assert.ok(ticks.length > 0);
        assert.ok(ticks.every(Number.isFinite));
    }
    assert.match(compactNumber(1_200_000, { currency: true }), /₱1\.2M/);
    assert.match(compactNumber(350, { signed: true }), /^\+350$/);
});

test('allows log scale only when every plotted forecast is positive', () => {
    assert.equal(canUseForecastLogScale([{ x: 1 }, { x: 20 }]), true);
    assert.equal(canUseForecastLogScale([{ x: 1 }, { x: 0 }]), false);
    assert.equal(canUseForecastLogScale([{ x: -2 }]), false);
    assert.equal(canUseForecastLogScale([]), false);
});

test('calculates odd and even medians', () => {
    assert.equal(median([7, 1, 5]), 5);
    assert.equal(median([8, 2, 4, 6]), 5);
    assert.equal(median([]), null);
});

test('shared accuracy verdict distinguishes validated, exploratory, and unavailable pairs', () => {
    const validated = forecastAccuracyVerdict({
        validation: { mape: 8.4, beatsBaseline: true },
        forecastStatus: 'Available — Validated',
        reliability: 'backtested',
        status: 'available'
    });
    const exploratory = forecastAccuracyVerdict({
        validation: { mape: 48.7, beatsBaseline: false },
        forecastStatus: 'Available — Exploratory',
        reliability: 'backtested_weak',
        status: 'available'
    });
    const unavailable = forecastAccuracyVerdict({ status: 'insufficient', forecastStatus: 'Unavailable' });
    assert.equal(validated.evidence, 'validated');
    assert.equal(validated.tone, 'very-close');
    assert.equal(exploratory.evidence, 'exploratory');
    assert.equal(exploratory.tone, 'reasonable');
    assert.equal(unavailable.evidence, 'unavailable');
    assert.equal(unavailable.tone, 'unavailable');
});

test('greedy labels stay inside the plot and do not overlap', () => {
    const points = Array.from({ length: 8 }, (_, index) => ({
        key: String(index),
        x: 100 - index,
        row: { province: `Province ${index}`, category: 'Category' },
        plotX: 80 + (index % 4) * 180,
        plotY: 70 + Math.floor(index / 4) * 110
    }));
    const labels = placeForecastScatterLabels(points, { left: 60, top: 40, right: 780, bottom: 280 });
    assert.ok(labels.length <= 5);
    assert.ok(labels.every(label => label.bounds.left >= 60 && label.bounds.top >= 40 && label.bounds.right <= 780 && label.bounds.bottom <= 280));
    for (let first = 0; first < labels.length; first += 1) {
        for (let second = first + 1; second < labels.length; second += 1) {
            const a = labels[first].bounds;
            const b = labels[second].bounds;
            assert.ok(a.right + 4 <= b.left || b.right + 4 <= a.left || a.bottom + 4 <= b.top || b.bottom + 4 <= a.top);
        }
    }
});

test('keyboard ordering uses forecast X then growth Y', () => {
    const ordered = orderForecastScatterForKeyboard([
        { x: 10, y: 2, row: { key: 'c' } },
        { x: 5, y: 8, row: { key: 'b' } },
        { x: 5, y: -1, row: { key: 'a' } }
    ]);
    assert.deepEqual(ordered.map(point => point.row.key), ['a', 'b', 'c']);
});

test('calculates finite scales for one, two, identical, and 500 pairs', () => {
    for (const rows of [
        [row('one', 50, 0)],
        [row('a', 50, 3), row('b', 50, 3)],
        Array.from({ length: 500 }, (_, index) => row(String(index), index + 1, (index % 17) - 8))
    ]) {
        const plot = calculateForecastScatter(rows);
        assert.equal(plot.points.length, rows.length);
        assert.ok(Number.isFinite(plot.xScale(plot.points[0].x)));
        assert.ok(Number.isFinite(plot.yScale(plot.points[0].y)));
        assert.ok(plot.points.every(point => Number.isFinite(point.plotX) && Number.isFinite(point.plotY)));
    }
    const identical = calculateForecastScatter([row('a', 50, 3), row('b', 50, 3)]);
    assert.ok(Math.abs(identical.points[0].plotX - (identical.left + identical.right) / 2) < 1e-8);
    assert.ok(Math.abs(identical.points[0].plotY - (identical.top + identical.bottom) / 2) < 1e-8);
    const tiny = calculateForecastScatter([row('tiny', 1e-12, 1e-12)]);
    assert.ok(Number.isFinite(tiny.points[0].plotX) && Number.isFinite(tiny.points[0].plotY));
});

const validRow = (key, forecastDemand, growth, mape, category = 'Category', extra = {}) => row(key, forecastDemand, growth, {
    category,
    status: 'available',
    forecastStatus: 'Available — Validated',
    reliability: 'backtested',
    validation: { mape, beatsBaseline: true },
    ...extra
});

test('labels flip to the left side when the right side would leave the plot', () => {
    const bounds = { left: 60, top: 40, right: 400, bottom: 280 };
    const labels = placeForecastScatterLabels([
        { key: 'far-right', x: 100, y: 5, row: { province: 'Rizal', category: 'C' }, plotX: 390, plotY: 150 }
    ], bounds);
    assert.equal(labels.length, 1);
    assert.equal(labels[0].anchor, 'end');
    assert.ok(labels[0].bounds.left >= bounds.left && labels[0].bounds.right <= bounds.right);
});

test('off-the-chart points are labelled first and the label stays inside the plot', () => {
    const bounds = { left: 60, top: 40, right: 780, bottom: 280 };
    const labels = placeForecastScatterLabels([
        { key: 'big', x: 900, y: 3, row: { province: 'Big', category: 'C' }, plotX: 200, plotY: 150 },
        { key: 'outlier-high', x: 10, y: 400, edge: 'high', row: { province: 'Spike', category: 'C' }, plotX: 300, plotY: 40 },
        { key: 'outlier-low', x: 10, y: -90, edge: 'low', row: { province: 'Dip', category: 'C' }, plotX: 500, plotY: 280 }
    ], bounds);
    assert.deepEqual(labels.slice(0, 2).map(label => label.key).sort(), ['outlier-high', 'outlier-low']);
    assert.ok(labels.every(label => label.bounds.left >= 60 && label.bounds.top >= 40 && label.bounds.right <= 780 && label.bounds.bottom <= 280));
});

test('label text drops the category when there is only one category', () => {
    assert.equal(scatterPointName({ province: 'Cavite', category: 'Shrink Wrap' }, true), 'Cavite');
    assert.equal(scatterPointName({ province: 'Cavite', category: 'Shrink Wrap' }, false), 'Cavite · Shrink Wrap');
    const single = calculateForecastScatter([row('a', 10, 1), row('b', 20, 2)]);
    assert.equal(single.singleCategory, true);
    assert.ok(single.labels.every(label => !label.text.includes('·')));
});

test('log scale keeps dots off the plot edges and always has axis ticks', () => {
    const narrow = [row('a', 1100, 2), row('b', 1250, -1), row('c', 1400, 5)];
    const plot = calculateForecastScatter(narrow, { logScale: true });
    assert.equal(plot.useLog, true);
    assert.ok(plot.xTicks.length >= 2, 'narrow log range must still get ticks');
    assert.ok(plot.points.every(point => point.plotX > plot.left + 4 && point.plotX < plot.right - 4));
    const wide = calculateForecastScatter([row('a', 1500, 1), row('b', 120000, 2)], { logScale: true });
    assert.ok(wide.points.every(point => point.plotX > wide.left + 4 && point.plotX < wide.right - 4));
});

test('narrow screens use tighter margins and still produce finite positions', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(String(index), 100 + index * 40, index - 5));
    const phone = calculateForecastScatter(rows, { width: 360, height: 360 });
    const desktop = calculateForecastScatter(rows);
    assert.ok(phone.left < desktop.left);
    assert.ok(phone.points.every(point => Number.isFinite(point.plotX) && Number.isFinite(point.plotY)));
    assert.ok(phone.points.every(point => point.plotX >= phone.left && point.plotX <= phone.right));
});

test('plain-language insights pick big, growing, well-tested pairs and flag the uncertain ones', () => {
    const rows = [
        validRow('best', 900, 30, 8),
        validRow('good', 800, 12, 15),
        validRow('risky', 950, 40, 70),
        validRow('ring', 800, 20, null, 'Category', { forecastStatus: 'Available — Exploratory', reliability: 'backtested_weak', validation: null }),
        validRow('cooling', 850, -25, 12),
        validRow('small', 50, 90, 5),
        validRow('tiny', 40, -10, 5)
    ];
    const insights = buildScatterInsights(calculateForecastScatter(rows).points);
    assert.equal(insights.total, 7);
    assert.equal(insights.validated, 6);
    assert.equal(insights.exploratory, 1);
    assert.equal(insights.growing, 5);
    assert.equal(insights.shrinking, 2);
    assert.equal(insights.biggest.name, 'Province risky');
    assert.deepEqual(insights.bestBets.map(item => item.name), ['Province best', 'Province good']);
    assert.deepEqual(insights.watchList.map(item => item.name), ['Province risky', 'Province ring']);
    assert.deepEqual(insights.coolingBig.map(item => item.name), ['Province cooling']);
    assert.ok(!insights.bestBets.some(item => item.name === 'Province small'), 'small sellers are not big bets');
});

test('insights handle empty input and the case with no trustworthy big growers', () => {
    const empty = buildScatterInsights([]);
    assert.equal(empty.total, 0);
    assert.equal(empty.biggest, null);
    assert.deepEqual(empty.bestBets, []);
    const noneTrusted = buildScatterInsights(calculateForecastScatter([validRow('a', 500, 10, 80), validRow('b', 400, 5, 90)]).points);
    assert.deepEqual(noneTrusted.bestBets, []);
    assert.ok(noneTrusted.watchList.length > 0);
});

test('labels never sit on top of the reserved caption areas', () => {
    const bounds = { left: 60, top: 30, right: 780, bottom: 280 };
    const reserved = [{ left: 718, right: 780, top: 133, bottom: 150 }, { left: 300, right: 392, top: 30, bottom: 45 }];
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const labels = placeForecastScatterLabels([
        { key: 'right-edge', x: 900, y: 1, row: { province: 'Misamis Oriental', category: 'C' }, plotX: 772, plotY: 150 },
        { key: 'top-spike', x: 10, y: 300, edge: 'high', row: { province: 'Benguet', category: 'C' }, plotX: 330, plotY: 30 }
    ], { ...bounds, reserved, singleCategory: true });
    assert.ok(labels.length >= 1);
    for (const label of labels) {
        for (const area of reserved) assert.ok(!overlap(label.bounds, area), `${label.text} overlaps a reserved area`);
    }
    const spike = labels.find(label => label.key === 'top-spike');
    assert.ok(spike, 'the off-the-chart point still gets a label by moving to a free line');
});

test('the "No growth" caption moves away from dots that would cover it', () => {
    const rows = [row('far', 120000, 1), row('near', 90000, -4), ...Array.from({ length: 6 }, (_, i) => row(`s${i}`, 1500 + i * 400, -10 - i))];
    const plot = calculateForecastScatter(rows);
    assert.ok(plot.noGrowth, 'zero line is inside the plot');
    const x0 = plot.noGrowth.anchor === 'end' ? plot.noGrowth.x - 56 : plot.noGrowth.x;
    const box = { left: x0, right: x0 + 56, top: plot.noGrowth.y - 12, bottom: plot.noGrowth.y + 3 };
    for (const point of plot.points) {
        const hit = point.plotX + 5 > box.left && point.plotX - 5 < box.right && point.plotY + 5 > box.top && point.plotY - 5 < box.bottom;
        assert.ok(!hit, `${point.row.key} sits on the No growth caption`);
    }
    const allPositive = calculateForecastScatter([row('a', 10, 5), row('b', 20, 8)]);
    assert.ok(allPositive.noGrowth, 'zero is always included in the growth axis');
});

test('the "Typical forecast" caption moves away from an off-the-chart marker', () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => row(`n${i}`, 100 + i * 30, (i % 5) - 2)), row('spike', 270, 900)];
    const plot = calculateForecastScatter(rows, { width: 360, height: 360 });
    assert.ok(plot.typicalLabel, 'median line has a caption');
    const spike = plot.points.find(point => point.row.key === 'spike');
    assert.equal(spike.edge, 'high');
    const left = plot.typicalLabel.anchor === 'start' ? plot.typicalLabel.x : plot.typicalLabel.x - 98;
    const box = { left, right: left + 98, top: plot.typicalLabel.y - 11, bottom: plot.typicalLabel.y + 4 };
    const hit = spike.plotX + 8 > box.left && spike.plotX - 8 < box.right && spike.plotY + 8 > box.top && spike.plotY - 8 < box.bottom;
    assert.ok(!hit, 'caption must not be covered by the marker');
    assert.ok(box.left >= plot.left && box.right <= plot.right, 'caption stays inside the plot');
});

test('the "Typical forecast" caption sits beside the median line, not across it, when there is room', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(`m${i}`, 200 + i * 90, (i % 6) - 3));
    for (const options of [{}, { width: 360, height: 360 }]) {
        const plot = calculateForecastScatter(rows, options);
        const medianX = plot.xScale(plot.medianForecast);
        const left = plot.typicalLabel.anchor === 'start' ? plot.typicalLabel.x : plot.typicalLabel.x - 98;
        assert.ok(left + 98 <= medianX + 1 || left >= medianX - 1, 'caption must not straddle the median line');
    }
});
