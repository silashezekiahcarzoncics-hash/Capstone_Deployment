import test from 'node:test';
import assert from 'node:assert/strict';
import { createLivePreparationService } from './livePreparation.js';

function mockClient(records, { cap = 2, broken = false } = {}) {
  const counters = { rows: 0, runs: 0 };
  return {
    counters,
    from(table) {
      if (table === 'master_transactions') return {
        select() { return {
          order() { return {
            range(from, to) {
              counters.rows++;
              const rows = records.slice(from, Math.min(to + 1, from + cap));
              return Promise.resolve({ data: broken && from ? [] : rows, count: records.length, error: null });
            }
          }; }
        }; }
      };
      if (table === 'etl_runs') return { select() {return {eq(){return {order(){return {limit(){
        counters.runs++; return Promise.resolve({data:[{run_id:'run-1',status:'completed',created_at:'2026-11-18T00:00:00Z'}],error:null});
      }};}};}};}};
      throw new Error('Unexpected table');
    }
  };
}
const rows = [
  {id:'1',order_id:'order-1',source_file_name:'Jan.xlsx',order_creation_date:'2026-01-05',year_month:'2026-01',order_status:'Completed',raw_product_name:'Item One',category:'Beauty',region:'Region 1',province:'Cavite',raw_province:'Cavite',raw_city:'City',quantity:2,net_quantity:2,line_revenue:100,is_included_in_analysis:true},
  {id:'2',order_id:'order-2',source_file_name:'Jan.xlsx',order_creation_date:'2026-01-07',year_month:'2026-01',order_status:'Cancelled',raw_product_name:'Item Two',category:'Other / Unclassified',region:'Region 1',province:'Cavite',raw_province:'Cavite',raw_city:'City',quantity:1,net_quantity:1,line_revenue:20,is_included_in_analysis:false,return_refund_status:'Requested'},
  {id:'3',order_id:'order-3',source_file_name:'Feb.xlsx',order_creation_date:null,year_month:null,order_status:'Completed',raw_product_name:'Item One',category:'Beauty',region:'Region 2',province:'Laguna',raw_province:'Laguna',raw_city:'Town',quantity:3,net_quantity:3,line_revenue:30,is_included_in_analysis:true}
];
test('live report reads all capped pages and provides read-only staging-equivalent metrics', async () => {
  const client = mockClient(rows);
  const svc = createLivePreparationService(client);
  const value = await svc.load();
  assert.equal(value.records, 3);
  assert.equal(value.profile.filesImported, 2);
  assert.equal(value.profile.productListings, 2);
  assert.equal(value.quality.includedRows, 2);
  assert.equal(value.quality.excludedRows, 1);
  assert.equal(value.quality.returnRefundOrders, 1);
  assert.equal(value.quality.invalidDateRecords, 1);
  assert.equal(value.products.find(x=>x.rawProductName==='Item Two').status,'Review');
  assert.ok(value.products.every(product => !Object.hasOwn(product, 'subcategory')), 'live product classification exposes categories only');
  assert.equal(value.time.periods.length, 1);
  assert.equal(client.counters.rows, 2);
  await svc.load();
  assert.equal(client.counters.rows, 2, 'cache prevents excessive reads');
  await svc.load(true);
  assert.equal(client.counters.rows, 4, 'explicit refresh reloads');
});
test('empty live data is presented as empty, not as staged records', async () => {
  const value=await createLivePreparationService(mockClient([])).load();
  assert.equal(value.records,0);
  assert.equal(value.profile.filesImported,0);
  assert.equal(value.quality.includedRows,0);
});
test('incomplete pages are rejected rather than presenting partial live data', async () => {
  await assert.rejects(createLivePreparationService(mockClient(rows,{broken:true})).load(),/incomplete/);
});
test('client configuration missing is reported clearly', async () => {
  await assert.rejects(createLivePreparationService(null).load(),/not configured/);
});

test('reset invalidates a cached live report without waiting for its TTL', async () => {
  const records = [...rows];
  const svc = createLivePreparationService(mockClient(records));
  assert.equal((await svc.load()).records, 3);
  records.length = 0;
  svc.invalidate();
  assert.equal((await svc.load()).records, 0);
});

test('an in-flight live report cannot restore data after reset', async () => {
  const records = [...rows];
  const client = mockClient(records);
  const originalFrom = client.from.bind(client);
  let release, started, block = true;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  client.from = table => {
    if (table === 'etl_runs' && block) return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => { started(); await gate; return { data: [], error: null }; } }) }) }) };
    return originalFrom(table);
  };
  const svc = createLivePreparationService(client);
  const old = svc.load();
  const rejected = assert.rejects(old, /Published data changed/);
  await ready;
  records.length = 0;
  block = false;
  svc.invalidate();
  const fresh = await svc.load();
  assert.equal(fresh.records, 0);
  release();
  await rejected;
  assert.strictEqual(await svc.load(), fresh);
});
