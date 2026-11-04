/**
 * Every บทสอน card fits: a step's body (a function evaluated for a role that can do
 * everything on a page that has everything, and for one that can do nothing on an empty page) is at most
 * MAX characters. Pure: the tours are data.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { TOURS, type StepCtx } from '@/components/tour/tours';

const MAX = 220;
const CTXS: [string, StepCtx][] = [
  ['all true', { can: () => true, has: () => true }],
  ['all false', { can: () => false, has: () => false }],
];

test(`tour cards: every step body ≤ ${MAX} characters`, () => {
  const long: string[] = [];
  for (const [path, tour] of Object.entries(TOURS))
    tour.steps.forEach((s, i) => {
      for (const [name, ctx] of CTXS) {
        const body = typeof s.body === 'function' ? s.body(ctx) : s.body;
        const title = typeof s.title === 'function' ? s.title(ctx) : s.title;
        const n = [...body].length;
        if (n > MAX) long.push(`${path} #${i + 1} "${title}" (${name}): ${n} > ${MAX}`);
        if (typeof s.body === 'string') break;
      }
    });
  assert.deepEqual(long, []);
});
