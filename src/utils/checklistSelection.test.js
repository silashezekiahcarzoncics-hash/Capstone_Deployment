import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategoryValues, resolveDefaultCategories, recommendationFilters, matchesRecommendation, recommendationSelectionLabel } from './checklistSelection.js';
import { narrowScope } from './analyticsFilterScope.js';
const options = ['C', 'A', 'B', 'A'];
const rows = [
    { key:'1', category:'A', region:'R1', province:'Shared', opportunityScore:91, eligible:true, strategy:'EXPAND SELECTIVELY' },
    { key:'2', category:'B', region:'R2', province:'Shared', opportunityScore:87, eligible:true, strategy:'PILOT AND VALIDATE' },
    { key:'3', category:'C', region:'R1', province:'Other', opportunityScore:74, eligible:true, strategy:'SUSTAIN CORE DEMAND' },
    { key:'4', category:'A', region:'R2', province:'Shared', opportunityScore:50, eligible:false, strategy:'INSUFFICIENT EVIDENCE' }
];
const key = (region, province) => JSON.stringify([region, province]);
const visible = selection => rows.filter(row => matchesRecommendation(row, recommendationFilters(selection, ['A','B','C'])));

test('default selects all individual categories, sorted, deduplicated and constrained by global scope', () => {
    assert.deepEqual(defaultCategoryValues(options), ['A','B','C']);
    assert.deepEqual(defaultCategoryValues(options, {categories:['C','A']}), ['A','C']);
    assert.deepEqual(defaultCategoryValues(options, {categories:[]}), []);
    const result = resolveDefaultCategories({categories:[], defaultCategories:true, compareBy:'category'}, defaultCategoryValues(options));
    assert.deepEqual(result, {categories:['A','B','C'], compareBy:'category'});
    assert.deepEqual(narrowScope({categories:null}, result).categories, ['A','B','C']);
});
test('explicit aggregate and custom selections are not silently overwritten', () => {
    for (const categories of [[], ['B'], ['A','C']]) {
        const selection = {categories};
        assert.equal(resolveDefaultCategories(selection, options), selection);
    }
    const pending = {categories:[], defaultCategories:true};
    assert.equal(resolveDefaultCategories(pending, []), pending);
});
test('predictive one-category default uses the correct single-category request', () => {
    assert.deepEqual(resolveDefaultCategories({category:'', categories:[], defaultCategories:true}, ['A'], {forecast:true}), {category:'A',categories:['A']});
    assert.deepEqual(resolveDefaultCategories({category:'', categories:[], defaultCategories:true}, ['A','B'], {forecast:true}), {category:'',categories:['A','B']});
});
test('recommended actions default checks all categories available in its own results', () => {
    const selection = {defaultCategories:true, categories:[], provinceKeys:[]};
    assert.deepEqual(recommendationFilters(selection, ['A','C']).categories, ['A','C']);
    assert.deepEqual(visible(selection), rows);
    assert.equal(recommendationSelectionLabel(['A','B','C']), '3 selected categories');
});
test('category OR province OR with an intersection between the two dimensions', () => {
    assert.deepEqual(visible({categories:['A','B'],provinceKeys:[key('R2','Shared'),key('R1','Other')]}).map(row=>row.key), ['2','4']);
    assert.deepEqual(visible({categories:['C'],provinceKeys:[key('R2','Shared')]}), []);
    assert.deepEqual(visible({categories:[],provinceKeys:[]}), rows);
});
test('same province name in different regions is not conflated', () => {
    assert.deepEqual(visible({categories:['A'],provinceKeys:[key('R1','Shared')]}).map(row=>row.key), ['1']);
    assert.deepEqual(visible({categories:['A'],provinceKeys:[key('R2','Shared')]}).map(row=>row.key), ['4']);
});
test('local filtering preserves global opportunity scores, eligibility, strategy and row references', () => {
    const before = structuredClone(rows);
    const selected = visible({categories:['B','C'],provinceKeys:[]});
    assert.equal(selected[0],rows[1]);
    assert.equal(selected[1],rows[2]);
    assert.deepEqual(selected.map(row=>row.opportunityScore),[87,74]);
    assert.deepEqual(rows,before);
});
test('legacy single selection and pair selection remain compatible', () => {
    assert.deepEqual(visible({category:'A',provinceKey:key('R1','Shared'),pairKey:'1'}),[rows[0]]);
    assert.deepEqual(visible({categories:['A','B'],provinceKeys:[key('R2','Shared')],pairKey:'2'}).map(row=>row.key), ['2','4']);
});
