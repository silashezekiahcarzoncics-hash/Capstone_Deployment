import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categorySeriesColor } from '../utils/categorySeriesColor';
import { forecastAccuracyVerdict, formatErrorPercent } from '../utils/forecastAccuracy';
import {
    SCATTER_ACCURACY_COLORS as ACCURACY_COLORS,
    buildScatterInsights,
    calculateForecastScatter,
    canUseForecastLogScale,
    compactNumber,
    filterForecastScatterRows
} from '../utils/forecastScatter';
import ForecastScatterExplainer from './ForecastScatterExplainer';
import GrowthDisplayToggle from './GrowthDisplayToggle';

const ACCURACY_LEGEND = [
    { tone: 'very-close', text: 'Very close (under 10% off)' },
    { tone: 'good', text: 'Good (10–20% off)' },
    { tone: 'reasonable', text: 'Reasonable (20–50% off)' },
    { tone: 'high-error', text: 'High error (50%+ off)' },
    { tone: 'unavailable', text: 'Not available' }
];
const EVIDENCE_TEXT = {
    validated: 'Validated (tested on past sales)',
    exploratory: 'Exploratory (early estimate)',
    unavailable: 'Unavailable'
};
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function evidenceFor(row) {
    const verdict = forecastAccuracyVerdict({
        validation: row.validation,
        forecastStatus: row.forecastStatus,
        reliability: row.reliability,
        status: row.status
    });
    return { ...verdict, validated: verdict.evidence === 'validated' };
}

function accuracyText(accuracy) {
    return accuracy.mape == null
        ? 'Not available'
        : `off by ${formatErrorPercent(accuracy.mape)} on average · ${accuracy.tierName}`;
}

function pointTooltip(point, formatValue, formatGrowth, growthDisplay) {
    const { row, accuracy } = point;
    return `${row.province || 'Unknown province'} (${row.region || 'Unknown region'}) · ${row.category || 'Unknown category'}. Forecast per month: ${formatValue(point.x)}. ${growthDisplay === 'value' ? 'Expected monthly change' : 'Expected growth'}: ${formatGrowth(point.y)}. Forecast accuracy: ${accuracyText(accuracy)}. Status: ${EVIDENCE_TEXT[accuracy.evidence] || accuracy.evidenceLabel}. Model: ${row.model || 'Model unavailable'}.`;
}

function markerPath(point, plot) {
    const y = point.edge === 'high' ? plot.top + 5 : plot.bottom - 5;
    return point.edge === 'high'
        ? `M ${point.plotX} ${y - 5} L ${point.plotX - 6} ${y + 5} L ${point.plotX + 6} ${y + 5} Z`
        : `M ${point.plotX} ${y + 5} L ${point.plotX - 6} ${y - 5} L ${point.plotX + 6} ${y - 5} Z`;
}

function chartHeightFor(width) {
    return width < 560 ? clamp(Math.round(width * 0.95), 340, 460) : clamp(Math.round(width * 0.5), 330, 560);
}

