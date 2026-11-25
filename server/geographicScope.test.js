import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRows, prepareAnalyticsSnapshot } from './analytics.js';
import { predictiveAnalytics, prescriptiveAnalytics, forecastScopeOptions } from './forecasting.js';
import { cachedPredictive, forecastComparisons } from './forecastComparisons.js';
import { normalizeGeographicScope } from './geographicScope.js';
import { narrowScope } from '../src/utils/analyticsFilterScope.js';
import { geographicProvinceKey as key, scopedGeography, provinceOptions, explicitSelection, compactSelection, geographicScopeLabel, scopeCategoryOptions } from '../src/utils/geographicScope.js';
import { clearAnalyticsMemoryCache, fetchScopedAnalytics, getCachedScopedAnalytics, fetchPredictive, getCachedPredictive, fetchForecastComparisons, getCachedForecastComparisons, fetchPrescriptive, getCachedPrescriptive } from '../src/data/analyticsApi.js';

const geography = [{region:'North', provinces:['Same','N2']}, {region:'South', provinces:['Same','S2']}, {region:'East', provinces:['E1']}];
const allKeys = provinceOptions(geography).map(x=>x.value);
const N = key('North','Same'), S = key('South','Same'), E = key('East','E1'), N2 = key('North','N2'), S2 = key('South','S2');
const all = {period:'All Available Data', returns:'Include All', region:'All Regions', province:'All Provinces', categories:null};
function fixture(months=36) {
    const rows=[];
    for (let m=0;m<months;m++) {
        const month = new Date(Date.UTC(2022,m,1)).toISOString().slice(0,7);
        const date = new Date(Date.UTC(2022,m+1,0)).toISOString();
        for (const [i, geo] of geography.entries()) for (const [j, province] of geo.provinces.entries()) for (const [k, category] of ['A','B'].entries()) {
            for (let t=0;t<2;t++) {
                const amount = 100 + m * 3 + i * 20 + j * 5 + k * 2 + t;
                rows.push({ id:String(rows.length+1), order_id:`${month}:${i}:${j}:${t}`, order_creation_date:date, year_month:month,
                    region:geo.region,province,category,line_revenue:amount,quantity:10+i,net_quantity:10+i,
                    returned_quantity:0,return_refund_status:null,is_included_in_analysis:true,is_exact_duplicate:false });
            }
        }
    }
    return rows;
}
const rows=fixture();
const indexed=prepareAnalyticsSnapshot(structuredClone(rows));
const selected = {...all, regions:['South','North'], provinceKeys:[S,N]};
const expectedLegacy = {...all, provinceKeys:[N,S]};
const subsets = values => Array.from({length:2**values.length},(_,mask)=>values.filter((_,i)=>mask & (1<<i)));

