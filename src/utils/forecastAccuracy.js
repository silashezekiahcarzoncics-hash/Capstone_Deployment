// Shared forecast-accuracy wording and thresholds.
// The first three exports are moved verbatim from PrescriptiveAnalytics.jsx so that
// Prescriptive, Predictive and Executive Overview always describe accuracy the same way.

export const FORECAST_ACCURACY_GUIDE = 'Average forecast error across past test months with nonzero actual sales; this is not a percent-correct score, and lower is better. Rough guide: below 10% very close; 10% to under 20% good; 20% to under 50% reasonable; 50% or more high error. These are general guidelines, not universal cutoffs.';

export const FORECAST_STATUS_GUIDE = 'Available — Validated means there was enough qualifying history to test the forecast and it beat the benchmark of repeating last month’s sales. Available — Exploratory means a forecast is available, but it did not meet that validation standard; treat it as an initial estimate.';

export function forecastAccuracyTone(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'unavailable';
    if (Number(value) < 10) return 'very-close';
    if (Number(value) < 20) return 'good';
    if (Number(value) < 50) return 'reasonable';
    return 'high-error';
}

export function forecastAccuracyLabel(value) {
    const error = Number(value);
    if (error < 10) return 'Very close: below 10% average error.';
    if (error < 20) return 'Good: 10% to under 20% average error.';
    if (error < 50) return 'Reasonable: 20% to under 50% average error.';
    return 'High error: 50% or more average error.';
}

// ---- Added for Predictive Analytics / Executive Overview ----

const TIER_NAMES = {
    'very-close': 'Very close',
    good: 'Good',
    reasonable: 'Reasonable',
    'high-error': 'High error',
    unavailable: 'Not available'
};

export const forecastAccuracyName = value => TIER_NAMES[forecastAccuracyTone(value)];

const oneDecimal = value => new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(value);

// Unsigned percent with one decimal, same rounding as the Prescriptive accuracy column.
export const formatErrorPercent = value => value == null || !Number.isFinite(Number(value)) ? 'N/A' : `${oneDecimal(value)}%`;

const VALIDATED = 'Available — Validated';
const EXPLORATORY = 'Available — Exploratory';

// 'validated' | 'exploratory' | 'unavailable' — same rule the Forecast Overview table uses.
export function forecastEvidence(forecastStatus, reliability) {
    const label = forecastStatus || (reliability === 'backtested' ? VALIDATED : EXPLORATORY);
    if (label === VALIDATED) return 'validated';
    if (label === EXPLORATORY) return 'exploratory';
    return 'unavailable';
}

const EVIDENCE_LABELS = { validated: 'Validated', exploratory: 'Exploratory', unavailable: 'Unavailable' };

// Turns a series' validation object into one plain-language verdict.
//   validation: the `validation` object returned by the predictive API (or null)
//   status: the series' `status` ('available' | 'insufficient')
export function forecastAccuracyVerdict({ validation = null, forecastStatus = null, reliability = null, status = 'available' } = {}) {
    const mape = validation?.mape ?? null;
    const hasMape = mape != null && Number.isFinite(Number(mape));
    const evidence = status === 'available' ? forecastEvidence(forecastStatus, reliability) : 'unavailable';
    const tone = forecastAccuracyTone(hasMape ? mape : null);
    const tierName = TIER_NAMES[tone];
    const beats = validation?.beatsBaseline ?? null;
    const improvement = validation?.improvementVsBaseline ?? null;

    let sentence;
    if (evidence === 'unavailable') {
        sentence = 'No forecast is available for this selection, so accuracy cannot be checked.';
    } else if (!validation) {
        sentence = 'There is not enough past sales history to test accuracy yet. Treat this forecast as an early estimate.';
    } else if (!hasMape) {
        sentence = 'The forecast was tested on past months, but too few of them had sales to calculate a percentage error.';
    } else {
        const base = `On past test months, the forecast differed from actual sales by about ${oneDecimal(mape)}% on average (${tierName.toLowerCase()}).`;
        const compare = beats == null
            ? ''
            : beats
                ? ` It was more accurate than simply repeating last month’s sales${improvement != null ? ` (${oneDecimal(Math.abs(improvement))}% lower error)` : ''}.`
                : ' Simply repeating last month’s sales was as accurate or more accurate.';
        const caution = evidence === 'exploratory'
            ? ' Because of this, treat the forecast as an initial estimate rather than a validated one.'
            : '';
        sentence = `${base}${compare}${caution}`;
    }

    return {
        tone,
        tierName,
        mape: hasMape ? Number(mape) : null,
        beats,
        evidence,
        evidenceLabel: EVIDENCE_LABELS[evidence],
        headline: hasMape ? `Avg. error ${oneDecimal(mape)}% · ${tierName}` : 'Accuracy not available',
        sentence
    };
}
