import { useEffect, useRef } from 'react';
import { formatErrorPercent } from '../utils/forecastAccuracy';
import { SCATTER_ACCURACY_COLORS as COLORS } from '../utils/forecastScatter';

const percentWords = (value, formatPercent) => String(formatPercent(Math.abs(value))).replace(/^[+-]/, '');

function Swatch({ tone, ring = false }) {
    return <i className={`predictive-scatter-swatch${ring ? ' ring' : ''}`} style={{ color: COLORS[tone] || '#718097' }} aria-hidden="true" />;
}

export default function ForecastScatterExplainer({ insights, target, growthDisplay = 'percent', formatValue, formatPercent, showSpreadHint, onClose }) {
    const closeRef = useRef(null);
    const sales = target === 'revenue' ? 'sales' : target === 'orders' ? 'orders' : 'units sold';

    useEffect(() => {
        const previous = document.activeElement;
        closeRef.current?.focus();
        const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            if (previous && typeof previous.focus === 'function') previous.focus();
        };
    }, [onClose]);

    const describe = item => {
        const amount = growthDisplay === 'value'
            ? `${formatValue(Math.abs(item.growth), target)} per month`
            : percentWords(item.growth, formatPercent);
        const direction = item.growth > 0 ? `expected to ${growthDisplay === 'value' ? 'increase by' : 'grow about'} ${amount}`
            : item.growth < 0 ? `expected to ${growthDisplay === 'value' ? 'decrease by' : 'shrink about'} ${amount}` : 'expected to stay flat';
        const track = item.mape == null ? 'no accuracy check yet' : `past forecasts were off by about ${formatErrorPercent(item.mape)} (${item.tierName.toLowerCase()})`;
        return <li key={item.key}><strong>{item.name}</strong> — about {formatValue(item.forecast, target)} a month, {direction}; {track}.</li>;
    };

    const { total, validated, exploratory, growing, shrinking, biggest, bestBets, watchList, coolingBig } = insights;

    return (
        <div className="prescriptive-lightbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="prescriptive-lightbox predictive-scatter-explainer" role="dialog" aria-modal="true" aria-labelledby="scatter-explainer-title">
                <div className="prescriptive-lightbox-head">
                    <div>
                        <span>FORECAST OVERVIEW · SCATTER PLOT</span>
                        <h2 id="scatter-explainer-title">How to read this chart</h2>
                    </div>
                    <button type="button" aria-label="Close explanation" onClick={onClose} ref={closeRef}>×</button>
                </div>

                <div className="predictive-scatter-explainer-body">
                    <section>
                        <p>Each dot is <strong>one province and one product together</strong>. The chart shows, at a glance, which of them are expected to sell the most, which are growing, and how far you can trust each forecast.</p>
                    </section>

                    <section>
                        <h3>The two directions</h3>
                        <ul>
                            <li><strong>Left to right:</strong> the further right, the more {sales} are expected <em>each month</em>.</li>
                            <li><strong>Bottom to top:</strong> {growthDisplay === 'value' ? `the higher the dot, the larger the expected monthly increase in ${sales}. Dots below the no-growth line are expected to decline.` : `the higher the dot, the faster ${sales} are expected to grow compared with a typical recent month (the last 12 months). Dots below the no-growth line are expected to slow down.`}</li>
                            <li><strong>Dashed vertical line:</strong> the typical (middle) forecast. Half of the dots are on each side of it.</li>
                        </ul>
                    </section>

                    <section>
                        <h3>What do the colors mean?</h3>
                        <p>With <em>Color by: Accuracy</em>, the color shows how well this forecast would have done on months that already happened:</p>
                        <ul className="predictive-scatter-explainer-key">
                            <li><Swatch tone="very-close" /><Swatch tone="good" /> <span><strong>Green</strong> — very close or good. Past forecasts were near what really sold.</span></li>
                            <li><Swatch tone="reasonable" /> <span><strong>Amber</strong> — reasonable. Useful, but expect some misses.</span></li>
                            <li><Swatch tone="high-error" /> <span><strong>Red</strong> — high error. Past forecasts often missed by a lot; use as a rough guide only.</span></li>
                            <li><Swatch tone="unavailable" /> <span><strong>Gray</strong> — not enough history to check accuracy.</span></li>
                        </ul>
                    </section>

                    <section>
                        <h3>Solid dot or hollow ring?</h3>
                        <ul className="predictive-scatter-explainer-key">
                            <li><Swatch tone="good" /> <span><strong>Solid dot (validated)</strong> — the forecast was tested on past months and did better than a simple guess (repeating last month’s {sales}).</span></li>
                            <li><Swatch tone="good" ring /> <span><strong>Hollow ring (exploratory)</strong> — a forecast exists, but it was not shown to beat that simple guess, or there is little history. Treat it as an early estimate.</span></li>
                        </ul>
                    </section>

                    <section>
                        <h3>Where should I look first?</h3>
                        <ul>
                            <li><strong>Top-right, solid and green:</strong> big, growing, and the forecast has a good track record. The strongest candidates for stock planning or promotions.</li>
                            <li><strong>Top-right, but a ring or red:</strong> big and growing, but less certain. Worth a closer look before acting.</li>
                            <li><strong>Bottom-right:</strong> big sellers expected to cool down. Watch these so you are not left with too much stock.</li>
                            <li><strong>Left side:</strong> smaller sellers. Good for spotting niche growth, but they matter less for overall planning.</li>
                            <li><strong>▲ or ▼ at the edge:</strong> growth so large or small that it would stretch the chart, so it is shown at the edge. Hover to see the exact number.</li>
                        </ul>
                    </section>

                    <section className="predictive-scatter-explainer-live">
                        <h3>What it says about your data right now</h3>
                        {total === 0 ? <p>There are no pairs with both a forecast and a growth value to describe.</p> : <>
                            <ul>
                                <li><strong>{total}</strong> {total === 1 ? 'pair is' : 'pairs are'} shown: <strong>{validated}</strong> tested on past {sales} (validated) and <strong>{exploratory}</strong> early {exploratory === 1 ? 'estimate' : 'estimates'} (exploratory).</li>
                                <li><strong>{growing}</strong> {growing === 1 ? 'is' : 'are'} expected to grow and <strong>{shrinking}</strong> to shrink.</li>
                                {biggest && <li>Biggest forecast: <strong>{biggest.name}</strong>, about {formatValue(biggest.forecast, target)} a month ({biggest.growth > 0 ? 'growing' : biggest.growth < 0 ? 'shrinking' : 'flat'}; {biggest.mape == null ? 'accuracy not available' : `forecast accuracy ${biggest.tierName.toLowerCase()}`}).</li>}
                            </ul>
                            {bestBets.length > 0
                                ? <><h4>Big, growing and well tested</h4><ul>{bestBets.map(describe)}</ul></>
                                : <p><strong>Big, growing and well tested:</strong> none right now. No pair is above the typical forecast, growing, and backed by a good accuracy record.</p>}
                            {watchList.length > 0 && <><h4>Big and growing, but less certain</h4><ul>{watchList.map(describe)}</ul></>}
                            {coolingBig.length > 0 && <><h4>Big but expected to shrink</h4><ul>{coolingBig.map(describe)}</ul></>}
                        </>}
                        <p className="predictive-scatter-explainer-foot">These notes follow your current filters and settings, and update when you change them.</p>
                    </section>

                    <section>
                        <h3>Good to know</h3>
                        <ul>
                            <li><strong>Forecast accuracy</strong> is a track record: how far off past forecasts were on average (lower is better). It is not a promise about the future.</li>
                            <li><strong>Growth</strong> {growthDisplay === 'value' ? `shows the forecast minus current monthly demand for ${sales}. The percentage option compares the forecast with a typical recent month; it is not a year-over-year figure.` : `compares the forecast with a typical month from the last 12 months of ${sales}. It is not a year-over-year figure.`}</li>
                            {showSpreadHint && <li><strong>Spread out small values</strong> re-spaces the left-to-right axis so small and large sellers are both easy to see. The gaps between tick marks are then uneven on purpose.</li>}
                            <li><strong>Click a dot</strong> to load that province and product into the forecast chart above.</li>
                        </ul>
                    </section>
                </div>

                <div className="prescriptive-lightbox-actions">
                    <button type="button" onClick={onClose}>Got it</button>
                </div>
            </section>
        </div>
    );
}