test('all region/province checkboxes selected by default; compact all is unrestricted and empty is never all',()=>{
    assert.deepEqual(explicitSelection(null, allKeys), allKeys);
    assert.equal(compactSelection([...allKeys].reverse(),allKeys),null);
    assert.deepEqual(compactSelection([],allKeys),[]);
    assert.deepEqual(normalizeGeographicScope({...all,regions:null,provinceKeys:null}),all);
    assert.deepEqual(analyzeRows(indexed,all),analyzeRows(indexed,{...all,regions:['North','South','East'],provinceKeys:allKeys}));
});
test('province choices cascade across multiple regions and same-named provinces stay distinct',()=>{
    const options=provinceOptions(scopedGeography(geography,{regions:['North','South']}));
    assert.equal(options.length,4);
    assert.ok(options.some(x=>x.value===N));assert.ok(options.some(x=>x.value===S));
    assert.deepEqual(explicitSelection([N,S],provinceOptions(scopedGeography(geography,{regions:['South']})).map(x=>x.value)),[S]);
    assert.deepEqual(scopedGeography(geography,selected),[{region:'North',provinces:['Same']},{region:'South',provinces:['Same']}]);
    assert.match(geographicScopeLabel(selected),/2 regions selected · 2 provinces selected/);
});
test('all 256 region/province checklist subsets match independently filtered totals, both indexed and unindexed',()=>{
    for(const regions of subsets(['North','South','East'])) for(const provinceKeys of subsets(allKeys)) {
        const scope={...all,regions,provinceKeys};
        const expected=rows.filter(r=>regions.includes(r.region)&&provinceKeys.includes(key(r.region,r.province)));
        const actual=analyzeRows(indexed,scope);
        assert.deepEqual(actual,analyzeRows(rows,scope));
        assert.deepEqual(actual.summary,{revenue:expected.reduce((s,r)=>s+r.line_revenue,0),orders:new Set(expected.map(r=>r.order_id)).size,quantity:expected.reduce((s,r)=>s+r.net_quantity,0),rows:expected.length});
    }
});
test('region-only, province-only, explicit empty, unknown and legacy scalar scope intersect correctly',()=>{
    assert.deepEqual(analyzeRows(indexed,{...all,regions:['South']}),analyzeRows(indexed,{...all,region:'South'}));
    assert.deepEqual(analyzeRows(indexed,selected),analyzeRows(indexed,expectedLegacy));
    for(const scope of [{regions:[]},{provinceKeys:[]},{regions:['Missing']},{provinceKeys:[key('Missing','Same')]},{regions:['East'],provinceKeys:[N,S]},{region:'East',regions:['North']}]) assert.equal(analyzeRows(indexed,{...all,...scope}).summary.rows,0);
    assert.equal(analyzeRows(indexed,{...all,regions:['North','South'],province:'Same'}).summary.rows,36*2*2*2);
});
test('local filters cannot widen global geography, dates or product categories, including overlapping order IDs',()=>{
    const scope={...selected,categories:['A'],period:'Custom Range',start:'2023-01-01',end:'2023-12-31'};
    const actual=analyzeRows(indexed,scope,{descriptiveFilters:{categories:['A','B'],provinceKeys:[N,E]}});
    const expected=rows.filter(r=>r.region==='North'&&r.province==='Same'&&r.category==='A'&&r.year_month.startsWith('2023'));
    assert.equal(actual.summary.revenue,expected.reduce((s,r)=>s+r.line_revenue,0));
    assert.equal(actual.summary.orders,24);
    assert.deepEqual(narrowScope(scope,{categories:['B'],provinceKeys:[E]}).provinceKeys,[]);
    assert.equal(analyzeRows(indexed,narrowScope(scope,{categories:['B'],provinceKeys:[E]})).summary.rows,0);
    assert.equal(analyzeRows(indexed,selected,{descriptiveFilters:{provinceKeys:[N]}}).summary.orders,72);
});
test('forecast models, metrics and missing-month modes produce identical results for equivalent legacy and new geography',()=>{
    for(const target of ['revenue','orders','quantity']) for(const model of ['arima','prophet','random_forest','auto']) for(const mode of ['strict','confirmed_zero','intermittent']) {
        const a=predictiveAnalytics(indexed,selected,6,target,'','',model,mode);
        const b=predictiveAnalytics(indexed,expectedLegacy,6,target,'','',model,mode);
        assert.deepEqual({...a,filters:null},{...b,filters:null});
        assert.ok(a.options.provinces.every(p=>[N,S].includes(p.key)));
        assert.ok([...a.overview,...a.insufficient,...a.signals].every(p=>[N,S].includes(key(p.region,p.province))));
    }
});
test('forecast batch series respect the global region and province selection; no cross-region fallback',()=>{
    const opts={filters:selected,horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict'};
    const series=forecastComparisons(indexed,opts,[{category:'A',provinceKey:N},{category:'B',provinceKey:S},{category:'A',provinceKey:E},{category:'A',provinceKey:key('Wrong','Same')}]);
    assert.equal(series[0].error,undefined);assert.equal(series[1].error,undefined);
    assert.match(series[2].error,/outside/);assert.match(series[3].error,/outside/);
    const narrowed={...all,regions:['North']};
    assert.throws(()=>predictiveAnalytics(indexed,narrowed,6,'revenue','A',S,'arima','strict',true),/outside/);
});
test('prescriptive recommendations and scope-relative scoring equal equivalent province selection; no outside pairs',()=>{
    for(const target of ['revenue','orders','quantity']) for(const model of ['arima','prophet','random_forest','auto']) {
        const a=prescriptiveAnalytics(indexed,selected,6,target,model);
        const b=prescriptiveAnalytics(indexed,expectedLegacy,6,target,model);
        assert.deepEqual({...a,filters:null},{...b,filters:null});
        assert.ok(a.pairs.length>0);
        assert.ok(a.pairs.every(p=>[N,S].includes(key(p.region,p.province))));
    }
});
test('empty geographic intersections are safe in every analytics engine',()=>{
    const scope={...all,regions:['East'],provinceKeys:[N]};
    assert.equal(analyzeRows(indexed,scope).summary.rows,0);
    assert.equal(predictiveAnalytics(indexed,scope).options.totalPairs,0);
    assert.deepEqual(prescriptiveAnalytics(indexed,scope).pairs,[]);
});
test('geographic payload rejects malformed selections and canonicalizes duplicates, order and JSON whitespace',()=>{
    for(const scope of [{regions:'North'},{regions:[null]},{regions:[' ']},{provinceKeys:[1]},{provinceKeys:['Same']},{provinceKeys:['["North"]']},{provinceKeys:['["North",null]']}]) assert.throws(()=>analyzeRows(indexed,scope),/Invalid geographic scope/);
    assert.deepEqual(normalizeGeographicScope({regions:['South','North','North'],provinceKeys:['[ "North", "Same" ]',N,S]}),{regions:['North','South'],provinceKeys:[N,S]});
});
test('restricted area defaults expose categories present in that scope rather than invalid forecast categories',()=>{
    const sample=analyzeRows(rows.filter(r=>r.category==='A'),selected);
    sample.scope.categories=['A','B'];
    assert.deepEqual(scopeCategoryOptions(sample,selected),['A']);
    assert.deepEqual(scopeCategoryOptions(sample,all),['A','B']);
});
test('canonical checklist keys reuse all four API caches and isolate different geographic scopes',async()=>{
    const oldFetch=globalThis.fetch;let count=0;
    globalThis.fetch=async()=>{count++;return {ok:true,json:async()=>({series:[{chart:{}}],value:count})};};
    clearAnalyticsMemoryCache();
    try {
        const reordered={...selected,regions:['North','South','North'],provinceKeys:[N,S,S]};
        const distinct={...selected,provinceKeys:[N]};
        await fetchScopedAnalytics(selected); assert.ok(getCachedScopedAnalytics(reordered)); await fetchScopedAnalytics(reordered); assert.equal(count,1);
        await fetchScopedAnalytics(distinct);assert.equal(count,2);
        const options={scope:selected,horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict'};
        await fetchPredictive(options); assert.ok(getCachedPredictive({...options,scope:reordered}));await fetchPredictive({...options,scope:reordered});assert.equal(count,3);
        await fetchPrescriptive(options);assert.ok(getCachedPrescriptive({...options,scope:reordered}));await fetchPrescriptive({...options,scope:reordered});assert.equal(count,4);
        const group={...options,comparisons:[{category:'A',provinceKey:N}]};
        await fetchForecastComparisons(group);assert.ok(getCachedForecastComparisons({...group,scope:reordered}));await fetchForecastComparisons({...group,scope:reordered});assert.equal(count,5);
        await fetchPredictive({...options,scope:distinct});assert.equal(count,6);
        clearAnalyticsMemoryCache();assert.equal(getCachedPredictive(options),null);
    } finally {globalThis.fetch=oldFetch;clearAnalyticsMemoryCache();}
});

// A partial last month can contain a category absent from the forecast window.
test('forecast options use the effective complete-month range for geographic scopes',()=>{
    const base=fixture(36);
    base.push({...base[0], id:'partial-only',order_id:'partial-only',category:'PartialOnly',order_creation_date:'2025-01-15T00:00:00Z',year_month:'2025-01'});
    const scope={...all,regions:['North'],period:'Last 12 Months'};
    const snapshot=prepareAnalyticsSnapshot(base);
    const descriptive=analyzeRows(snapshot,scope);
    assert.ok(descriptive.categories.some(x=>x.name==='PartialOnly'));
    const options=forecastScopeOptions(snapshot,scope,descriptive);
    assert.ok(!options.categories.includes('PartialOnly'));
    assert.deepEqual(options.categories,predictiveAnalytics(snapshot,scope).options.categories);
    assert.ok(options.provinces.every(x=>x.region==='North'));
});
test('backend caches share equivalent geography order and preserve isolation between distinct scopes',()=>{
    const opts={filters:selected,horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict'};
    const reordered={...opts,filters:{...selected,regions:['North','South','North'],provinceKeys:[N,S,S]}};
    const first=cachedPredictive(indexed,opts);
    assert.equal(cachedPredictive(indexed,reordered),first);
    const other=cachedPredictive(indexed,{...opts,filters:{...selected,provinceKeys:[N]}});
    assert.notEqual(other,first);
    const comparison=[{category:'A',provinceKey:N}];
    assert.equal(forecastComparisons(indexed,opts,comparison),forecastComparisons(indexed,reordered,comparison));
});
test('return treatments and partial/custom date rules stay identical for equivalent geographic scope',()=>{
    const changed=structuredClone(rows);
    changed[0].returned_quantity=5;changed[0].net_quantity=5;changed[0].return_refund_status='Request Approved';
    changed[1].is_exact_duplicate=true;changed[2].is_included_in_analysis=false;
    const snapshot=prepareAnalyticsSnapshot(changed);
    for(const returns of ['Include All','Exclude Approved Returns','Returned / Refunded Only']) for(const period of ['All Available Data','Last 12 Months','Last 24 Months','Custom Range']) {
        const rest={returns,period,start:'2022-01-15',end:'2024-10-15'};
        assert.deepEqual(analyzeRows(snapshot,{...selected,...rest}),analyzeRows(snapshot,{...expectedLegacy,...rest}));
    }
});
