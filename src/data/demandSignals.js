const hasFiniteValue = value => value != null && Number.isFinite(Number(value));
const isAvailable = row => row?.status === 'available'
    && hasFiniteValue(row.growth)
    && hasFiniteValue(row.forecastDemand)
    && hasFiniteValue(row.currentDemand);

const isMeaningfulGrowth = row => row.trend === 'Increasing' || row.trend === 'Decreasing'
    || (row.trend !== 'Stable' && Math.abs(Number(row.growth)) >= 2);

const beatsBenchmark = row => row.forecastStatus === 'Available — Validated'
    || row.validation?.beatsBaseline === true;

const isValidated = row => beatsBenchmark(row)
    && row.reliability !== 'exploratory'
    && row.forecastStatus !== 'Available — Exploratory';

const prepareSignal = (row, source) => ({
    ...row,
    source,
    signalKey: source === 'category' ? `category:${row.category}` : `pair:${row.key}`,
    benchmarkResult: row.validation?.beatsBaseline === true || row.forecastStatus === 'Available — Validated'
        ? 'Beats benchmark'
        : row.validation?.beatsBaseline === false || row.reliability === 'backtested_weak'
            ? 'Does not beat benchmark'
            : 'Benchmark not established',
    validationLabel: isValidated(row)
        ? 'Validated · beats benchmark'
        : row.validation?.beatsBaseline === false || row.reliability === 'backtested_weak'
            ? 'Exploratory · does not beat benchmark'
            : 'Exploratory · limited validation'
});

const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function getDemandSignals(data) {
    const pairCandidates = (data?.overview || [])
        .filter(isAvailable)
        .filter(isMeaningfulGrowth)
        .map(row => prepareSignal(row, 'pair'));
    const source = pairCandidates.length ? 'pair' : 'category';
    const candidates = source === 'pair'
        ? pairCandidates
        : (data?.categoryRows || [])
            .filter(isAvailable)
            .filter(isMeaningfulGrowth)
            .map(row => prepareSignal(row, 'category'));

    const typicalBaseline = median(candidates.map(row => Number(row.currentDemand)).filter(value => value > 0));
    const flagged = candidates.map(row => ({
        ...row,
        smallBaselineFlag: Number(row.growth) >= 100
            && typicalBaseline != null
            && Number(row.currentDemand) < typicalBaseline * 0.1
    }));
    const positive = flagged.filter(row => Number(row.growth) > 0);
    const declines = flagged.filter(row => Number(row.growth) < 0);
    const byGrowth = (left, right) => Number(right.growth) - Number(left.growth);

    return {
        source,
        total: flagged.length,
        validatedGrowth: positive.filter(isValidated).sort(byGrowth),
        exploratoryGrowth: positive.filter(row => !isValidated(row)).sort(byGrowth),
        declines: declines.sort((left, right) => Number(left.growth) - Number(right.growth))
    };
}
