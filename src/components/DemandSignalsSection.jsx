import { getDemandSignals } from '../data/demandSignals';

const formatDemand = (value, target) => value == null || !Number.isFinite(Number(value))
    ? 'N/A'
    : new Intl.NumberFormat('en-PH', target === 'revenue'
        ? { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }
        : { maximumFractionDigits: 2 }).format(Number(value));

const formatGrowth = value => value == null || !Number.isFinite(Number(value))
    ? 'N/A'
    : `${Number(value) > 0 ? '+' : ''}${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(Number(value))}%`;
const HISTORICAL_BASELINE_EXPLANATION = 'Historical monthly baseline calculated from up to the latest 12 eligible model-series observations.';

function SignalCard({ row, target, horizon, onSelect }) {
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
            <span>{row.benchmarkResult}</span>
        </div>
        {row.smallBaselineFlag && <p className="demand-signal-small-baseline" role="note">Large growth percentage may be amplified by a very small historical baseline.</p>}
    </>;

    if (row.source === 'pair' && onSelect) {
        return <button type="button" className="predictive-signal demand-signal-card" onClick={() => onSelect(row)}>{content}</button>;
    }
    return <article className="predictive-signal demand-signal-card">{content}</article>;
}

function SignalGroup({ title, description, rows, target, horizon, onSelect, emptyText }) {
    return <div className="demand-signal-group">
        <div className="demand-signal-group-heading">
            <h3>{title}</h3>
            <p>{description}</p>
        </div>
        {rows.length
            ? <div className="predictive-signal-grid">{rows.map(row => <SignalCard key={row.signalKey} row={row} target={target} horizon={horizon} onSelect={onSelect} />)}</div>
            : <p className="demand-signal-group-empty">{emptyText}</p>}
    </div>;
}

export default function DemandSignalsSection({ id = 'demand-signals', data, target, horizon, onSelect, className = '', loading = false, error = '' }) {
    const signals = getDemandSignals(data);
    const locationSignals = signals.source === 'pair';
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
            <span className="rd-tag">{loading ? 'Loading' : `${signals.total} signals`}</span>
        </div>
        {signals.total ? <div className="demand-signal-groups">
            <SignalGroup title="Validated Growth Opportunities" description="Positive growth that beats the existing benchmark." rows={signals.validatedGrowth} target={target} horizon={horizon} onSelect={onSelect} emptyText="No validated positive-growth forecasts in this scope." />
            <SignalGroup title="Exploratory Growth Signals" description="Positive growth with limited history or results that do not beat the benchmark." rows={signals.exploratoryGrowth} target={target} horizon={horizon} onSelect={onSelect} emptyText="No exploratory positive-growth forecasts in this scope." />
            <SignalGroup title="Potential Demand Declines" description="Negative growth that may indicate a demand risk." rows={signals.declines} target={target} horizon={horizon} onSelect={onSelect} emptyText="No meaningful negative-growth forecasts in this scope." />
        </div> : <p className="demand-signal-empty" role={error ? 'alert' : 'status'}>{emptyMessage}</p>}
    </section>;
}
