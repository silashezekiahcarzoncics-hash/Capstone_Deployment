import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAnalyticsMemoryCache, fetchPredictive, getCachedPredictive, fetchForecastComparisons, getCachedForecastComparisons } from './analyticsApi.js';
import { prepareForecastMetric } from './forecastMetricPreload.js';
const originalFetch = globalThis.fetch;
const scope = { period:'All Available Data', categories:null };
const comparisons = Array.from({length:50},(_,i)=>({category:`C${i}`,provinceKey:''}));
const optionsFor = target => ({scope,horizon:6,target,model:'auto',missingMonthMode:'strict',category:'',provinceKey:''});
const groupFor = target => ({...optionsFor(target),comparisons});
const prepare = (target,signal) => prepareForecastMetric({options:optionsFor(target),comparisonOptions:groupFor(target),getMain:getCachedPredictive,getComparisons:getCachedForecastComparisons,fetchMain:fetchPredictive,fetchComparisons:fetchForecastComparisons,signal});
const response = value => new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const mockResponse = (url, options) => {
    if (options.method === 'POST') { const body=JSON.parse(options.body); return response({series:body.comparisons.map(item=>({chart:{target:body.target,category:item.category}}))}); }
    return response({target:new URL(url).searchParams.get('target')});
};
test('50 comparison categories: two requests per cold metric and zero requests on warm switching', async () => {
    clearAnalyticsMemoryCache(); let calls=0;
    globalThis.fetch=async (...args)=>{calls++; return mockResponse(...args);};
    try {
        for (const target of ['revenue','orders','quantity']) { const result=await prepare(target); assert.equal(result.data.target,target); assert.equal(result.group.series.length,50); }
        assert.equal(calls,6);
        for (let i=0;i<12;i++) for (const target of ['orders','revenue','quantity']) {
            const result=await prepare(target);
            assert.equal(result.group.series[49].chart.target,target);
            assert.equal(result.data.target,target);
        }
        assert.equal(calls,6);
        // Unrelated analytics requests must not evict comparison groups.
        for (let i=0;i<140;i++) await fetchPredictive({...optionsFor('revenue'),category:`other${i}`,chartOnly:true});
        for (const target of ['revenue','orders','quantity']) assert.ok(getCachedForecastComparisons(groupFor(target)));
    } finally { globalThis.fetch=originalFetch; clearAnalyticsMemoryCache(); }
});
test('concurrent preload and click coalesce; cancelling preload keeps the clicked request alive', async () => {
    clearAnalyticsMemoryCache(); let calls=0;
    const queue=[]; globalThis.fetch=(...args)=>{calls++; return new Promise(resolve=>queue.push(()=>resolve(mockResponse(...args))));};
    const warm=new AbortController(); const click=new AbortController();
    try {
        const a=prepare('orders',warm.signal), b=prepare('orders',click.signal);
        await Promise.resolve(); assert.equal(calls,2);
        warm.abort(); await assert.rejects(a,{name:'AbortError'});
        queue.forEach(resolve=>resolve());
        assert.equal((await b).group.series.length,50); assert.equal(calls,2);
    } finally {globalThis.fetch=originalFetch; clearAnalyticsMemoryCache();}
});
test('refresh invalidation prevents older comparison requests from repopulating the cache', async () => {
    clearAnalyticsMemoryCache(); let complete;
    globalThis.fetch=()=>new Promise(resolve=>{complete=resolve;});
    try {
        const old=fetchForecastComparisons(groupFor('orders')); await Promise.resolve();
        clearAnalyticsMemoryCache(); complete(response({series:[]})); await old;
        assert.equal(getCachedForecastComparisons(groupFor('orders')),null);
    } finally {globalThis.fetch=originalFetch; clearAnalyticsMemoryCache();}
});
test('partial errors are not cached and are retryable', async () => {
    clearAnalyticsMemoryCache(); let fails=true;
    globalThis.fetch=async (...args)=>args[1].method==='POST'&&fails?response({series:[{error:'temporary error',chart:null}]}):mockResponse(...args);
    try {
        await assert.rejects(prepare('quantity'),/could not be prepared/);
        assert.equal(getCachedForecastComparisons(groupFor('quantity')),null);
        fails=false; assert.equal((await prepare('quantity')).group.series.length,50);
    } finally {globalThis.fetch=originalFetch; clearAnalyticsMemoryCache();}
});
