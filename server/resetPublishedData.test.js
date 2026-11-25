import test from 'node:test';
import assert from 'node:assert/strict';
import { resetPublishedData } from './resetPublishedData.js';

test('published reset invalidates only after RPC confirmation', async () => {
  const events = [];
  let finish;
  const client = { rpc(name) { events.push(name); return new Promise(resolve => { finish = resolve; }); } };
  const pending = resetPublishedData(client, () => events.push('invalidate'));
  assert.deepEqual(events, ['saipher_reset_business_data']);
  finish({ error: null });
  await pending;
  assert.deepEqual(events, ['saipher_reset_business_data', 'invalidate']);
});

test('failed or interrupted remote reset preserves caches', async () => {
  let invalidations = 0;
  const invalidate = () => { invalidations++; };
  await assert.rejects(resetPublishedData({ rpc: async () => ({ error: { message: 'permission denied' } }) }, invalidate), /reset was not completed/);
  await assert.rejects(resetPublishedData({ rpc: async () => { throw new Error('network failure'); } }, invalidate), /network failure/);
  assert.equal(invalidations, 0);
});
