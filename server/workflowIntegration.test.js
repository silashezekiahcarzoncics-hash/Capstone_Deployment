import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

// A disposable copy of the real HTTP server, with empty local data and no
// Supabase keys. This suite cannot edit the installed dataset or remote DB.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const headers = [
  'Order ID', 'Order Status', 'Product Name', 'Quantity', 'Total Buyer Payment',
  'Deal Price', 'Order Creation Date', 'Return / Refund Status',
  'Returned quantity', 'Province', 'City', 'Seller Voucher(PHP)'
];
const row = (overrides = {}) => ({
  'Order ID': 'ORDER-1', 'Order Status': 'Completed', 'Product Name': 'New Unclassified Item',
  'Quantity': '2', 'Total Buyer Payment': '200', 'Deal Price': '100',
  'Order Creation Date': '2025-11-10', 'Return / Refund Status': '',
  'Returned quantity': '0', 'Province': 'NCR', 'City': 'Metro Manila',
  'Seller Voucher(PHP)': '0', ...overrides
});
function workbook(rows, {sheet = 'orders', omit = []} = {}) {
  const keys = headers.filter(h=>!omit.includes(h));
  const sh = XLSX.utils.aoa_to_sheet([keys, ...rows.map(r=>keys.map(h=>r[h] ?? null))]);
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, sh, sheet);
  return XLSX.write(w, {type:'buffer', bookType:'xlsx'});
}
let temp, proc, url, logs='';
async function getPort() {
  return await new Promise((resolve,reject)=>{
    const sock=net.createServer();sock.once('error',reject);
    sock.listen(0,'127.0.0.1',()=>{ const port=sock.address().port; sock.close(()=>resolve(port)); });
  });
}
async function api(endpoint,{method='GET',body,files, raw=false}={}) {
  const options={method};
  if(files){const data=new FormData();for(const [name,bytes] of files)
    data.append('files',new Blob([bytes]),name);options.body=data;}
  else if(body!==undefined){options.body=JSON.stringify(body);options.headers={'Content-Type':'application/json'};}
  const response=await fetch(url+endpoint,options);
  const payload=raw? await response.text():await response.json();
  return {status:response.status,data:payload};
}
before(async()=>{
  temp=fs.mkdtempSync(path.join(root,'.test-workflow-'));
  fs.mkdirSync(path.join(temp,'server','data','uploads'),{recursive:true});
  for(const name of fs.readdirSync(path.join(root,'server'))){
    if(name.endsWith('.js')) fs.copyFileSync(path.join(root,'server',name),path.join(temp,'server',name));
  }
  fs.cpSync(path.join(root,'server','cache'),path.join(temp,'server','cache'),{recursive:true});
  fs.writeFileSync(path.join(temp,'server','data','database.json'),JSON.stringify({imports:[]}));
  const port=await getPort();url=`http://127.0.0.1:${port}/api`;
  proc=spawn(process.execPath,['server/server.js'],{cwd:temp,
    env:{...process.env,PORT:String(port),SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe']});
  proc.stdout.on('data',b=>logs+=b.toString());proc.stderr.on('data',b=>logs+=b.toString());
  const start=Date.now();
  while(Date.now()-start<18000){
    if(proc.exitCode!==null) throw new Error('Backend exited prematurely: '+logs.slice(-2000));
    try{const r=await api('/health');if(r.status===200)return;}catch{}
    await new Promise(r=>setTimeout(r,120));
  }
  throw new Error('Timed out starting disposable backend: '+logs.slice(-3000));
});
after(async()=>{
  if(proc && proc.exitCode===null) {proc.kill(); await new Promise(r=>setTimeout(r,100));}
  if(temp)fs.rmSync(temp,{recursive:true,force:true});
});

test('empty installation: health, dataset summary, preparation status, and no phantom pending feature',async()=>{
  assert.equal((await api('/health')).status,200);
  const summary=await api('/datasets/summary');assert.equal(summary.status,200);
  assert.equal(summary.data.filesImported,0);
  assert.equal((await api('/preparation/status')).data.prepared,false);
  const noSupabaseSync=await api('/preparation/sync-supabase',{method:'POST'});
  assert.equal(noSupabaseSync.status,503);
  assert.match(noSupabaseSync.data.error,/Supabase is not configured/);
  assert.deepEqual((await api('/preparation/master-summary')).data,{prepared:false});
  assert.equal((await api('/preparation/pending-changes',{raw:true})).status,404);
  const run=await api('/preparation/run',{method:'POST'});
  assert.equal(run.status,500);assert.match(run.data.error,/No ready imported datasets/);
});

test('empty upload and invalid extension rejected without stopping other uploads',async()=>{
  const empty=await api('/datasets/import',{method:'POST',files:[]});
  assert.equal(empty.status,200);assert.equal(empty.data.imported.length,0);
  const mix=await api('/datasets/import',{method:'POST',files:[
    ['bad.txt',Buffer.from('not a workbook')],
    ['good.xlsx',workbook([row()])]
  ]});
  assert.equal(mix.status,200);
  assert.equal(mix.data.imported[0].status,'Rejected');
  assert.match(mix.data.imported[0].error,/xls/);
  assert.equal(mix.data.imported[1].status,'Ready');
});

test('corrupt, wrong-sheet, empty-sheet, missing Deal Price, invalid numeric and return quantities rejected',async()=>{
  const cases=[
    ['corrupt.xlsx',Buffer.from('junk'),/workbook|zip|file|Unsupported|Unknown|unsupported/i],
    ['wrong-sheet.xlsx',workbook([row()],{sheet:'Sheet1'}),/orders/i],
    ['empty-sheet.xlsx',workbook([]),/no transaction rows/i],
    ['missing-price.xlsx',workbook([row()],{omit:['Deal Price']}),/Deal Price/],
    ['invalid-price.xlsx',workbook([row({'Deal Price':'N/A'})]),/Deal Price/],
    ['negative-price.xlsx',workbook([row({'Deal Price':'-1'})]),/Deal Price/],
    ['invalid-quantity.xlsx',workbook([row({'Quantity':'bad'})]),/quantity/i],
    ['excessive-return.xlsx',workbook([row({'Returned quantity':'9'})]),/quantity/i],
    ['negative-voucher.xlsx',workbook([row({'Seller Voucher(PHP)':'-10'})]),/voucher/i]
  ];
  for(const [name,buf,reason] of cases){
    const resp=await api('/datasets/import',{method:'POST',files:[[name,buf]]});
    assert.equal(resp.status,200,name);assert.equal(resp.data.imported[0].status,'Rejected',name);
    assert.match(resp.data.imported[0].error,reason,name);
  }
  const list=await api('/datasets');assert.equal(list.data.length,1);
});

test('duplicate filename rejected and dataset counts reflect only accepted workbooks',async()=>{
  const resp=await api('/datasets/import',{method:'POST',files:[['GOOD.XLSX',workbook([row()])]]});
  assert.equal(resp.data.imported[0].status,'Already Imported');
  const list=await api('/datasets');assert.equal(list.data.length,1);
  const stats=await api('/datasets/summary');assert.equal(stats.data.filesImported,1);
  assert.equal(stats.data.totalRecords,1);
});

test('profile, categorization, invalid category, and immediate mapping changes',async()=>{
  const profile=await api('/preparation/profile');assert.equal(profile.status,200);
  assert.equal(profile.data.source.transactionLines,1);
  const initial=await api('/preparation/products');assert.equal(initial.status,200);
  assert.equal(initial.data.records.length,1);
  const invalid=await api('/preparation/products',{method:'PATCH',body:{rawProductName:'New Unclassified Item',category:'Fake Category'}});
  assert.equal(invalid.status,400);
  const change=await api('/preparation/products',{method:'PATCH',body:{rawProductName:'New Unclassified Item',category:'Plastic Bags'}});
  assert.equal(change.status,200);
  const updated=await api('/preparation/products');
  assert.equal(updated.data.records[0].category,'Plastic Bags');
  assert.equal((await api('/preparation/status')).data.prepared,false);
});

test('publishing blocked before preparation; preparation succeeds and repeat returns unchanged',async()=>{
  const blocked=await api('/preparation/upload',{method:'POST',body:{confirmReplace:true,runId:'bad'}});
  assert.equal(blocked.status,409);
  const run=await api('/preparation/run',{method:'POST'});
  assert.equal(run.status,200,JSON.stringify(run.data));assert.ok(run.data.runId);
  const state=await api('/preparation/status');assert.equal(state.data.prepared,true);
  const summary=await api('/preparation/master-summary');assert.equal(summary.data.records,1);
  const second=await api('/preparation/run',{method:'POST'});
  assert.equal(second.status,200);assert.equal(second.data.unchanged,true);
  assert.equal(second.data.runId,run.data.runId);
  // Missing explicit consent and old run are both rejected before reaching Supabase.
  assert.equal((await api('/preparation/upload',{method:'POST',body:{runId:run.data.runId}})).status,400);
  assert.equal((await api('/preparation/upload',{method:'POST',body:{confirmReplace:true,runId:'old'}})).status,409);
});

test('categorization change invalidates preparation without pending-change API, then rerun restores freshness',async()=>{
  const old=(await api('/preparation/status')).data.runId;
  const change=await api('/preparation/products',{method:'PATCH',body:{rawProductName:'New Unclassified Item',category:'Tape / Adhesive'}});
  assert.equal(change.status,200);
  assert.equal((await api('/preparation/products')).data.records[0].category,'Tape / Adhesive');
  assert.equal((await api('/preparation/status')).data.prepared,false);
  const blocked=await api('/preparation/upload',{method:'POST',body:{confirmReplace:true,runId:old}});
  assert.equal(blocked.status,409);
  const fresh=await api('/preparation/run',{method:'POST'});
  assert.equal(fresh.status,200);assert.notEqual(fresh.data.runId,old);
  assert.equal((await api('/preparation/status')).data.prepared,true);
});

test('category definition add, rename, and delete with controlled assignment constraints',async()=>{
  const added=await api('/preparation/categories',{method:'POST',body:{name:'Test Category'}});
  assert.equal(added.status,200);
  assert.ok(added.data.taxonomy['Test Category']);
  const renamed=await api('/preparation/categories',{method:'PATCH',body:{oldName:'Test Category',newName:'Test Renamed'}});
  assert.equal(renamed.status,200);
  const assigned=await api('/preparation/products',{method:'PATCH',body:{rawProductName:'New Unclassified Item',category:'Test Renamed'}});
  assert.equal(assigned.status,200);
  const blocked=await api('/preparation/categories',{method:'DELETE',body:{name:'Test Renamed'}});
  assert.equal(blocked.status,400);
  assert.match(blocked.data.error,/assigned/i);
  await api('/preparation/products',{method:'PATCH',body:{rawProductName:'New Unclassified Item',category:'Plastic Bags'}});
  const deleted=await api('/preparation/categories',{method:'DELETE',body:{name:'Test Renamed'}});
  assert.equal(deleted.status,200);assert.ok(!deleted.data.taxonomy['Test Renamed']);
  assert.equal((await api('/preparation/status')).data.prepared,false);
});

test('preparation failure from cross-row seller-voucher conflict preserves prior successful output',async()=>{
  // First restore valid preparation.
  const current=await api('/preparation/run',{method:'POST'});assert.equal(current.status,200);
  const f=path.join(temp,'server','data','prepared_master_data.json');
  const backup=fs.readFileSync(f);
  const problem=workbook([
    row({'Order ID':'ORDER-2','Product Name':'Another Item','Seller Voucher(PHP)':'10'}),
    row({'Order ID':'ORDER-2','Product Name':'Another Item B','Seller Voucher(PHP)':'20'})
  ]);
  const added=await api('/datasets/import',{method:'POST',files:[['voucher-conflict.xlsx',problem]]});
  assert.equal(added.status,200);assert.equal(added.data.imported[0].status,'Ready');
  const failed=await api('/preparation/run',{method:'POST'});
  assert.equal(failed.status,500);assert.match(failed.data.error,/Conflicting Seller Voucher/i);
  assert.deepEqual(fs.readFileSync(f),backup);
  assert.equal((await api('/preparation/status')).data.prepared,false);
  // Delete the offending workbook and prepare again.
  const imports=(await api('/datasets')).data;
  const problemId=imports.find(x=>x.fileName==='voucher-conflict.xlsx').id;
  assert.equal((await api('/datasets/'+encodeURIComponent(problemId),{method:'DELETE'})).status,200);
  const restored=await api('/preparation/run',{method:'POST'});
  assert.equal(restored.status,200);
  assert.equal((await api('/preparation/status')).data.prepared,true);
});

test('delete import invalidates prepared dataset; missing resource, bad password and no Supabase fail safely',async()=>{
  assert.equal((await api('/datasets/does-not-exist',{method:'DELETE'})).status,404);
  const badPwd=await api('/application/reset',{method:'POST',body:{mode:'local',password:'wrong'}});
  assert.equal(badPwd.status,403);
  const live=await api('/preparation/live-status');assert.equal(live.status,503);
  const items=(await api('/datasets')).data;assert.equal(items.length,1);
  assert.equal((await api('/datasets/'+encodeURIComponent(items[0].id),{method:'DELETE'})).status,200);
  assert.equal((await api('/preparation/status')).data.prepared,false);
  const sum=await api('/datasets/summary');assert.equal(sum.data.filesImported,0);
  assert.equal((await api('/datasets')).data.length,0);
});

test('legacy .xls import and local-only reset; combined reset without Supabase is non-destructive',async()=>{
  const legacy=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(legacy,XLSX.utils.aoa_to_sheet([
    headers,
    headers.map(h=>row({'Order ID':'OLD-ORDER'})[h] ?? null)
  ]),'orders');
  const bytes=XLSX.write(legacy,{type:'buffer',bookType:'biff8'});
  const imported=await api('/datasets/import',{method:'POST',files:[['legacy.xls',bytes]]});
  assert.equal(imported.status,200);
  assert.equal(imported.data.imported[0].status,'Ready');
  assert.equal((await api('/preparation/run',{method:'POST'})).status,200);
  const noRemote=await api('/application/reset',{method:'POST',body:{mode:'local_supabase',password:'saiphercg123'}});
  assert.equal(noRemote.status,503);
  assert.equal((await api('/datasets')).data.length,1);
  const local=await api('/application/reset',{method:'POST',body:{mode:'local',password:'saiphercg123'}});
  assert.equal(local.status,200);assert.equal(local.data.localCleared,true);
  assert.equal((await api('/datasets')).data.length,0);
  assert.equal((await api('/preparation/status')).data.prepared,false);
  assert.equal(fs.readdirSync(path.join(temp,'server','data','uploads')).length,0);
});

test('damaged import registry is reported and cannot be silently overwritten',async()=>{
  const file=path.join(temp,'server','data','database.json');
  const before=fs.readFileSync(file);
  try {
    fs.writeFileSync(file,'not valid json');
    const list=await api('/datasets');
    assert.equal(list.status,500);
    assert.match(list.data.error,/registry.*damaged|registry.*unreadable/i);
    const attempt=await api('/datasets/import',{method:'POST',files:[['safe.xlsx',workbook([row()])]]});
    assert.equal(attempt.status,500);
    assert.equal(fs.readFileSync(file,'utf8'),'not valid json');
  }finally {fs.writeFileSync(file,before);}
});

test('batch forecast endpoint validates its request and fails safely without Supabase', async () => {
  const body = {scope:{period:'All Available Data'},horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict',comparisons:[{category:'C0',provinceKey:''}]};
  const invalid = await api('/forecasts/comparisons',{method:'POST',body:{...body,target:'invalid'}});
  assert.equal(invalid.status,400);
  const malformed = await api('/forecasts/comparisons',{method:'POST',body:{...body,comparisons:[null]}});
  assert.equal(malformed.status,400);
  const unconfigured = await api('/forecasts/comparisons',{method:'POST',body});
  assert.equal(unconfigured.status,503);
  assert.match(unconfigured.data.error,/Supabase is not configured/);
});

test('global geographic checklists validate on all four HTTP analytics routes before database access', async () => {
  for(const scope of [{regions:'North'},{regions:[null]},{provinceKeys:['bad key']},{provinceKeys:[1]}]) {
    const query=new URLSearchParams({filters:JSON.stringify(scope)});
    for(const route of ['/analytics','/forecasts','/prescriptive']) assert.equal((await api(`${route}?${query}`)).status,400);
    assert.equal((await api('/forecasts/comparisons',{method:'POST',body:{scope,horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict',comparisons:[]}})).status,400);
  }
  const scope={regions:['South','North'],provinceKeys:[JSON.stringify(['North','Same'])]};
  const query=new URLSearchParams({filters:JSON.stringify(scope)});
  for(const route of ['/analytics','/forecasts','/prescriptive']) assert.equal((await api(`${route}?${query}`)).status,503);
  assert.equal((await api('/forecasts/comparisons',{method:'POST',body:{scope,horizon:6,target:'revenue',model:'arima',missingMonthMode:'strict',comparisons:[]}})).status,503);
});
