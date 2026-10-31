import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { strFromU8, unzipSync } from 'fflate';
import { readSheet as read } from 'read-excel-file/node';
import { writeXlsx, type XlsxCol } from '@/server/xlsx';

const COLS: XlsxCol[] = [
  { key: 'no', header: 'เลขที่งาน', width: 14 },
  { key: 'amount', header: 'ยอดเงิน', money: true },
  { key: 'qty', header: 'จำนวน', num: true },
  { key: 'other', header: 'อื่นๆ' },
];

const readSheet = (file: Buffer) => read(file, { trim: false });

async function xlsx(rows: object[], note?: string, title = 'งานซ่อม') {
  const out = new PassThrough();
  const file = buffer(out);
  await writeXlsx(out, { title, cols: COLS, rows, note });
  return file;
}

test('values read back by an independent reader: Thai, escaped text, money / count as numbers, a note row', async () => {
  const file = await xlsx(
    [
      { no: 'J2614686', amount: '1300.50', qty: 2, other: '0899993466' },
      { no: 'A & B <x> "q"', amount: null, qty: 0, other: true },
      { no: 'ctrl\u0001char ', amount: 0.1 + 0.2, qty: '7', other: 12.5 },
    ],
    '⚠ แสดง 20,000 แถวแรกเท่านั้น',
  );
  assert.deepEqual(await readSheet(file), [
    ['เลขที่งาน', 'ยอดเงิน', 'จำนวน', 'อื่นๆ'],
    ['J2614686', 1300.5, 2, '0899993466'],
    ['A & B <x> "q"', 0, 0, true],
    ['ctrlchar ', 0.30000000000000004, 7, 12.5],
    ['⚠ แสดง 20,000 แถวแรกเท่านั้น', null, null, null],
  ]);
});

test('a stored money value that is not a number shows as it is, never as 0', async () => {
  const rows = await readSheet(await xlsx([{ no: 'X', amount: 'abc', qty: 1 }]));
  assert.equal(rows[1]![1], 'abc');
});

test('frozen bold filled header, autoFilter, widths, number formats, note style', async () => {
  const zip = unzipSync(new Uint8Array(await xlsx([{ no: 'J1', amount: 5, qty: 1 }], 'note')));
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']!);
  const styles = strFromU8(zip['xl/styles.xml']!);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<\/sheetData><autoFilter ref="A1:D1"\/><\/worksheet>$/);
  assert.match(sheet, /<col min="1" max="1" width="14" customWidth="1"\/><col min="2" max="2" width="16"/);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/);
  assert.match(sheet, /<c r="B2" s="2"><v>5<\/v><\/c><c r="C2" s="3"><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="A3" t="inlineStr" s="4">/);
  assert.match(styles, /formatCode="#,##0\.00"/);
  assert.match(styles, /<font><b\/><sz val="11"\/><name val="Calibri"\/><\/font>/);
  assert.match(styles, /<fgColor rgb="FFE8EEF9"\/>/);
  assert.match(styles, /<color rgb="FFB45309"\/>/);
  assert.match(strFromU8(zip['xl/workbook.xml']!), /<sheet name="งานซ่อม"/);
});

test('a sheet name Excel would refuse is made legal', async () => {
  const zip = unzipSync(
    new Uint8Array(await xlsx([], undefined, "'รับ/จ่าย [สต็อก]: รายการสินค้าทั้งหมดของคลังสินค้า'")),
  );
  const name = /<sheet name="([^"]*)"/.exec(strFromU8(zip['xl/workbook.xml']!))![1]!;
  assert.equal(name, 'รับ-จ่าย -สต็อก-- รายการสินค้า');
  assert.ok(name.length <= 31);
});

test('25,000 rows across many flushed chunks come back complete and in order', async () => {
  const n = 25_000;
  const rows = Array.from({ length: n }, (_, i) => ({
    no: `J${i}`,
    amount: i * 1.25,
    qty: i,
    other: 'ข้อความภาษาไทย',
  }));
  const back = await readSheet(await xlsx(rows));
  assert.equal(back.length, n + 1);
  assert.deepEqual(back[n], [`J${n - 1}`, (n - 1) * 1.25, n - 1, 'ข้อความภาษาไทย']);
});

test('empties, booleans, dates, odd numbers and line breaks in a plain column', async () => {
  const at = new Date('2026-10-31T03:00:00Z'); // 10:00 in Bangkok
  const rows = await readSheet(
    await xlsx([
      { no: '', other: false },
      { no: null, other: at },
      { no: 'x', other: new Date('nope') },
      { no: 'y', other: Infinity },
      { no: 'z', other: 'line1\r\nline2' },
    ]),
  );
  assert.deepEqual(rows[1], [null, 0, 0, false]);
  assert.equal((rows[2]![3] as Date).toISOString(), '2026-10-31T10:00:00.000Z');
  assert.deepEqual(rows[3], ['x', 0, 0, null]);
  assert.deepEqual(rows[4], ['y', 0, 0, 'Infinity']);
  assert.match(String(rows[5]![3]), /^line1\r?\nline2$/);
});

test('a literal _xHHHH_ is escaped so Excel shows it as typed; History is not a legal sheet name', async () => {
  const zip = unzipSync(new Uint8Array(await xlsx([{ no: 'a_x0041_b' }], undefined, 'History')));
  assert.match(strFromU8(zip['xl/worksheets/sheet1.xml']!), /<t xml:space="preserve">a_x005F_x0041_b<\/t>/);
  assert.match(strFromU8(zip['xl/workbook.xml']!), /<sheet name="History-"/);
});

test('no columns is refused, not written as a broken file', async () => {
  await assert.rejects(writeXlsx(new PassThrough(), { title: 't', cols: [], rows: [] }), /no columns/);
});

test('a client that went away: nothing more is written, nothing throws', async () => {
  let written = 0;
  const out = new PassThrough();
  out.on('data', () => written++);
  out.destroy();
  await writeXlsx(out, { title: 't', cols: COLS, rows: [{ no: 'J1' }] });
  assert.equal(written, 0);

  // gone mid-file: stops at the next row instead of writing the remaining 49,000
  const mid = new PassThrough();
  let pulled = 0;
  const rows = (function* () {
    for (let i = 0; i < 50_000; i++) {
      pulled++;
      if (i === 1000) mid.destroy();
      yield { no: `J${i}` };
    }
  })();
  mid.resume();
  await writeXlsx(mid, { title: 't', cols: COLS, rows });
  assert.ok(pulled <= 1002, `pulled ${pulled}`);
});
