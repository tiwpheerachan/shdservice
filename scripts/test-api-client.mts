import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ApiError } from '@/lib/api';

const tooMany = (retryAfter: number) =>
  Response.json(
    { error: `เรียกใช้งานถี่เกินไป กรุณารอ ${retryAfter} วินาที`, details: { retryAfter } },
    { status: 429 },
  );

/** answers in order, records each request's method */
function serve(...answers: (() => Response)[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(init?.method ?? 'GET');
    return answers.shift()!();
  }) as typeof fetch;
  return calls;
}

test('a read over the rate limit with a short wait is sent again once, after the wait', async () => {
  const calls = serve(
    () => tooMany(1),
    () => Response.json({ rows: [1] }),
  );
  const start = Date.now();
  assert.deepEqual(await api('/api/data/jobs'), { rows: [1] });
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - start >= 1000, 'waited the window out');
});

test('a second 429 after the retry is the error, not another retry', async () => {
  const calls = serve(
    () => tooMany(1),
    () => tooMany(1),
  );
  await assert.rejects(api('/api/data/jobs'), (e) => e instanceof ApiError && e.status === 429);
  assert.equal(calls.length, 2);
});

test('a long wait (an export already running: 10 s) is answered at once', async () => {
  const calls = serve(() => tooMany(10));
  await assert.rejects(api('/api/data/jobs'), (e) => e instanceof ApiError && e.status === 429);
  assert.equal(calls.length, 1);
});

test('a write over the limit is never re-sent by api()', async () => {
  const calls = serve(() => tooMany(1));
  await assert.rejects(api('/api/jobs', { method: 'POST', body: '{}' }), (e) => e instanceof ApiError);
  assert.deepEqual(calls, ['POST']);
});
