import assert from 'node:assert/strict';
import { test } from 'vitest';
import { withoutBlankLabels as show, withPrefix } from '@/lib/validation/customer';

test('labels that name nothing are gone', () => {
  for (const blank of ['ต. อ. จ.', 'ต.อ.จ.', ' ต.  อ.  จ. ', 'แขวง เขต จังหวัด', 'ต.- อ.- จ.-', 'ต. - อ. - จ. -'])
    assert.equal(show(blank), '', blank);
});

test('the legacy dropdown placeholder is gone, on its own and among real names', () => {
  const select = '- - Please Select - -';
  assert.equal(show(`ต.${select} อ.${select} จ.${select} `), '');
  assert.equal(
    show(`9/1 ถนนหนึ่ง แขวง${select} เขตจตุจักร จ.กรุงเทพมหานคร 10900`),
    '9/1 ถนนหนึ่ง เขตจตุจักร จ.กรุงเทพมหานคร 10900',
  );
  assert.equal(
    show(`9/1 ต.บางพลี อ.เมือง จ.ชลบุรี 20000 ต.${select} อ.${select}`),
    '9/1 ต.บางพลี อ.เมือง จ.ชลบุรี 20000',
  );
});

test('a dangling label goes, its neighbours stay', () => {
  for (const [stored, shown] of [
    ['9/1 ตำบลบางพลี อำเภอเมือง จ.', '9/1 ตำบลบางพลี อำเภอเมือง'],
    ['9/1 ตำบลบางพลี อำเภอเมือง จังหวัด', '9/1 ตำบลบางพลี อำเภอเมือง'],
    ['9/1 แขวงบางรัก จังหวัด 10500', '9/1 แขวงบางรัก 10500'],
    ['9/1 แขวง เขต บางรัก กทม. 10500', '9/1 เขต บางรัก กทม. 10500'],
    ['9/1 แขวง - เขต บางรัก 10500', '9/1 เขต บางรัก 10500'],
    ['9/1 ต.บางพลี อ. ต.บางพลี อ.เมือง จ.ชลบุรี 20000', '9/1 ต.บางพลี ต.บางพลี อ.เมือง จ.ชลบุรี 20000'],
    ['ต. อ. จ. 10270', '10270'],
  ] as const)
    assert.equal(show(stored), shown, stored);
});

test('a normal address comes back untouched, spacing and line breaks included', () => {
  for (const a of [
    '113/27 หมู่บ้านหนึ่ง ต.สำโรงเหนือ อ.เมือง จ.สมุทรปราการ 10270',
    '99/1 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310',
    '12 ต. บางพลี อ. เมือง จ. ชลบุรี 20000',
    'ห้อง 101 ( คอนโด ),  แขวงบางนาใต้\nเขตบางนา',
    '-',
    '',
  ])
    assert.equal(show(a), a);
});

test('real names that look like labels are kept', () => {
  for (const a of [
    'ต.จ.ป.ร. อ.เมือง จ.ระนอง 85000',
    'ต. จ.ป.ร. อ.เมือง จ.ระนอง 85000',
    '5 ร.ต.อ. สมชาย ต.บางพลี',
    '5 บ้าน จ.ส.ต. สมชาย ต.บางพลี',
    'อาคาร อ. ชั้น 3 ต.บางพลี',
    'นิคม เขต 3 ต.บางพลี',
    '9/1 แขวงแขวงห้วยขวาง',
    'เลขที่ 1 ถนนเขต ต.บางพลี',
  ])
    assert.equal(show(a), a);
});

test('a blank master name gets no prefix: the parcel line can never print a bare label', () => {
  assert.equal(withPrefix('ต.', '   '), '');
  assert.equal(withPrefix('จ.', ''), '');
  assert.equal(withPrefix('ต.', 'สำโรงเหนือ'), 'ต.สำโรงเหนือ');
});
