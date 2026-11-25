import { useId, useState } from 'react';
import { getDemandSignals } from '../data/demandSignals';

const formatDemand = (value, target) => {
    if (value == null || !Number.isFinite(Number(value))) return 'N/A';
    const formatted = new Intl.NumberFormat('en-PH', target === 'revenue'
        ? { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }
        : { maximumFractionDigits: 2 }).format(Number(value));
    if (target === 'revenue') return formatted;
    return `${formatted} ${target === 'orders' ? 'orders' : 'units'}`;
};

const formatGrowth = value => value == null || !Number.isFinite(Number(value))
    ? 'N/A'
    : `${Number(value) > 0 ? '+' : ''}${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(Number(value))}%`;
const HISTORICAL_BASELINE_EXPLANATION = 'Historical monthly baseline calculated from up to the latest 12 eligible model-series observations.';

function SignalCard({ row, target, horizon, onSelect, canSelect }) {
    const content = <>
        <div className="demand-signal-card-heading">
            <strong>{row.source === 'category' ? row.category : `${row.province} × ${row.category}`}</strong>
            <span className={`demand-signal-growth${Number(row.growth) < 0 ? ' negative' : ''}`}>{formatGrowth(row.growth)}</span>
        </div>
        <div className="demand-signal-card-meta">
            {row.source === 'pair' && <span>Province: {row.province}</span>}
            <span>Category: {row.category}</span>
            <span>Horizon: {horizon} months</span>
        </div>
        <div className="predictive-signal-metrics demand-signal-metrics">
            <span title={HISTORICAL_BASELINE_EXPLANATION}><b>Current / month</b>{formatDemand(row.currentDemand, target)}</span>
            <span><b>Forecast / month</b>{formatDemand(row.forecastDemand, target)}</span>
            <span className={Number(row.growth) < 0 ? 'negative' : 'positive'}><b>Projected growth</b>{formatGrowth(row.growth)}</span>
        </div>
        <div className="demand-signal-validation">
            <strong>{row.validationLabel}</strong>
        </div>
        {row.smallBaselineFlag && <p className="demand-signal-small-baseline" role="note">Large growth percentage may be amplified by a very small historical baseline.</p>}
    </>;

    if (onSelect && canSelect) {
        const actionLabel = row.source === 'category'
            ? `Locate the highest-ranked province forecast for ${row.category} in Forecast Overview`
            : `Locate ${row.province} and ${row.category} in Forecast Overview`;
        const accessibleLabel = row.source === 'category'
            ? `${actionLabel}. ${row.category}, ${formatGrowth(row.growth)} projected growth.`
            : `${actionLabel}. ${row.province}, ${row.category}, ${formatGrowth(row.growth)} projected growth.`;
        return <button type="button" className="predictive-signal demand-signal-card" onClick={() => onSelect(row)} title={actionLabel} aria-label={accessibleLabel}>{content}</button>;
    }
    return <article className="predictive-signal demand-signal-card">{content}</article>;
}

function SignalGroup({ title, description, rows, target, horizon, onSelect, canSelectSignal, emptyText }) {
    const [expanded, setExpanded] = useState(false);
    const gridId = useId();
    const visibleRows = expanded ? rows : rows.slice(0, 9);
    const emptySlots = expanded ? 0 : Math.max(0, 9 - visibleRows.length);

    return <div className="demand-signal-group">
        <div className="demand-signal-group-heading">
            <h3>{title}</h3>
            <p>{description}</p>
        </div>
        {!rows.length && <p className="demand-signal-group-empty">{emptyText}</p>}
        <div id={gridId} className="predictive-signal-grid demand-signal-grid">
            {visibleRows.map(row => <SignalCard key={row.signalKey} row={row} target={target} horizon={horizon} onSelect={onSelect} canSelect={canSelectSignal(row)} />)}
            {Array.from({ length: emptySlots }, (_, index) => <div key={`empty-${index}`} className="demand-signal-grid-slot" aria-hidden="true" />)}
        </div>
        {rows.length > 9 && <button type="button" className="demand-signal-toggle" aria-expanded={expanded} aria-controls={gridId} onClick={() => setExpanded(value => !value)}>
            {expanded ? 'Show less' : `Show more (${rows.length - 9})`}
        </button>}
    </div>;
}

export default function DemandSignalsSection({ id = 'demand-signals', data, target, horizon, onSelect, className = '', loading = false, error = '', metricSelector = null }) {
    const signals = getDemandSignals(data);
    const locationSignals = signals.source === 'pair';
    const canSelectSignal = row => row.source === 'pair' || (data?.overview || []).some(pair => pair.category === row.category);
    const emptyMessage = loading
        ? 'Loading demand signals…'
        : error || (signals.source === 'category'
            ? 'No province × category forecast qualifies. No eligible category-level forecasts with meaningful growth or decline are available for this scope and forecast mode.'
            : 'No forecasts show meaningful growth or decline. Stable forecasts are not listed as demand signals.');

    return <section id={id} className={`rd-card predictive-signals ${className}`.trim()} aria-labelledby={`${id}-title`}>
        <div className="rd-card-head between">
            <div>
                <h2 id={`${id}-title`}>Notable Demand Signals</h2>
                <p>{locationSignals
                    ? 'Available province × category forecasts, grouped by growth direction and validation.'
                    : 'Showing available product forecasts because no province × category forecast qualifies.'}</p>
            </div>
            <div className="demand-signal-header-actions">
                {metricSelector}
                <span className="rd-tag">{loading ? 'Loading' : `${signals.total} signals`}</span>
            </div>
        </div>
        {loading || error ? <p className="demand-signal-empty" role={error ? 'alert' : 'status'}>{emptyMessage}</p> : <div className="demand-signal-groups">
            <SignalGroup title="Validated Growth Opportunities" description="Positive growth that beats the existing benchmark." rows={signals.validatedGrowth} target={target} horizon={horizon} onSelect={onSelect} canSelectSignal={canSelectSignal} emptyText="No validated positive-growth forecasts in this scope." />
            <SignalGroup title="Exploratory Growth Signals" description="Positive growth with limited history or results that do not beat the benchmark." rows={signals.exploratoryGrowth} target={target} horizon={horizon} onSelect={onSelect} canSelectSignal={canSelectSignal} emptyText="No exploratory positive-growth forecasts in this scope." />
            <SignalGroup title="Potential Demand Declines" description="Negative growth that may indicate a demand risk." rows={signals.declines} target={target} horizon={horizon} onSelect={onSelect} canSelectSignal={canSelectSignal} emptyText="No meaningful negative-growth forecasts in this scope." />
        </div>}
    </section>;
}
