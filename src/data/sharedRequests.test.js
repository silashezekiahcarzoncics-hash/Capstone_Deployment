import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedRequests } from './sharedRequests.js';
const deferred = () => { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r; reject=j;}); return {promise,resolve,reject}; };
test('identical requests share one transport and one caller can abort independently', async () => {
    const shared = createSharedRequests(), response = deferred(), a = new AbortController(), b = new AbortController();
    let calls = 0, transport;
    const load = signal => { calls++; transport=signal; return response.promise; };
    const p1 = shared.run('key',a.signal,load), p2 = shared.run('key',b.signal,load);
    await Promise.resolve();
    a.abort(); await assert.rejects(p1,{name:'AbortError'});
    assert.equal(transport.aborted,false); assert.equal(calls,1);
    response.resolve({value:42}); assert.deepEqual(await p2,{value:42});
});
test('all subscribers leaving cancels transport; a new request does not join it', async () => {
    const shared=createSharedRequests(), a=new AbortController(), first=deferred(); let signal;
    const p=shared.run('k',a.signal,s=>{signal=s;return first.promise;}); await Promise.resolve();
    a.abort(); await assert.rejects(p,{name:'AbortError'}); assert.equal(signal.aborted,true);
    assert.equal(await shared.run('k',undefined,async()=>2),2); first.resolve(1);
});
test('invalidation isolates old reads and failed requests can retry', async () => {
    const shared=createSharedRequests(), old=deferred();
    const p=shared.run('k',undefined,()=>old.promise); shared.clear();
    assert.equal(await shared.run('k',undefined,async()=>2),2); old.resolve(1); assert.equal(await p,1);
    await assert.rejects(shared.run('k',undefined,async()=>{throw Error('offline');}),/offline/);
    assert.equal(await shared.run('k',undefined,async()=>3),3);
});
