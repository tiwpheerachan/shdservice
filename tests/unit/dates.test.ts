import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dmyToIso, isoToDmy, maskDmy } from '@/lib/dates';

test('a stored date shows day first', () => {
  assert.equal(isoToDmy('2026-10-05'), '05/10/2026');
  assert.equal(isoToDmy(''), '');
});

test('typing builds dd/mm/yyyy', () => {
  for (const [typed, shown] of [
    ['0', '0'],
    ['05', '05'],
    ['051', '05/1'],
    ['05102026', '05/10/2026'],
    ['05/10/2026', '05/10/2026'],
    ['5/', '05'],
    ['05/1/', '05/01'],
    ['5/1/2026', '05/01/2026'],
    ['05102026999', '05/10/2026'],
    ['2026-10-05', '05/10/2026'],
    ['ab', ''],
  ])
    assert.equal(maskDmy(typed!), shown, typed!);
});

test('the day comes first: 05/10 is 5 October, never 10 May', () => {
  assert.equal(dmyToIso('05/10/2026'), '2026-10-05');
  assert.equal(dmyToIso('29/02/2028'), '2028-02-29');
});

test('only a whole, real day counts', () => {
  for (const text of ['', '05/10', '05/10/202', '31/02/2026', '29/02/2026', '10/13/2026', '00/10/2026', '05/10/2569'])
    assert.equal(dmyToIso(text), null, text);
});
