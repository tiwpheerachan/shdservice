/**
 * npm run test:rate-limit — the in-memory limiter (src/server/rate-limit.ts): IPv6 counted per /64,
 * and the bucket map stays capped. Pure: no DB, no network (the db client is never touched).
 */
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';

process.env.ORIGIN_AUTH_MODE = 'off'; // clientIp() then reads X-Forwarded-For
const { ipBucket } = await import('../src/lib/client-ip.ts');
const { rateLimit, bucketCount, MAX_BUCKETS } = await import('../src/server/rate-limit.ts');

const req = (ip: string) =>
  ({ cookies: { get: () => undefined }, headers: new Headers({ 'x-forwarded-for': ip }) }) as unknown as NextRequest;

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${(e as Error).message}`);
  }
}

console.log('rate limit keys');
await test('IPv4 is its own bucket', () => assert.equal(ipBucket('203.0.113.9'), '203.0.113.9'));
await test('IPv6 groups by /64', () => {
  assert.equal(ipBucket('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipBucket('::1'), '0:0:0:0::/64');
  assert.notEqual(ipBucket('2001:db8:1:3::1'), ipBucket('2001:db8:1:2::1'));
});
await test('rotating addresses inside one /64 hits the same limit', async () => {
  await rateLimit(req('2001:db8:9:9::1'), 't6', 2);
  await rateLimit(req('2001:db8:9:9::2'), 't6', 2);
  await assert.rejects(rateLimit(req('2001:db8:9:9::3'), 't6', 2), { status: 429 });
});

console.log('\nbucket cap');
await test(`the map never grows past ${MAX_BUCKETS}; the oldest tenth goes, not all`, async () => {
  for (let i = 0; bucketCount() < MAX_BUCKETS; i++)
    await rateLimit(req(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`), 'cap', 5);
  await rateLimit(req('2001:db8:9:9::1'), 't6b', 1); // a fresh key while full
  assert.ok(bucketCount() <= MAX_BUCKETS, `size ${bucketCount()}`);
  assert.equal(bucketCount(), MAX_BUCKETS - Math.ceil(MAX_BUCKETS / 10) + 1);
  // the newest key survived the eviction and still counts
  await assert.rejects(rateLimit(req('2001:db8:9:9::7'), 't6b', 1), { status: 429 });
});

console.log(`\n${failed ? 'FAILED' : 'all passed'} (${failed} failed)`);
if (failed) process.exit(1);
