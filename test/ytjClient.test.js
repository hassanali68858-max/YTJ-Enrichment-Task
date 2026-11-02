import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYtjClient } from '../src/ytj/client.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const nokia = { totalResults: 1, companies: [{ businessId: { value: '0112038-9' } }] };
const fast = { minIntervalMs: 0, backoffBaseMs: 1 };

test('retries 503 and connection refused, then succeeds', async () => {
  const replies = [
    () => json({}, 503),
    () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); },
    () => json(nokia),
  ];
  let calls = 0;
  const client = createYtjClient({ ...fast, fetchImpl: async () => replies[calls++]() });
  assert.equal((await client.getByBusinessId('0112038-9'))?.businessId.value, '0112038-9');
  assert.equal(calls, 3);
  assert.equal(client.stats().retries, 2);
});

test('gives up after the retry budget and reports the network cause', async () => {
  const client = createYtjClient({
    ...fast, retries: 2,
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); },
  });
  await assert.rejects(client.getByBusinessId('0112038-9'), /ECONNREFUSED/);
  assert.equal(client.stats().requests, 3);
});

test('does not retry 400', async () => {
  let calls = 0;
  const client = createYtjClient({ ...fast, fetchImpl: async () => { calls++; return json({}, 400); } });
  await assert.rejects(client.searchByName('x'), /400/);
  assert.equal(calls, 1);
});

test('caches successes, de-duplicates in-flight requests, never caches failures', async () => {
  let calls = 0;
  const client = createYtjClient({ ...fast, retries: 0, fetchImpl: async () => (++calls === 1 ? json({}, 500) : json(nokia)) });
  await assert.rejects(client.getByBusinessId('0112038-9'));
  await Promise.all([client.getByBusinessId('0112038-9'), client.getByBusinessId('0112038-9')]);
  await client.getByBusinessId('0112038-9');
  assert.equal(calls, 2);
});

test('ignores a response that does not contain the requested ID', async () => {
  const client = createYtjClient({ ...fast, fetchImpl: async () => json(nokia) });
  assert.equal(await client.getByBusinessId('1927400-1'), null);
});

test('paces requests by minIntervalMs', async () => {
  const starts = [];
  const client = createYtjClient({ minIntervalMs: 40, fetchImpl: async () => { starts.push(Date.now()); return json({ companies: [] }); } });
  await Promise.all(['a', 'b', 'c'].map((n) => client.searchByName(n)));
  assert.ok(starts[2] - starts[0] >= 75, `expected >= 80ms spread, got ${starts[2] - starts[0]}`);
});
