const CATEGORY_COLORS = [
    '#286be3', '#e88924', '#169b72', '#8a55c7', '#d44961',
    '#1398ac', '#a07912', '#d65d9b', '#60758f', '#65a33d'
];
const PREFERRED_CATEGORIES = ['Beauty', 'Fashion', 'Electronics'];

export function categorySeriesColor(category, availableCategories = []) {
    const preferredIndex = PREFERRED_CATEGORIES.indexOf(category);
    if (preferredIndex >= 0) return CATEGORY_COLORS[preferredIndex];
    const sortedCategories = [...new Set(availableCategories)].sort((a, b) => a.localeCompare(b));
    const extraIndex = sortedCategories.filter(name => !PREFERRED_CATEGORIES.includes(name)).indexOf(category);
    const index = extraIndex < 0 ? -1 : extraIndex + PREFERRED_CATEGORIES.length;
    if (index >= 0 && index < CATEGORY_COLORS.length) return CATEGORY_COLORS[index];
    if (index >= CATEGORY_COLORS.length) return `hsl(${Math.round(((index - CATEGORY_COLORS.length + 1) * 137.508 + 24) % 360)} 66% 42%)`;
    let hash = 0;
    for (const character of String(category || '')) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 66% 42%)`;
}
