export default function GrowthDisplayToggle({ value, onChange, className = '' }) {
    const nextValue = value === 'value' ? 'percent' : 'value';
    const nextLabel = nextValue === 'value' ? 'Amt' : '%';
    const nextDescription = nextValue === 'value' ? 'amount' : 'percentage';

    return (
        <button
            type="button"
            className={`predictive-growth-display-button ${className}`.trim()}
            aria-label={`Switch to ${nextDescription} growth`}
            title={`Switch to ${nextDescription} growth`}
            onClick={() => onChange(nextValue)}
        >
            {nextLabel}
        </button>
    );
}
