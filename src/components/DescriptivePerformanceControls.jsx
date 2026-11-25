const PERFORMANCE_VIEWS = [
    ["geography", "Geographic Performance"],
    ["heatmap", "Province \u00d7 Category Heatmap"]
];

const PERFORMANCE_METRICS = [
    ["revenue", "Revenue"],
    ["orders", "Order Count"],
    ["quantity", "Units Sold"]
];

export default function DescriptivePerformanceControls({
    view,
    onViewChange,
    metric,
    onMetricChange,
    showViews = true,
    showMetrics = true,
    className = ""
}) {
    return (
        <div className={`descriptive-performance-controls${className ? ` ${className}` : ""}`}>
            {showViews && (
                <div className="rd-segmented descriptive-performance-views" aria-label="Performance view">
                    {PERFORMANCE_VIEWS.map(([key, label]) => (
                        <button type="button" key={key} className={view === key ? "active" : ""} aria-pressed={view === key} onClick={() => onViewChange(key)}>{label}</button>
                    ))}
                </div>
            )}
            {showMetrics && (
                <div className="rd-segmented descriptive-performance-metrics" aria-label="Sales metric">
                    {PERFORMANCE_METRICS.map(([key, label]) => (
                        <button type="button" key={key} className={metric === key ? "active" : ""} aria-pressed={metric === key} onClick={() => onMetricChange(key)}>{label}</button>
                    ))}
                </div>
            )}
        </div>
    );
}
