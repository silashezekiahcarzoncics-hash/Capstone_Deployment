import { money } from "../hooks/useAnalytics";

const METRIC_LABELS = {
    revenue: "Revenue",
    orders: "Order Count",
    quantity: "Units Sold"
};

function formatValue(metric, value) {
    return metric === "revenue"
        ? money(value)
        : Number(value).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function cellStyle(value, maxValue) {
    const intensity = maxValue > 0 ? Math.max(0, value) / maxValue : 0;
    return {
        backgroundColor: `rgba(49, 105, 184, ${0.1 + intensity * 0.76})`,
        color: intensity > 0.56 ? "#fff" : "#23446c"
    };
}

export default function ProvinceCategoryHeatmap({ heatmap, metric, onSelectCell }) {
    const metricLabel = METRIC_LABELS[metric] || metric;
    const hasData = heatmap.provinces.length > 0 && heatmap.categories.length > 0;

    if (!hasData) {
        return <div className="descriptive-empty-state">No province and category results match the current filters.</div>;
    }

    return (
        <div className="descriptive-heatmap">
            <div className="descriptive-heatmap-heading">
                <p>Top provinces and product categories ranked independently by {metricLabel.toLowerCase()}.</p>
                <div className="descriptive-heatmap-legend" aria-label={`${metricLabel} heatmap legend`}>
                    <div><span>Low</span><span>Medium</span><span>High</span></div>
                    <i aria-hidden="true" />
                </div>
            </div>
            <div className="descriptive-heatmap-scroll" role="region" aria-label="Province by product category heatmap" tabIndex="0">
                <table className="descriptive-heatmap-table">
                    <caption className="descriptive-visually-hidden">Top {heatmap.provinces.length} provinces by top {heatmap.categories.length} product categories, measured by {metricLabel}.</caption>
                    <thead>
                        <tr>
                            <th scope="col">Province</th>
                            {heatmap.categories.map((category, index) => (
                                <th scope="col" key={category.name} title={`Category rank ${index + 1}: ${category.name}`}>
                                    <span>{category.name}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {heatmap.provinces.map((province, rowIndex) => (
                            <tr key={`${province.region}/${province.name}`}>
                                <th scope="row" title={`Province rank ${rowIndex + 1}: ${province.name} · ${province.region}`}>
                                    <strong>{province.name}</strong><small>{province.region}</small>
                                </th>
                                {heatmap.categories.map((category, columnIndex) => {
                                    const value = heatmap.cells[rowIndex][columnIndex];
                                    if (value === null) {
                                        const unavailableLabel = `${province.name} · ${province.region}, ${category.name}, ${metricLabel}: unavailable`;
                                        return <td key={category.name}><span className="descriptive-heatmap-cell missing" title={unavailableLabel} aria-label={unavailableLabel}>—</span></td>;
                                    }
                                    const exactValue = formatValue(metric, value);
                                    const label = `${province.name} · ${province.region}, ${category.name}, ${metricLabel}: ${exactValue}`;
                                    return (
                                        <td key={category.name}>
                                            <button
                                                type="button"
                                                className="descriptive-heatmap-cell"
                                                style={cellStyle(value, heatmap.maxValue)}
                                                title={`${label}. Select to inspect this province and category.`}
                                                aria-label={label}
                                                onClick={() => onSelectCell?.(province, category)}
                                            >
                                                {exactValue}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="descriptive-chart-caption">Missing combinations are shown as unavailable. Select a cell to filter Descriptive Analytics to that province and product category.</p>
        </div>
    );
}