export default function ForecastScatterChart({ rows, target, growthDisplay = 'percent', onToggleGrowthDisplay, onSelect, highlightedKey, scrollToKey = '', highlightRequestId = 0, formatValue, formatPercent }) {
    const [logScale, setLogScale] = useState(false);
    const [colorBy, setColorBy] = useState('accuracy');
    const [tooltipKey, setTooltipKey] = useState('');
    const [focusedKey, setFocusedKey] = useState('');
    const [width, setWidth] = useState(920);
    const [showExplainer, setShowExplainer] = useState(false);
    const chartRef = useRef(null);
    const dotRefs = useRef(new Map());
    const formatGrowth = useCallback(value => growthDisplay === 'value'
        ? value == null || !Number.isFinite(Number(value)) ? 'N/A' : formatValue(value, target)
        : formatPercent(value), [growthDisplay, formatValue, formatPercent, target]);

    const plottable = useMemo(() => filterForecastScatterRows(rows).points, [rows]);
    const hasPoints = plottable.length > 0;
    const canLog = useMemo(() => canUseForecastLogScale(plottable), [plottable]);
    const effectiveLogScale = logScale && canLog;
    const height = chartHeightFor(width);
    const plot = useMemo(() => calculateForecastScatter(rows, { width, height, logScale: effectiveLogScale }), [rows, width, height, effectiveLogScale]);
    const categories = useMemo(() => [...new Set(rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
    const canColorByProduct = categories.length > 1;
    const effectiveColorBy = canColorByProduct ? colorBy : 'accuracy';

    const points = useMemo(() => plot.points.map(point => {
        const accuracy = evidenceFor(point.row);
        const withAccuracy = { ...point, accuracy };
        return {
            ...withAccuracy,
            color: effectiveColorBy === 'accuracy'
                ? ACCURACY_COLORS[accuracy.tone]
                : categorySeriesColor(point.row.category, categories),
            ariaLabel: pointTooltip(withAccuracy, value => formatValue(value, target), formatGrowth, growthDisplay)
        };
    }), [plot.points, effectiveColorBy, categories, formatValue, formatPercent, formatGrowth, growthDisplay, target]);
    const pointByKey = useMemo(() => new Map(points.map(point => [point.key, point])), [points]);
    const highlightedPoint = points.find(point => point.row.key === highlightedKey);
    const drawPoints = useMemo(() => highlightedPoint
        ? [...points.filter(point => point !== highlightedPoint), highlightedPoint]
        : points, [points, highlightedPoint]);
    const plottedValidated = points.filter(point => point.accuracy.evidence === 'validated').length;
    const plottedExploratory = points.filter(point => point.accuracy.evidence === 'exploratory').length;
    const beyondAxis = plot.edgeCount;
    const labelByKey = useMemo(() => new Map(plot.labels.map(label => [label.key, label])), [plot.labels]);
    const tooltipPoint = pointByKey.get(tooltipKey);
    const insights = useMemo(() => buildScatterInsights(plot.points), [plot.points]);
    const closeExplainer = useCallback(() => setShowExplainer(false), []);
    useEffect(() => {
        const element = chartRef.current;
        if (!element) return undefined;
        const update = next => setWidth(current => (next > 0 && Math.abs(current - next) >= 1 ? Math.round(next) : current));
        update(element.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(entries => update(entries[0]?.contentRect?.width || 0));
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasPoints]);

    useEffect(() => {
        if (!tooltipKey) return undefined;
        const closeOnEscape = event => { if (event.key === 'Escape') setTooltipKey(''); };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [tooltipKey]);

    useEffect(() => {
        if (!scrollToKey || !highlightRequestId) return;
        const point = points.find(item => item.row.key === scrollToKey);
        const marker = point && dotRefs.current.get(point.key);
        marker?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, [scrollToKey, highlightRequestId, points]);

    const orderedKeyIndex = useMemo(() => new Map(plot.orderedKeys.map((key, index) => [key, index])), [plot.orderedKeys]);
    function moveFocus(point, key) {
        const currentIndex = orderedKeyIndex.get(point.key) ?? 0;
        let nextIndex = currentIndex;
        if (key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
        if (key === 'ArrowRight') nextIndex = Math.min(plot.orderedKeys.length - 1, currentIndex + 1);
        if (key === 'Home') nextIndex = 0;
        if (key === 'End') nextIndex = plot.orderedKeys.length - 1;
        const nextKey = plot.orderedKeys[nextIndex];
        if (nextKey) {
            setFocusedKey(nextKey);
            setTooltipKey(nextKey);
            dotRefs.current.get(nextKey)?.focus();
        }
    }

    // Shared interaction props for dots and edge markers.
    function interactionProps(point) {
        return {
            role: 'button',
            tabIndex: point.key === (focusedKey || plot.orderedKeys[0]) ? 0 : -1,
            'aria-label': point.ariaLabel,
            ref: node => { if (node) dotRefs.current.set(point.key, node); else dotRefs.current.delete(point.key); },
            onFocus: () => { setFocusedKey(point.key); setTooltipKey(point.key); },
            onBlur: () => setTooltipKey(current => (current === point.key ? '' : current)),
            onMouseEnter: () => setTooltipKey(point.key),
            onMouseLeave: () => setTooltipKey(current => (current === point.key ? '' : current)),
            onClick: () => onSelect(point.row),
            onKeyDown: event => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); moveFocus(point, event.key); }
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.row); }
                if (event.key === 'Escape') setTooltipKey('');
            }
        };
    }

    const tooltipWidth = Math.min(280, Math.max(190, width - 16));
    const tooltipHeight = 132;
    const tooltipLeft = tooltipPoint
        ? clamp(tooltipPoint.plotX + (tooltipPoint.plotX > width * 0.6 ? -tooltipWidth - 12 : 12), 8, Math.max(8, width - tooltipWidth - 8))
        : 8;
    const tooltipTop = tooltipPoint
        ? clamp(tooltipPoint.plotY + (tooltipPoint.plotY > height * 0.6 ? -tooltipHeight - 10 : 10), 6, Math.max(6, height - tooltipHeight - 6))
        : 6;

    const sales = target === 'revenue' ? 'sales' : target === 'orders' ? 'orders' : 'units';
    const axisXLabel = `Forecast ${sales} per month${target === 'revenue' ? ' (₱)' : ''}`;
    const axisYLabel = growthDisplay === 'value'
        ? width < 560 ? `Monthly change${target === 'revenue' ? ' (₱)' : ''}` : `Expected monthly change${target === 'revenue' ? ' (₱)' : target === 'orders' ? ' (orders)' : ' (units)'}`
        : width < 560 ? 'Expected growth (%)' : 'Expected growth vs. recent months (%)';

    // Quadrant captions only where the quadrant really exists and the text fits inside it.
    const zeroY = plot.yScale(0);
    const medianX = plot.medianForecast != null ? plot.xScale(plot.medianForecast) : null;
    const textWidth = text => text.length * 5.8;
    const captionCandidates = medianX == null || width < 520 ? [] : [
        { text: 'Smaller & growing', x: plot.left + 8, y: plot.top + 28, anchor: 'start', need: 'top', side: 'left' },
        { text: 'Bigger & growing', x: plot.right - 8, y: plot.top + 28, anchor: 'end', need: 'top', side: 'right' },
        { text: 'Smaller & shrinking', x: plot.left + 8, y: plot.bottom - 8, anchor: 'start', need: 'bottom', side: 'left' },
        { text: 'Bigger but shrinking', x: plot.right - 8, y: plot.bottom - 8, anchor: 'end', need: 'bottom', side: 'right' }
    ];
    const captions = captionCandidates.filter(caption => {
        const verticalOk = caption.need === 'top'
            ? plot.yMax > 0 && zeroY - caption.y > 8
            : plot.yMin < 0 && caption.y - zeroY > 14;
        const horizontalOk = caption.side === 'left'
            ? medianX - caption.x > textWidth(caption.text) + 8
            : caption.x - medianX > textWidth(caption.text) + 8;
        return verticalOk && horizontalOk;
    });

    return <div className="predictive-scatter">
        <div className="predictive-scatter-toolbar">
            <div className="predictive-scatter-lead">
                <div className="predictive-scatter-summary">Showing {points.length} {points.length === 1 ? 'pair' : 'pairs'} · {plottedValidated} validated · {plottedExploratory} exploratory</div>
                <button type="button" className="predictive-kpi-inspect-btn predictive-scatter-explain-btn" onClick={() => setShowExplainer(true)}>Explain this chart ⓘ</button>
            </div>
            <div className="predictive-scatter-controls">
                <div className="predictive-scatter-growth-mode">
                    <span>Monthly change</span>
                    <GrowthDisplayToggle value={growthDisplay} onChange={onToggleGrowthDisplay} />
                </div>
                {canColorByProduct && <div className="rd-segmented predictive-scatter-color-toggle" role="group" aria-label="Scatter plot color by">
                    <span>Color by</span>
                    <button type="button" className={effectiveColorBy === 'accuracy' ? 'active' : ''} aria-pressed={effectiveColorBy === 'accuracy'} onClick={() => setColorBy('accuracy')}>Accuracy</button>
                    <button type="button" className={effectiveColorBy === 'product' ? 'active' : ''} aria-pressed={effectiveColorBy === 'product'} onClick={() => setColorBy('product')}>Product category</button>
                </div>}
                <label className="predictive-scatter-log-control" title={canLog ? 'Re-space the left-to-right axis so small and large forecasts are both easy to see.' : 'Not available: every plotted forecast must be greater than zero.'}>
                    <input type="checkbox" checked={effectiveLogScale} disabled={!canLog} onChange={event => setLogScale(event.target.checked)} />
                    Spread out small values
                </label>
            </div>
        </div>
        {!hasPoints ? <p className="predictive-scatter-empty">Not enough pairs with forecast and growth values to draw the plot.</p> : <>
            <div className="predictive-scatter-chart" ref={chartRef} style={{ height: `${height}px` }}>
                <svg className="predictive-scatter-svg" viewBox={`0 0 ${plot.width} ${plot.height}`} role="group"
                    aria-label={`Scatter plot of forecast per month versus ${growthDisplay === 'value' ? 'monthly change' : 'growth'}, colored by ${effectiveColorBy === 'accuracy' ? 'forecast accuracy' : 'product category'}, ${points.length} pairs`}>
                    {plot.yTicks.map(tick => {
                        const y = plot.yScale(tick);
                        return <g key={`y-${tick}`} aria-hidden="true">
                            <line x1={plot.left} x2={plot.right} y1={y} y2={y} className={tick === 0 ? 'predictive-scatter-zero-line' : 'predictive-scatter-grid-line'} />
                            <text x={plot.left - 9} y={y + 3} textAnchor="end" className="predictive-scatter-tick">{growthDisplay === 'value' ? compactNumber(tick, { currency: target === 'revenue', signed: true }) : `${compactNumber(tick, { signed: true })}%`}</text>
                        </g>;
                    })}
                    {plot.xTicks.map(tick => {
                        const x = plot.xScale(tick);
                        return <g key={`x-${tick}`} aria-hidden="true">
                            <line x1={x} x2={x} y1={plot.top} y2={plot.bottom} className="predictive-scatter-grid-line vertical" />
                            <text x={x} y={plot.bottom + 19} textAnchor="middle" className="predictive-scatter-tick">{compactNumber(tick, { currency: target === 'revenue' })}</text>
                        </g>;
                    })}
                    <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} className="predictive-scatter-axis" />
                    <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} className="predictive-scatter-axis" />
                    {captions.map(caption => <text key={caption.text} x={caption.x} y={caption.y} textAnchor={caption.anchor} className="predictive-scatter-quadrant" aria-hidden="true">{caption.text}</text>)}
                    {plot.noGrowth && <text x={plot.noGrowth.x} y={plot.noGrowth.y} textAnchor={plot.noGrowth.anchor} className="predictive-scatter-line-label">No growth</text>}
                    {plot.medianForecast != null && <>
                        <line x1={medianX} x2={medianX} y1={plot.top} y2={plot.bottom} className="predictive-scatter-median-line" />
                        {plot.typicalLabel && <text x={plot.typicalLabel.x} y={plot.typicalLabel.y} textAnchor={plot.typicalLabel.anchor} className="predictive-scatter-line-label">Typical forecast</text>}
                    </>}
                    <text x={(plot.left + plot.right) / 2} y={plot.height - 10} textAnchor="middle" className="predictive-scatter-axis-label">{axisXLabel}</text>
                    <text transform={`translate(15 ${(plot.top + plot.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="predictive-scatter-axis-label">{axisYLabel}</text>
                    {drawPoints.map(point => {
                        const label = labelByKey.get(point.key);
                        const isHovered = tooltipKey === point.key;
                        const radius = isHovered ? 7 : 5;
                        const isHighlighted = highlightedKey === point.row.key;
                        return <g key={point.key} className={`predictive-scatter-point${point.edge ? ' edge' : ''}${isHighlighted ? ' highlighted' : ''}`}>
                            {isHighlighted && <circle cx={point.plotX} cy={point.plotY} r="10" className="predictive-scatter-highlight-ring" aria-hidden="true" />}
                            {point.edge
                                ? <path d={markerPath(point, plot)} fill={point.color} fillOpacity=".9" stroke={point.color} strokeWidth="1.5" {...interactionProps(point)} />
                                : <circle cx={point.plotX} cy={point.plotY} r={radius} fill={point.accuracy.validated ? point.color : 'white'} fillOpacity={point.accuracy.validated ? '.82' : '1'} stroke={point.color} strokeWidth={point.accuracy.validated ? '1.3' : '2.5'} {...interactionProps(point)} />}
                            {label && <text x={label.x} y={label.y} textAnchor={label.anchor} className="predictive-scatter-point-label" aria-hidden="true">{label.text}</text>}
                        </g>;
                    })}
                </svg>
                {tooltipPoint && <div className="predictive-scatter-tooltip" role="tooltip" style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px`, width: `${tooltipWidth}px` }}>
                    <strong>{tooltipPoint.row.province}{tooltipPoint.row.region ? ` (${tooltipPoint.row.region})` : ''} · {tooltipPoint.row.category}</strong>
                    <span>Forecast per month: {formatValue(tooltipPoint.x, target)}</span>
                    <span>{growthDisplay === 'value' ? 'Expected monthly change' : 'Expected growth'}: {formatGrowth(tooltipPoint.y)}</span>
                    <span>Forecast accuracy: {accuracyText(tooltipPoint.accuracy)}</span>
                    <span>Status: {EVIDENCE_TEXT[tooltipPoint.accuracy.evidence] || tooltipPoint.accuracy.evidenceLabel} · {tooltipPoint.row.model || 'Model unavailable'}</span>
                </div>}
            </div>
            <div className="predictive-scatter-legend" aria-label={effectiveColorBy === 'accuracy' ? 'Forecast accuracy legend' : 'Product category legend'}>
                {effectiveColorBy === 'accuracy'
                    ? ACCURACY_LEGEND.map(item => <span key={item.tone}><i style={{ color: ACCURACY_COLORS[item.tone] }} />{item.text}</span>)
                    : categories.map(category => <span key={category}><i style={{ color: categorySeriesColor(category, categories) }} />{category}</span>)}
                <span className="predictive-scatter-legend-note"><i className="filled" />Solid = tested on past sales</span>
                <span className="predictive-scatter-legend-note"><i className="ring" />Ring = early estimate</span>
                {beyondAxis > 0 && <span className="predictive-scatter-legend-note"><b aria-hidden="true">▲</b>Off the chart, hover for the exact value</span>}
            </div>
        </>}

        <div className="predictive-scatter-notes">
            <span>{points.length} of {rows.length} pairs plotted{plot.omitted > 0 ? ` · ${plot.omitted} not plotted (no growth or forecast value)` : ''}</span>
            {beyondAxis > 0 && <span>{beyondAxis} {beyondAxis === 1 ? 'point' : 'points'} beyond the axis range {beyondAxis === 1 ? 'is' : 'are'} shown at the edge.</span>}
            {effectiveLogScale && <span>Left-to-right spacing is stretched so small forecasts are easier to see.</span>}
        </div>

        <p className="predictive-scatter-howto">Each dot is one province and product. <strong>Further right</strong> = bigger monthly forecast, <strong>higher up</strong> = {growthDisplay === 'value' ? 'larger monthly increase' : 'growing faster'}. <strong>Solid dots</strong> were tested on past sales; <strong>rings</strong> are early estimates.</p>

        {showExplainer && <ForecastScatterExplainer insights={insights} target={target} growthDisplay={growthDisplay} formatValue={formatValue} formatPercent={formatPercent} showSpreadHint={canLog} onClose={closeExplainer} />}
    </div>;
}
