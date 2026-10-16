/**
 * npm run test:schemas — the form rules in src/lib/validation (shared by the pages and the API).
 * Pure: no DB, no network.
 */
import assert from 'node:assert/strict';
import { validate, summary, isRealDate } from '../src/lib/validation/index.ts';
import {
  jobSchema as jobSchemaOf,
  filledRequired,
  missingRequired,
  isRequiredFilled,
  JOB_REQUIRED_KEYS,
  repairActionSchema,
  outsourceActionSchema,
  swapRefundSchema,
  closeSchema,
  jobAmountDue,
  cleanSerial,
  parseSwap,
  paymentDetailOf,
  returnDetailOf,
  noteMaxLength,
  NO_SERIAL,
  STATUS_CLOSED_TRACKED,
  type JobCheck,
  type JobRequiredKey,
} from '../src/lib/validation/job.ts';
import { customerSchema, conflictErrors } from '../src/lib/validation/customer.ts';
import { quoteJobNote } from '../src/lib/quote-job.ts';
import { quotationSchema } from '../src/lib/validation/quotation.ts';
import { saleOrderSchema } from '../src/lib/validation/sale-order.ts';
import {
  masterSchema,
  masterNameKey,
  modelSchema,
  userSchema,
  productSchema,
  documentProfileSchema,
  shippingProfileSchema,
} from '../src/lib/validation/admin.ts';
import { receiveSchema, issueSchema, assignSchema, approveSchema, callLogSchema } from '../src/lib/validation/stock.ts';
import { fileProblem } from '../src/server/storage.ts';
import { clampInt, orderBy, ymd } from '../src/server/paging.ts';
import { sql } from 'drizzle-orm';

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
const errorsOf = (schema: Parameters<typeof validate>[0], data: unknown) => {
  const v = validate(schema, data);
  return v.ok ? {} : v.errors;
};

/** the job rules with "today" pinned (date ranges: open date, due date, reception date) */
const TODAY = '2026-09-01';
const jobSchema = (keep?: readonly JobRequiredKey[], check: JobCheck = {}) =>
  jobSchemaOf(keep, { today: TODAY, ...check });

const fullJob = {
  customerCode: 'C00001',
  jobType: 'งานซ่อม',
  so: 'SO-1',
  channel: 'SHOPEE',
  saleOrderDate: '2026-09-01',
  warrantyMonth: '12',
  expireDate: '2027-09-01',
  serial: 'SN0001',
  brand: 'Dreame',
  modelCode: 'MD00001',
  symptoms: ['แบตหมดไว'],
  dueDate: '2026-09-08',
};

console.log('\nJob — new job (every required field)');
test('a complete job passes', () => assert.deepEqual(errorsOf(jobSchema(), fullJob), {}));
test('an empty job reports all 12 required fields at once, in form order', () => {
  const e = errorsOf(jobSchema(), {});
  assert.deepEqual(Object.keys(e), JOB_REQUIRED_KEYS);
  assert.equal(e.so, 'ต้องระบุ Sale Order No.');
});
test('blank strings, spaces and empty symptom lists count as empty', () => {
  const e = errorsOf(jobSchema(), { ...fullJob, so: '   ', serial: '', symptoms: [''] });
  assert.deepEqual(Object.keys(e).sort(), ['serial', 'so', 'symptoms']);
});
test('warranty months 0 is a value (not empty); negative / text is rejected', () => {
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: 0 }), {});
  assert.ok(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: -1 }).warrantyMonth);
  assert.ok(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: 'abc' }).warrantyMonth);
});
test('dates must be YYYY-MM-DD', () => {
  assert.ok(errorsOf(jobSchema(), { ...fullJob, saleOrderDate: '01/09/2026' }).saleOrderDate);
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, receptionDate: '' }), {});
});
test('dates must be a real calendar day (2026-02-30 used to reach the DB as a 500)', () => {
  assert.equal(
    errorsOf(jobSchema(), { ...fullJob, expireDate: '2026-02-30' }).expireDate,
    'วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)',
  );
  assert.ok(errorsOf(jobSchema(), { ...fullJob, dueDate: '2026-13-01' }).dueDate);
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, saleOrderDate: '2024-02-29' }), {});
  for (const bad of ['2026-02-30', '2025-02-29', '2026-04-31', '0000-01-01', '2026-1-5', 'abc', ''])
    assert.equal(isRealDate(bad), false, bad);
  assert.equal(isRealDate('2024-02-29'), true);
});
test('warranty months: whole numbers only (12.5 used to be cut to 12)', () => {
  assert.equal(
    errorsOf(jobSchema(), { ...fullJob, warrantyMonth: '12.5' }).warrantyMonth,
    'รับประกัน (เดือน) ต้องเป็นจำนวนเต็ม',
  );
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: '12' }), {});
});
test('costs must not be negative', () => assert.ok(errorsOf(jobSchema(), { ...fullJob, serviceCost: -5 }).serviceCost));
test('a new job needs its due date (วันประเมินซ่อมเสร็จ) — ISSUE-013', () => {
  assert.equal(errorsOf(jobSchema(), { ...fullJob, dueDate: '' }).dueDate, 'ต้องระบุวันประเมินซ่อมเสร็จ');
  assert.ok(errorsOf(jobSchema(), { ...fullJob, dueDate: '8/9/2026' }).dueDate, 'a date, not any text');
});

console.log('\nJob — edit (never worse than before)');
const legacy = { ...fullJob, serial: '', so: '' }; // an old swap job saved without these
test('an old job may keep its empty fields', () => {
  const before = filledRequired(legacy);
  assert.ok(!before.includes('serial') && !before.includes('so'));
  assert.deepEqual(errorsOf(jobSchema(before), legacy), {});
});
test('…but a field that had a value cannot be cleared', () => {
  const before = filledRequired(legacy);
  assert.deepEqual(Object.keys(errorsOf(jobSchema(before), { ...legacy, brand: '' })), ['brand']);
});
test("the 'ข้อมูลไม่ครบ' notice lists what is still missing", () =>
  assert.deepEqual(missingRequired(legacy), ['so', 'serial']));
test('legacy placeholders "0" / "-" in text fields count as empty (warranty months 0 does not)', () => {
  assert.deepEqual(missingRequired({ ...fullJob, serial: '0', so: '-' }), ['so', 'serial']);
  assert.ok(errorsOf(jobSchema(), { ...fullJob, serial: '0' }).serial);
  assert.deepEqual(missingRequired({ ...fullJob, warrantyMonth: 0 }), []);
});

console.log('\nWorkflow screens');
test('repair: status required', () => {
  assert.ok(errorsOf(repairActionSchema, { repairDetail: 'x' }).status);
  assert.deepEqual(errorsOf(repairActionSchema, { status: 'ซ่อมเสร็จ', parts: [] }), {});
});
test('repair: costs and part prices not negative; part qty whole and not negative (0 = option unused)', () => {
  const part = (unitPrice: unknown, aQty: unknown, bQty: unknown = 0) => ({
    code: 'P1',
    unitPrice,
    a: { pick: true, quote: true, qty: aQty },
    b: { pick: false, quote: false, qty: bQty },
  });
  const ok = {
    status: 'ซ่อมเสร็จ',
    serviceCost: 100,
    toolCost: '',
    deliveryCost: 0,
    boxCost: '20',
    parts: [part(50, 1)],
  };
  assert.deepEqual(errorsOf(repairActionSchema, ok), {});
  const e = errorsOf(repairActionSchema, {
    ...ok,
    serviceCost: -1,
    toolCost: -2,
    deliveryCost: -3,
    boxCost: -4,
    parts: [part(-50, 1), part(50, 1.5, -1)],
  });
  assert.deepEqual(Object.keys(e).sort(), [
    'boxCost',
    'deliveryCost',
    'parts.0.unitPrice',
    'parts.1.a.qty',
    'parts.1.b.qty',
    'serviceCost',
    'toolCost',
  ]);
  assert.equal(e.serviceCost, 'ค่าบริการการซ่อมต้องเป็นจำนวนเงิน 0–1,000,000 (ทศนิยมไม่เกิน 2 ตำแหน่ง)');
});
test('outsource: sending needs to + date; receiving back needs neither', () => {
  assert.deepEqual(Object.keys(errorsOf(outsourceActionSchema, { status: 'x', send: { to: '', date: '' } })).sort(), [
    'send.date',
    'send.to',
  ]);
  assert.deepEqual(
    errorsOf(outsourceActionSchema, { status: 'x', receive: { from: 'ร้าน A', date: '2026-09-28' } }),
    {},
  );
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x' })['send.to'], 'neither send nor receive');
});

test('outsource: ส่งโดย / รับโดย are optional user ids — never names, 0 or negatives', () => {
  const send = { to: 'ร้าน A', date: '2026-09-28' };
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: 'x', send: { ...send, by: 12 } }), {});
  assert.deepEqual(
    errorsOf(outsourceActionSchema, { status: 'x', send }),
    {},
    'left out → server uses the person saving',
  );
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', send: { ...send, by: 'สมชาย' } })['send.by']);
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', send: { ...send, by: 0 } })['send.by']);
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', receive: { date: '2026-09-28', by: -1 } })['receive.by']);
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', receive: { date: '2026-09-28', by: 1.5 } })['receive.by']);
});
test('swap needs New Serial; refund needs amount > 0 and a method', () => {
  assert.ok(errorsOf(swapRefundSchema(), { status: 'x', newSerial: '' }).newSerial);
  assert.deepEqual(errorsOf(swapRefundSchema(), { status: 'x', newSerial: 'SN0002' }), {});
  const r = errorsOf(swapRefundSchema(), { status: 'x', refundAmount: '0', refundMethod: '' });
  assert.deepEqual(Object.keys(r).sort(), ['refundAmount', 'refundMethod']);
  assert.deepEqual(errorsOf(swapRefundSchema(), { status: 'x', refundAmount: 500, refundMethod: 'โอน' }), {});
});
test('close: status, payment method, return method and return date', () => {
  const e = errorsOf(closeSchema(), { status: '', payment: { type: '' }, return: { type: '', date: '' } });
  assert.deepEqual(Object.keys(e).sort(), ['payment.type', 'return.date', 'return.type', 'status']);
  assert.deepEqual(
    errorsOf(closeSchema(), {
      status: 'ปิดงาน (Complete)',
      payment: { type: 'เงินสด' },
      return: { type: 'ลูกค้ามารับเอง', date: '2026-09-28' },
    }),
    {},
  );
});
test('close: paid amount not negative; return date a real day', () => {
  const body = {
    status: 'ปิดงาน (Complete)',
    payment: { type: 'เงินสด', amount: '-1' },
    return: { type: 'ลูกค้ามารับเอง', date: '2026-02-30' },
  };
  assert.deepEqual(Object.keys(errorsOf(closeSchema(), body)).sort(), ['payment.amount', 'return.date']);
  assert.deepEqual(
    errorsOf(closeSchema(), {
      ...body,
      payment: { type: 'เงินสด', amount: '' },
      return: { ...body.return, date: '2026-02-28' },
    }),
    {},
  );
});
test('close: "ลงเลขที่พัสดุแล้ว" needs a tracking no.; other statuses do not', () => {
  const body = {
    status: STATUS_CLOSED_TRACKED,
    payment: { type: 'เงินโอน' },
    return: { type: 'บริษัทขนส่งเอกชน', date: '2026-10-15', tracking: '  ' },
  };
  assert.deepEqual(errorsOf(closeSchema(), body), { 'return.tracking': 'ต้องระบุหมายเลขพัสดุ' });
  assert.deepEqual(errorsOf(closeSchema(), { ...body, return: { ...body.return, tracking: undefined } }), {
    'return.tracking': 'ต้องระบุหมายเลขพัสดุ',
  });
  assert.deepEqual(errorsOf(closeSchema(), { ...body, return: { ...body.return, tracking: 'TH12345678' } }), {});
  // 7 = the number is still to come
  assert.deepEqual(errorsOf(closeSchema(), { ...body, status: 'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)' }), {});
});
test('outsource: receive date not before the send date (both in the payload)', () => {
  const send = { to: 'ร้าน A', date: '2026-10-10' };
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: 'x', send, receive: { date: '2026-10-09' } }), {
    'receive.date': 'วันที่รับต้องไม่ก่อนวันที่ส่ง',
  });
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: 'x', send, receive: { date: '2026-10-10' } }), {});
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: 'x', send, receive: { date: '' } }), {});
});
test('amount due at close = job total - deposit, never below 0', () => {
  assert.equal(jobAmountDue(830, 100), 730);
  assert.equal(jobAmountDue(1234.56, 0), 1234.56);
  assert.equal(jobAmountDue(100, 250), 0);
  assert.equal(jobAmountDue(0.3, 0.1), 0.2); // no float dust (0.19999999999999998)
});
test('outsource: send / receive dates must be real days', () => {
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', send: { to: 'ร้าน A', date: '2026-02-30' } })['send.date']);
  assert.ok(errorsOf(outsourceActionSchema, { status: 'x', receive: { date: '2026-02-30' } })['receive.date']);
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: 'x', receive: { date: '', detail: 'ok' } }), {});
});

console.log('\nCustomer');
test('name and phone required for a new customer', () => {
  assert.deepEqual(Object.keys(errorsOf(customerSchema(), { name: ' ', phone: '' })).sort(), ['name', 'phone']);
  assert.deepEqual(errorsOf(customerSchema(), { name: 'สมชาย', phone: '0812345678', email: '' }), {});
});
test('an old customer without a phone may stay without one', () =>
  assert.deepEqual(errorsOf(customerSchema({ phone: '' }), { name: 'สมชาย', phone: '' }), {}));
test('email must be a real address when given', () => {
  assert.ok(errorsOf(customerSchema(), { name: 'a', phone: '0812345678', email: 'abc' }).email);
  assert.deepEqual(errorsOf(customerSchema(), { name: 'a', phone: '0812345678', email: 'a@b.co' }), {});
});
test('phone / postcode / tax ID: digits, not letters (legacy formats with dashes and two numbers still pass)', () => {
  const e = (x: Record<string, string>) => errorsOf(customerSchema(), { name: 'a', ...x });
  for (const ok of ['0812345678', '081-234-5678', '081 234 5678', '+66 81 234 5678', '02-123-4567 / 081-234-5678'])
    assert.deepEqual(e({ phone: ok }), {}, ok);
  for (const bad of ['abcdefg', '0812', '081-ABC-5678']) assert.ok(e({ phone: bad }).phone, bad);
  assert.ok(e({ phone: '0812345678', postalCode: 'abc' }).postalCode);
  assert.deepEqual(e({ phone: '0812345678', postalCode: '10110' }), {});
  assert.ok(e({ phone: '0812345678', taxId: '12345' }).taxId);
  assert.deepEqual(e({ phone: '0812345678', taxId: '1-2345-67890-12-1' }), {}); // dashes allowed, check digit 1
});
test('a 409 clash becomes a message under the clashing field', () => {
  const e = conflictErrors([{ field: 'phone', code: 'C00001', name: 'สมชาย' }]);
  assert.match(e.phone, /C00001/);
});

console.log('\nQuotation');
const q = {
  customerCode: 'C00001',
  jobNo: 'J2612164',
  lines: [{ qty: 1, unitPrice: 100 }],
  serviceAmount: 0,
  discountValue: 0,
  vatRate: 7,
};
test('a complete quotation passes; no lines at all is allowed', () => {
  assert.deepEqual(errorsOf(quotationSchema(), q), {});
  assert.deepEqual(errorsOf(quotationSchema(), { ...q, lines: [] }), {});
});
test('customer + job no required for a new one; an old one without a job may stay without', () => {
  assert.deepEqual(Object.keys(errorsOf(quotationSchema(), { ...q, customerCode: '', jobNo: '' })).sort(), [
    'customerCode',
    'jobNo',
  ]);
  assert.deepEqual(errorsOf(quotationSchema(''), { ...q, jobNo: '' }), {});
  assert.ok(errorsOf(quotationSchema(''), { ...q, jobNo: 'abc' }).jobNo, 'a given job no must still look like one');
});
test('numbers: qty > 0 per row, no negatives, discount and VAT ≤ 100', () => {
  const e = errorsOf(quotationSchema(), {
    ...q,
    lines: [
      { qty: 1, unitPrice: 5 },
      { qty: 0, unitPrice: -1 },
    ],
    serviceAmount: -5,
    discountValue: 120,
    vatRate: -7,
  });
  assert.deepEqual(Object.keys(e).sort(), [
    'discountValue',
    'lines.1.qty',
    'lines.1.unitPrice',
    'serviceAmount',
    'vatRate',
  ]);
});

console.log('\nSale order');
const so = {
  customerCode: 'C00001',
  salesId: 7,
  lines: [{ code: 'P00001', qty: 1, price: 100 }],
  paymentAmount: '',
  fee: 0,
};
test('a complete order passes', () => assert.deepEqual(errorsOf(saleOrderSchema(), so), {}));
test('customer, salesperson and a product line are required', () => {
  assert.deepEqual(Object.keys(errorsOf(saleOrderSchema(), { customerCode: '', salesId: 0, lines: [] })).sort(), [
    'customerCode',
    'lines',
    'salesId',
  ]);
  assert.ok(
    errorsOf(saleOrderSchema(), { ...so, lines: [{ code: '', qty: 1 }] }).lines,
    'a line without a product does not count',
  );
});
test('qty > 0 per row; price and paid amount not negative', () => {
  const e = errorsOf(saleOrderSchema(), { ...so, lines: [{ code: 'P1', qty: 0, price: -1 }], paymentAmount: -5 });
  assert.deepEqual(Object.keys(e).sort(), ['lines.0.price', 'lines.0.qty', 'paymentAmount']);
});
test('qty a whole number (1.5 used to be cut to 1); salesperson id whole', () => {
  assert.equal(
    errorsOf(saleOrderSchema(), { ...so, lines: [{ code: 'P1', qty: 1.5 }] })['lines.0.qty'],
    'จำนวนต้องเป็นจำนวนเต็ม 1–1000',
  );
  assert.deepEqual(errorsOf(saleOrderSchema(), { ...so, lines: [{ code: 'P1', qty: '2' }] }), {});
  assert.ok(errorsOf(saleOrderSchema(), { ...so, salesId: 7.5 }).salesId);
});

console.log('\nBack office');
test('document / shipping profile: code + Thai name; tracking link https with {no}', () => {
  assert.deepEqual(errorsOf(documentProfileSchema, { code: ' ', nameTh: '' }), {
    code: 'ต้องระบุรหัสโปรไฟล์ (เช่น SHD)',
    nameTh: 'ต้องระบุชื่อบริษัท',
  });
  assert.deepEqual(errorsOf(documentProfileSchema, { code: 'SHD', nameTh: 'บริษัท' }), {});
  assert.deepEqual(Object.keys(errorsOf(shippingProfileSchema, {})).sort(), ['code', 'nameTh']);
  const ship = { code: 'FLASH', nameTh: 'แฟลช' };
  assert.deepEqual(errorsOf(shippingProfileSchema, { ...ship, trackUrl: '' }), {});
  assert.deepEqual(errorsOf(shippingProfileSchema, { ...ship, trackUrl: 'https://x.test/?no={no}' }), {});
  assert.ok(errorsOf(shippingProfileSchema, { ...ship, trackUrl: 'http://x.test/?no={no}' }).trackUrl);
  assert.ok(errorsOf(shippingProfileSchema, { ...ship, trackUrl: 'https://x.test/' }).trackUrl);
});
test("master list row: the name, in the list's own words", () => {
  assert.equal(errorsOf(masterSchema('ชื่อหมวดหมู่'), { name: ' ' }).name, 'ต้องระบุชื่อหมวดหมู่');
  assert.deepEqual(errorsOf(masterSchema(), { name: 'สายไฟ' }), {});
});
test('job type SLA: whole days 1–365, required; other masters have no days field', () => {
  const sla = masterSchema('ประเภทงานซ่อม', { days: true });
  assert.deepEqual(errorsOf(sla, { name: 'งานซ่อม', days: '8' }), {});
  assert.equal(errorsOf(sla, { name: 'งานซ่อม', days: '' }).days, 'ต้องระบุ SLA (วัน)');
  for (const bad of ['0', '366', '2.5', 'abc', '-1'])
    assert.ok(errorsOf(sla, { name: 'งานซ่อม', days: bad }).days, bad);
  assert.deepEqual(errorsOf(masterSchema(), { name: 'สายไฟ', days: 'abc' }), {});
});
test('model: name, brand, price present (0 allowed) and not negative', () => {
  assert.deepEqual(Object.keys(errorsOf(modelSchema, { name: '', brand: '', price: '' })).sort(), [
    'brand',
    'name',
    'price',
  ]);
  assert.deepEqual(errorsOf(modelSchema, { name: 'X10', brand: 'Dreame', price: '0' }), {});
  assert.ok(errorsOf(modelSchema, { name: 'X10', brand: 'Dreame', price: '-1' }).price);
});
test('user: name + role; email real when given', () => {
  assert.deepEqual(Object.keys(errorsOf(userSchema(), { name: '', role: '' })).sort(), ['name', 'role']);
  assert.ok(errorsOf(userSchema(), { name: 'a', role: 'Engineer', email: 'x@' }).email);
});
test('spare part: Thai name; prices not negative', () => {
  assert.ok(errorsOf(productSchema(), { name: '' }).name);
  assert.deepEqual(
    Object.keys(errorsOf(productSchema(), { name: 'แบต', capitalPrice: '-1', wholesalePrice: '', price: '-5' })).sort(),
    ['capitalPrice', 'price'],
  );
});

console.log('\nSummary title');
test('toast title says missing / wrong / both', () => {
  assert.equal(
    summary({ a: 'ต้องเลือกลูกค้า', b: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ', c: 'โปรดระบุสถานะงาน' }),
    'กรอกข้อมูลไม่ครบ 3 ช่อง',
  );
  assert.equal(summary({ a: 'จำนวนต้องมากกว่า 0' }), 'ข้อมูลไม่ถูกต้อง 1 ช่อง');
  assert.equal(summary({ a: 'ต้องเลือกลูกค้า', b: 'จำนวนต้องมากกว่า 0' }), 'กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง 2 ช่อง');
});

console.log('\nAPI called with missing keys');
test('an empty body still reports every rule (no early stop)', () => {
  assert.deepEqual(Object.keys(errorsOf(quotationSchema(), {})).sort(), ['customerCode', 'jobNo']);
  assert.deepEqual(Object.keys(errorsOf(customerSchema(), {})).sort(), ['name', 'phone']);
  assert.deepEqual(Object.keys(errorsOf(outsourceActionSchema, {})).sort(), ['send.to', 'status']);
  assert.deepEqual(Object.keys(errorsOf(swapRefundSchema(), {})).sort(), ['newSerial', 'status']);
  assert.deepEqual(Object.keys(errorsOf(saleOrderSchema(), {})).sort(), ['customerCode', 'lines', 'salesId']);
});

console.log('\nStock / assign / approve / call-log bodies (routes that had no schema)');
const ok = (schema: Parameters<typeof validate>[0], data: unknown) => validate(schema, data).ok;
test("qty: whole numbers 0–100,000 only (1.5 / -1 / 1e9 / 'abc' refused, '3' accepted)", () => {
  const body = (qty: unknown) => ({ date: '2026-10-01', lines: [{ code: 'P00001', qty }] });
  assert.equal(ok(receiveSchema, body(3)), true);
  assert.equal(ok(receiveSchema, body('3')), true);
  assert.equal(ok(receiveSchema, body(0)), true); // 0 = skip line, the service filters it
  for (const bad of [1.5, -1, 1e9, 'abc']) assert.equal(ok(receiveSchema, body(bad)), false, String(bad));
});
test('receive / issue need 1–500 lines; issue type is one of four', () => {
  assert.equal(ok(receiveSchema, { date: '2026-10-01', lines: [] }), false);
  assert.equal(ok(receiveSchema, {}), false);
  assert.equal(ok(receiveSchema, { lines: Array.from({ length: 501 }, () => ({ code: 'P1', qty: 1 })) }), false);
  assert.equal(
    ok(issueSchema, {
      type: 'job',
      ref: 'J2600001',
      payTo: 'ช่าง A',
      lines: [{ logId: 5, dtId: null, code: null, qty: 1 }],
    }),
    true,
  );
  assert.equal(ok(issueSchema, { type: 'steal', lines: [{ code: 'P1', qty: 1 }] }), false);
});
test('receive: date required and a real day (the page prefills today)', () => {
  const lines = [{ code: 'P1', qty: 1 }];
  assert.equal(errorsOf(receiveSchema, { lines }).date, 'ต้องระบุวันที่รับเข้า');
  assert.equal(errorsOf(receiveSchema, { date: '', lines }).date, 'ต้องระบุวันที่รับเข้า');
  assert.equal(errorsOf(receiveSchema, { date: 'abc', lines }).date, 'ต้องระบุวันที่รับเข้า');
  assert.equal(errorsOf(receiveSchema, { date: '2026-02-30', lines }).date, 'วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)');
  assert.deepEqual(errorsOf(receiveSchema, { date: '2026-10-01', lines }), {});
});
test('issue: จ่ายให้ / รับคืนจาก required (message by type), trimmed, max 50 — reported with other errors', () => {
  const lines = [{ code: 'P1', qty: 1 }];
  for (const type of ['job', 'sale', 'other'])
    assert.equal(errorsOf(issueSchema, { type, lines }).payTo, 'ต้องเลือก จ่ายให้', type);
  assert.equal(errorsOf(issueSchema, { type: 'return', payTo: '  ', lines }).payTo, 'ต้องเลือก รับคืนจาก');
  assert.equal(errorsOf(issueSchema, { type: 'other', payTo: null, lines }).payTo, 'ต้องเลือก จ่ายให้');
  assert.ok(errorsOf(issueSchema, { type: 'other', payTo: 'x'.repeat(51), lines }).payTo);
  assert.deepEqual(Object.keys(errorsOf(issueSchema, { type: 'other', lines: [] })).sort(), ['lines', 'payTo']);
  const v = validate(issueSchema, { type: 'other', payTo: ' คลังสินค้าดี ', lines });
  assert.ok(v.ok && v.data.payTo === 'คลังสินค้าดี', 'trimmed');
});
test('SO decision is approve | deny | reject — a typo is refused, not treated as reject', () => {
  assert.equal(ok(approveSchema, { decision: 'approve' }), true);
  assert.equal(ok(approveSchema, { decision: 'approvee' }), false);
  assert.equal(ok(approveSchema, {}), false);
});
test('assign needs jobs + an engineer id; call log needs text', () => {
  assert.equal(ok(assignSchema, { jobNos: ['J2600001'], engineerId: '12' }), true);
  assert.equal(ok(assignSchema, { jobNos: [], engineerId: 12 }), false);
  assert.equal(ok(assignSchema, { jobNos: ['J1'], engineerId: 0 }), false);
  assert.equal(ok(callLogSchema, { detail: '   ' }), false);
  assert.equal(ok(callLogSchema, { detail: 'x'.repeat(201) }), false); // the column is varchar(200)
  assert.equal(ok(callLogSchema, { detail: 'x'.repeat(200) }), true);
});

console.log('\nUploaded files are what their type says (src/server/storage.ts fileProblem)');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new TextEncoder().encode('%PDF-1.7\n');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const fileChecks: [string, File, boolean][] = [
  ['real PNG', new File([PNG], 'a.png', { type: 'image/png' }), true],
  ['real PDF', new File([PDF], 'a.pdf', { type: 'application/pdf' }), true],
  ['SVG renamed .png', new File([SVG], 'evil.png', { type: 'image/png' }), false],
  ['HTML declared as PDF', new File(['<html>'], 'x.pdf', { type: 'application/pdf' }), false],
  ['no type at all', new File([PNG], 'a', { type: '' }), false],
  ['empty file', new File([], 'a.png', { type: 'image/png' }), false],
  ['SVG type', new File([SVG], 'a.svg', { type: 'image/svg+xml' }), false],
];
for (const [name, file, accepted] of fileChecks) {
  const problem = await fileProblem(file);
  test(`${name} → ${accepted ? 'accepted' : 'refused'}`, () => assert.equal(problem === null, accepted, problem ?? ''));
}
const pdfAsImage = await fileProblem(new File([PDF], 'a.pdf', { type: 'application/pdf' }), new Set(['image/png']));
test('images-only kinds refuse a real PDF', () => assert.ok(pdfAsImage));

console.log('\nQuery params cannot crash a list (src/server/paging.ts)');
test('limit: junk / NaN → default, else clamped to 1..max', () => {
  assert.equal(clampInt(null, 300, 1000), 300);
  assert.equal(clampInt('abc', 300, 1000), 300);
  assert.equal(clampInt('NaN', 50, 1000), 50);
  assert.equal(clampInt('99999999', 50, 1000), 1000);
  assert.equal(clampInt('-5', 50, 1000), 1);
  assert.equal(clampInt('40', 50, 1000), 40);
});
test('sort key must be an own key of the column map', () => {
  const fallback = [sql`1`];
  const map = { name: sql`name` };
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    assert.equal(orderBy({ key, dir: 'asc' }, map, fallback), fallback);
  assert.equal(orderBy({ key: 'name', dir: 'desc' }, map, fallback).length, 2);
});
test('dates: only real YYYY-MM-DD pass, anything else = no filter', () => {
  assert.equal(ymd('2026-10-14'), '2026-10-14');
  assert.equal(ymd('2024-02-29'), '2024-02-29');
  for (const bad of [
    undefined,
    '',
    '2026-02-30',
    '2026-13-01',
    '0000-01-01',
    '2026-1-5',
    "2026-10-14'; --",
    'yesterday',
  ])
    assert.equal(ymd(bad), undefined, String(bad));
});

// ==== legacy data: phones / quotation discounts (agent B, 2026-10-15) ====
console.log('\nLegacy data: invisible characters in phones, บาท discounts on quotations');
{
  const { normalizePhone } = await import('../src/lib/validation/customer.ts');
  const { parseDiscount, computeTotals } = await import('../src/lib/validation/quotation.ts');
  test('phone: zero-width / bidi / BOM stripped, en/em dash → "-", trimmed — then the rule passes', () => {
    assert.equal(normalizePhone(' 081\u200B-234\u2060-5678\uFEFF '), '081-234-5678');
    assert.equal(normalizePhone('\u202A02\u2013123\u20144567\u202C'), '02-123-4567');
    assert.equal(normalizePhone(undefined), '');
    assert.deepEqual(errorsOf(customerSchema(), { name: 'ก', phone: '081\u200B2345678\u200F' }), {});
    // a landline only: fine on an existing customer (a NEW one must also give a mobile — see agent P)
    assert.deepEqual(
      errorsOf(customerSchema({ phone: '0800000000' }), { name: 'ก', phone: '02\u2013123\u20134567' }),
      {},
    );
  });
  test('phone: text in the phone is still refused; only invisible characters = empty = required', () => {
    assert.ok(errorsOf(customerSchema(), { name: 'ก', phone: 'คุณตูน 0922798963' }).phone);
    assert.equal(errorsOf(customerSchema(), { name: 'ก', phone: '\u200B\uFEFF' }).phone, 'ต้องระบุเบอร์โทรศัพท์');
  });
  test('discount: the record\'s own unit and base are kept ("200บาท" on parts, "15%" on parts)', () => {
    assert.deepEqual(parseDiscount('ส่วนลดค่าอะไหล่', '200บาท'), { type: 'ส่วนลดค่าอะไหล่', value: 200, unit: 'บาท' });
    assert.deepEqual(parseDiscount('ส่วนลดรวม', '9.5%'), { type: 'ส่วนลดรวม', value: 9.5, unit: '%' });
    assert.deepEqual(parseDiscount('ไม่มีส่วนลด', '0บาท'), { type: 'ส่วนลดรวม', value: 0, unit: '%' });
    // Q2300006: 1500 parts, 200 บาท off the parts → 1300; Q2501491: 15 % of 800 parts (not of 1200) = 120
    const base = { service: 0, vatRate: 0 };
    assert.equal(
      computeTotals({ ...base, parts: 1500, ...disc(parseDiscount('ส่วนลดค่าอะไหล่', '200บาท')) }).net,
      1300,
    );
    assert.equal(
      computeTotals({ ...base, parts: 800, service: 400, ...disc(parseDiscount('ส่วนลดค่าอะไหล่', '15%')) }).discount,
      120,
    );
  });
  test('discount: over 100 is refused as %, allowed as บาท', () => {
    const q = { customerCode: 'C1', jobNo: 'J2612164' };
    assert.deepEqual(errorsOf(quotationSchema(), { ...q, discountValue: 1500, discountUnit: 'บาท' }), {});
    assert.equal(
      errorsOf(quotationSchema(), { ...q, discountValue: 150, discountUnit: '%' }).discountValue,
      'ส่วนลดต้องไม่เกิน 100',
    );
  });
  function disc(d: ReturnType<typeof parseDiscount>) {
    return { discountType: d.type, discountValue: d.value, discountUnit: d.unit };
  }
}

// ==== field formats: products / customers / quotation / sale order / stock / admin (agent P, 2026-10-15) ====
console.log('\nField formats (agent P): products, customers, quotation, sale order, stock, admin');
{
  const { cleanMfgCode } = await import('../src/lib/validation/admin.ts');
  const { isThaiTaxId } = await import('../src/lib/validation/customer.ts');
  const { trackingSchema } = await import('../src/lib/validation/stock.ts');
  const { today, addDays } = await import('../src/lib/dates.ts');
  const part = { name: 'แบตเตอรี่' };
  const mfgErr = (mfgCode: unknown, prev?: string) =>
    errorsOf(productSchema(prev ? { mfgCode: prev } : null), { ...part, mfgCode }).mfgCode;

  test('รหัสผู้ผลิต: one code of A-Z 0-9 . _ / - (owner decision)', () => {
    for (const good of ['2A190159R', 'RS-1/2.3_X', 'a1b2', '  2a190159r  ', '', null, undefined])
      assert.equal(mfgErr(good), undefined, String(good));
    for (const bad of ['อะไหล่-JIMMY JV85', 'A,B', 'A B', 'Cancel_X', 'CANCEL_2A19', '/A', 'x'.repeat(51), 'ABC#1'])
      assert.ok(mfgErr(bad), bad);
    assert.match(mfgErr('A,B') ?? '', /A-Z 0-9 \. _ \/ -/);
  });
  test('รหัสผู้ผลิต: "-" means none, lower-case is stored upper-case, look-alikes folded', () => {
    assert.equal(mfgErr('-'), undefined);
    assert.equal(cleanMfgCode(' - '), '');
    assert.equal(cleanMfgCode('2a190159r'), '2A190159R');
    assert.equal(cleanMfgCode('\u200B2A19\u0410'), '2A19A'); // zero-width space + Cyrillic А
  });
  test('รหัสผู้ผลิต: an unchanged legacy value still saves; changing it must follow the rule', () => {
    assert.equal(mfgErr('อะไหล่-JIMMY JV85', 'อะไหล่-jimmy JV85'), undefined);
    assert.equal(mfgErr('Cancel_2A19', 'Cancel_2A19'), undefined);
    assert.ok(mfgErr('อะไหล่-JIMMY JV86', 'อะไหล่-jimmy JV85'));
  });
  test('product: names within their columns, money 0–1,000,000, retail not below capital', () => {
    assert.ok(errorsOf(productSchema(), { name: 'x'.repeat(501) }).name);
    assert.deepEqual(errorsOf(productSchema(), { name: 'x'.repeat(500), nameEn: 'y'.repeat(200) }), {});
    for (const k of ['nameEn', 'nameCn', 'description'])
      assert.ok(errorsOf(productSchema(), { ...part, [k]: 'y'.repeat(201) })[k], k);
    assert.ok(errorsOf(productSchema(), { ...part, price: '1000000.01' }).price);
    assert.ok(errorsOf(productSchema(), { ...part, capitalPrice: '1.234' }).capitalPrice);
    assert.equal(
      errorsOf(productSchema(), { ...part, capitalPrice: '500', price: '400' }).price,
      'ราคาขายปลีกต้องไม่ต่ำกว่าราคาทุน',
    );
    assert.deepEqual(errorsOf(productSchema(), { ...part, capitalPrice: '500', price: '0' }), {});
  });

  const cust = { name: 'สมชาย', phone: '0812345678' };
  test('customer: name 1–200, not only digits (an unchanged legacy name passes)', () => {
    assert.ok(errorsOf(customerSchema(), { ...cust, name: '0812345678' }).name);
    assert.ok(errorsOf(customerSchema(), { ...cust, name: 'ก'.repeat(201) }).name);
    assert.deepEqual(
      errorsOf(customerSchema({ name: '123456', phone: '0812345678' }), { ...cust, name: '123456' }),
      {},
    );
  });
  test('customer: a new one needs a Thai mobile; an existing one is checked only when the phone changes', () => {
    assert.match(errorsOf(customerSchema(), { ...cust, phone: '02-123-4567' }).phone ?? '', /มือถือ/);
    assert.deepEqual(errorsOf(customerSchema(), { ...cust, phone: '02-123-4567 / 081-234-5678' }), {});
    assert.deepEqual(errorsOf(customerSchema(), { ...cust, phone: '+66 81 234 5678' }), {});
    const legacy = { name: 'สมชาย', phone: 'คุณตูน 0922798963' };
    assert.deepEqual(errorsOf(customerSchema(legacy), { ...legacy, email: 'a@b.co' }), {}, 'legacy phone untouched');
    assert.ok(errorsOf(customerSchema(legacy), { ...legacy, phone: 'คุณตูน' }).phone, 'changed to junk');
    assert.equal(errorsOf(customerSchema(legacy), { ...legacy, phone: '' }).phone, 'ต้องระบุเบอร์โทรศัพท์');
  });
  test('customer: tax ID 13 digits with a valid check digit (legacy unchanged passes)', () => {
    assert.equal(isThaiTaxId('1234567890121'), true);
    assert.equal(isThaiTaxId('1234567890123'), false);
    assert.match(errorsOf(customerSchema(), { ...cust, taxId: '1234567890123' }).taxId ?? '', /หลักสุดท้าย/);
    assert.deepEqual(errorsOf(customerSchema(), { ...cust, taxId: '1 2345 67890 12 1' }), {});
    assert.deepEqual(errorsOf(customerSchema({ ...cust, taxId: '0-1234' }), { ...cust, taxId: '0-1234' }), {});
  });
  test('customer: email ≤ 50, Line ID, address ≤ 100, type / price group from the lists', () => {
    assert.ok(errorsOf(customerSchema(), { ...cust, email: `${'a'.repeat(45)}@b.com` }).email);
    assert.deepEqual(errorsOf(customerSchema(), { ...cust, email: ' A@B.CO ' }), {});
    assert.deepEqual(errorsOf(customerSchema(), { ...cust, line: '@shd.th' }), {});
    assert.ok(errorsOf(customerSchema(), { ...cust, line: 'ไลน์ ของฉัน' }).line);
    assert.deepEqual(errorsOf(customerSchema({ ...cust, line: 'ไลน์ เก่า' }), { ...cust, line: 'ไลน์ เก่า' }), {});
    assert.ok(errorsOf(customerSchema(), { ...cust, address1: 'ก'.repeat(101) }).address1);
    assert.ok(errorsOf(customerSchema(), { ...cust, type: 'x'.repeat(60) }).type);
    assert.ok(errorsOf(customerSchema(), { ...cust, priceGroup: 'VIP' }).priceGroup);
    assert.deepEqual(
      errorsOf(customerSchema(), { ...cust, type: 'Dealer', priceGroup: 'ขายส่ง (Wholesale Price)' }),
      {},
    );
  });

  const qq = { customerCode: 'C00001', jobNo: 'J2612164', lines: [{ qty: 1, unitPrice: 100 }], vatRate: 7 };
  test('quotation: job no J + 7 digits (lower-case accepted), qty whole 1–9999, VAT 0 or 7', () => {
    assert.deepEqual(errorsOf(quotationSchema(), { ...qq, jobNo: ' j2612164 ' }), {});
    assert.ok(errorsOf(quotationSchema(), { ...qq, jobNo: 'JB12345' }).jobNo);
    for (const bad of [1.5, 0, 10000, '1e2'])
      assert.ok(errorsOf(quotationSchema(), { ...qq, lines: [{ qty: bad }] })['lines.0.qty'], String(bad));
    assert.ok(errorsOf(quotationSchema(), { ...qq, vatRate: 5 }).vatRate);
    assert.deepEqual(errorsOf(quotationSchema(), { ...qq, vatRate: 0 }), {});
  });
  test('quotation: money ≤ 1,000,000; contact / line detail ≤ 100; remark ≤ 1000', () => {
    assert.ok(errorsOf(quotationSchema(), { ...qq, lines: [{ qty: 1, unitPrice: 1e9 }] })['lines.0.unitPrice']);
    assert.ok(errorsOf(quotationSchema(), { ...qq, contactName: 'ก'.repeat(101) }).contactName);
    assert.ok(errorsOf(quotationSchema(), { ...qq, lines: [{ qty: 1, detail: 'ก'.repeat(101) }] })['lines.0.detail']);
    assert.ok(errorsOf(quotationSchema(), { ...qq, remark: 'ก'.repeat(1001) }).remark);
    assert.deepEqual(errorsOf(quotationSchema(), { ...qq, remark: 'ก'.repeat(1000) }), {});
  });

  const order = { customerCode: 'C00001', salesId: 7, lines: [{ code: 'P1', qty: 1, price: 100 }] };
  test('sale order: qty 1–1000, paid ≤ 10,000,000 (1e9 was a 500), remark ≤ 100, payment type from the list', () => {
    assert.ok(errorsOf(saleOrderSchema(), { ...order, lines: [{ code: 'P1', qty: 1001 }] })['lines.0.qty']);
    assert.ok(errorsOf(saleOrderSchema(), { ...order, paymentAmount: 1e9 }).paymentAmount);
    // the cap holds on an order big enough to be paid 10,000,000 (paying more than the total is refused — round 3)
    assert.deepEqual(
      errorsOf(saleOrderSchema(), {
        ...order,
        lines: [{ code: 'P1', qty: 1000, price: 10000 }],
        paymentType: 'โอนเงิน',
        paymentAmount: '10000000',
      }),
      {},
    );
    assert.ok(errorsOf(saleOrderSchema(), { ...order, remark: 'ก'.repeat(101) }).remark);
    assert.ok(errorsOf(saleOrderSchema(), { ...order, paymentType: 'บิทคอยน์' }).paymentType);
    assert.deepEqual(
      errorsOf(saleOrderSchema({ paymentType: 'ยังไม่ชำระเงิน' }), { ...order, paymentType: 'ยังไม่ชำระเงิน' }),
      {},
    );
  });
  test('sale order tracking: A-Z 0-9 - 6–40 (spaces dropped), a legacy one unchanged passes', () => {
    const t = (tracking: string, prev?: string) => errorsOf(trackingSchema(prev), { tracking }).tracking;
    assert.equal(t('TH 0123 4567 89'), undefined);
    assert.equal(t(''), undefined);
    for (const bad of ['ไรเดอร์มาส่ง', 'AB12', 'x'.repeat(41), 'TH01/2345']) assert.ok(t(bad), bad);
    assert.equal(t('ไรเดอร์มาส่ง', 'ไรเดอร์มาส่ง'), undefined);
  });

  const lines = [{ code: 'P1', qty: 1 }];
  test('receive: PO ref ≤ 50 of A-Z 0-9 / - (51 refused, not cut); supplier ≤ 40, remark ≤ 47; not a future date', () => {
    const r = (x: Record<string, unknown>) => errorsOf(receiveSchema, { date: today(), lines, ...x });
    assert.deepEqual(r({ poRef: 'po-2600/01' }), {});
    assert.ok(r({ poRef: 'P'.repeat(51) }).poRef);
    assert.ok(r({ poRef: 'ใบสั่งซื้อ 1' }).poRef);
    assert.ok(r({ supplier: 'ก'.repeat(41) }).supplier);
    assert.ok(r({ remark: 'ก'.repeat(48) }).remark);
    assert.equal(r({ date: addDays(today(), 1) }).date, 'วันที่รับเข้าต้องไม่เกินวันนี้');
  });
  test('pick: job ref J + 7 digits, SO ref SO + digits; remark ≤ 100; approve remark ≤ 100', () => {
    const i = (x: Record<string, unknown>) => errorsOf(issueSchema, { payTo: 'คลังสินค้าดี', lines, ...x });
    assert.deepEqual(i({ type: 'job', ref: 'J2600001' }), {});
    assert.ok(i({ type: 'job', ref: 'SO2600001' }).ref);
    assert.ok(i({ type: 'return', ref: 'J26' }).ref);
    assert.deepEqual(i({ type: 'sale', ref: 'SO2600001' }), {});
    assert.ok(i({ type: 'sale', ref: 'J2600001' }).ref);
    assert.ok(i({ type: 'other', remark: 'ก'.repeat(101) }).remark);
    assert.ok(errorsOf(approveSchema, { decision: 'deny', remark: 'ก'.repeat(101) }).remark);
  });

  const user = { name: 'สมชาย ใจดี', role: 'Engineer' };
  test('user: username / phone format (legacy unchanged passes), email ≤ 100, name parts ≤ 50', () => {
    assert.deepEqual(errorsOf(userSchema(), { ...user, username: 'somchai.j', phone: '081-234-5678' }), {});
    assert.ok(errorsOf(userSchema(), { ...user, username: 'User dokma' }).username);
    assert.deepEqual(errorsOf(userSchema({ username: 'User dokma' }), { ...user, username: 'User dokma' }), {});
    assert.ok(errorsOf(userSchema(), { ...user, phone: '12345' }).phone);
    assert.ok(errorsOf(userSchema(), { ...user, email: `${'a'.repeat(95)}@b.com` }).email);
    assert.ok(errorsOf(userSchema(), { ...user, name: 'ก'.repeat(51) }).name);
    assert.ok(errorsOf(userSchema(), { ...user, code: 'x'.repeat(51), branch: 'x'.repeat(101) }).code);
  });
  test('document / shipping profile: code, tax ID check digit, bank account, sort order 0–999, link ≤ 300', () => {
    const dp = { code: 'SHD', nameTh: 'บริษัท' };
    assert.ok(errorsOf(documentProfileSchema, { ...dp, code: 'S' }).code);
    assert.ok(errorsOf(documentProfileSchema, { ...dp, code: 'SHD!' }).code);
    assert.ok(errorsOf(documentProfileSchema, { ...dp, taxId: '1234567890123' }).taxId);
    assert.deepEqual(
      errorsOf(documentProfileSchema, { ...dp, taxId: '1234567890121', bankAccountNo: '123-4-56789-0' }),
      {},
    );
    assert.ok(errorsOf(documentProfileSchema, { ...dp, bankAccountNo: '123' }).bankAccountNo);
    assert.ok(errorsOf(documentProfileSchema, { ...dp, sortOrder: 1.5 }).sortOrder);
    assert.ok(errorsOf(documentProfileSchema, { ...dp, email: 'x@' }).email);
    assert.ok(errorsOf(documentProfileSchema, { ...dp, phone: 'โทร' }).phone);
    const sp = { code: 'FLASH', nameTh: 'แฟลช' };
    assert.ok(errorsOf(shippingProfileSchema, { ...sp, trackUrl: `https://x.test/{no}${'a'.repeat(290)}` }).trackUrl);
    assert.ok(errorsOf(shippingProfileSchema, { ...sp, sortOrder: 1000 }).sortOrder);
  });
}

console.log('\nField formats (agent J): jobs, workflow screens, call log, masters');
{
  // an edit of an old job: what it stores now (prev) + when it was opened
  const editOf = (prev: Record<string, unknown>, openDate = '2025-01-10') => {
    const v = { ...fullJob, ...prev };
    return { v, schema: jobSchema(filledRequired(v), { prev: v, openDate }) };
  };
  test('J: Sale Order No. — A-Z 0-9 / . _ -, 4–50, not all zeros; lower case / spaces are cleaned', () => {
    for (const good of ['SO2600760', 'so-2600760', ' 2600760/1 ', 'INV.123_A'])
      assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, so: good }), {}, good);
    for (const bad of ['SO', '0000', 'ไม่มี SO', 'SO 123', 'S'.repeat(51), '#123'])
      assert.ok(errorsOf(jobSchema(), { ...fullJob, so: bad }).so, bad);
  });
  test('J: Serial — 4–50 of A-Z 0-9 / . _ : -, a typed "S/N:" prefix is dropped; Thai notes refused', () => {
    for (const good of ['W2210A35FEU0026005', 'sn: ABC123', 'S/N:ABC123', 'BX8/03E-JC3100321'])
      assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, serial: good }), {}, good);
    for (const bad of ['SN เสียหาย', 'รอ SN จากลูกค้า', 'AB', 'BX8 03E', 'X'.repeat(51)])
      assert.ok(errorsOf(jobSchema(), { ...fullJob, serial: bad }).serial, bad);
    assert.equal(cleanSerial(' s/n : abc123 '), 'ABC123');
    assert.equal(cleanSerial('SN12345'), 'SN12345', 'no colon = part of the serial');
  });
  test('J: "ไม่มี S/N / S/N เสียหาย" stores "-" and fills the required Serial; a typed "0" does not', () => {
    assert.equal(NO_SERIAL, '-');
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, serial: NO_SERIAL }), {});
    assert.equal(isRequiredFilled('serial', NO_SERIAL), true);
    assert.equal(isRequiredFilled('serial', '0'), false);
    assert.equal(isRequiredFilled('so', '-'), false, '"-" is still the empty placeholder for SO / Channel');
    assert.equal(isRequiredFilled('channel', 'ยังไม่ระบุ'), false, '"ยังไม่ระบุ" = empty');
  });
  test('J: legacy SO / serial / IMEI / tracking no saved unchanged pass; changed to junk → error under the field', () => {
    const junk = { so: '0', serial: 'SN เสียหาย', imei: '-', receptionTrackingNo: 'ไรเดอร์มาส่ง' };
    const { v, schema } = editOf(junk);
    assert.deepEqual(errorsOf(schema, v), {});
    assert.deepEqual(errorsOf(schema, { ...v, so: ' 0 ' }), {}, 'spaces around the stored value');
    assert.deepEqual(Object.keys(errorsOf(schema, { ...v, serial: 'SN หาย' })), ['serial']);
    assert.deepEqual(Object.keys(errorsOf(schema, { ...v, imei: '12345' })), ['imei']);
    assert.deepEqual(Object.keys(errorsOf(schema, { ...v, receptionTrackingNo: 'มาส่งเอง' })), ['receptionTrackingNo']);
    assert.deepEqual(Object.keys(errorsOf(schema, { ...v, so: 'ไม่มี' })), ['so']);
  });
  test('J: IMEI optional, 15 digits; reception tracking no 6–40 of A-Z 0-9 - (spaces dropped)', () => {
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, imei: '', receptionTrackingNo: '' }), {});
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, imei: '351234567890123' }), {});
    assert.ok(errorsOf(jobSchema(), { ...fullJob, imei: '35123456789012' }).imei);
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, receptionTrackingNo: 'th 1234 5678 9' }), {});
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, receptionTrackingNo: 'ED006390635ΤΗ' }), {}, 'Greek ΤΗ folds');
    for (const bad of ['TH123', 'TH/123456', 'ไรเดอร์มาส่ง'])
      assert.ok(errorsOf(jobSchema(), { ...fullJob, receptionTrackingNo: bad }).receptionTrackingNo, bad);
  });
  test('J: Channel / Warranty / รับสินค้าเข้าโดย from their lists; an old value kept as it is passes', () => {
    assert.ok(errorsOf(jobSchema(), { ...fullJob, channel: 'Online' }).channel);
    assert.ok(
      errorsOf(jobSchema(), { ...fullJob, channel: 'ยังไม่ระบุ' }).channel,
      '"ยังไม่ระบุ" = empty on a new job',
    );
    assert.ok(errorsOf(jobSchema(), { ...fullJob, warranty: 'in' }).warranty);
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, warranty: 'OUT', receptionType: 'Walk-In' }), {});
    assert.ok(errorsOf(jobSchema(), { ...fullJob, receptionType: 'ไปรษณีย์' }).receptionType);
    const { v, schema } = editOf({ channel: 'Online', warranty: 'ประกัน', receptionType: 'ส่งพัสดุ' });
    assert.deepEqual(errorsOf(schema, v), {});
    assert.deepEqual(Object.keys(errorsOf(schema, { ...v, channel: 'Offline' })), ['channel']);
  });
  test('J: warranty months whole 0–60 (legacy 1224 unchanged passes)', () => {
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: 60 }), {});
    assert.ok(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: 61 }).warrantyMonth);
    const { v, schema } = editOf({ warrantyMonth: 1224 });
    assert.deepEqual(errorsOf(schema, v), {});
    assert.deepEqual(errorsOf(schema, { ...v, warrantyMonth: '1224' }), {}, 'the form sends it as text');
    assert.ok(errorsOf(schema, { ...v, warrantyMonth: 1225 }).warrantyMonth);
  });
  test('J: dates — sale ≥ 2015 and ≤ open; expire ≥ sale and ≤ +10y; due open..+1y; reception ≤ tomorrow', () => {
    const e = (p: Record<string, unknown>) => Object.keys(errorsOf(jobSchema(), { ...fullJob, ...p }));
    assert.deepEqual(e({ saleOrderDate: '2014-12-31', expireDate: '2015-12-31' }), ['saleOrderDate']);
    assert.deepEqual(e({ saleOrderDate: '2026-09-02', expireDate: '2027-09-02' }), ['saleOrderDate'], 'after open');
    assert.deepEqual(e({ expireDate: '2026-08-31' }), ['expireDate']);
    assert.deepEqual(e({ expireDate: '2036-09-02' }), ['expireDate']);
    assert.deepEqual(e({ expireDate: '2036-09-01' }), []);
    assert.deepEqual(e({ dueDate: '2026-08-31' }), ['dueDate']);
    assert.deepEqual(e({ dueDate: '2027-09-01' }), []);
    assert.deepEqual(e({ dueDate: '2027-09-02' }), ['dueDate']);
    assert.deepEqual(e({ receptionDate: '2026-09-02' }), []);
    assert.deepEqual(e({ receptionDate: '2026-09-03' }), ['receptionDate']);
  });
  test('J: dates of an old job — unchanged legacy dates pass; the open date is the job’s own', () => {
    const { v, schema } = editOf({ saleOrderDate: '2010-05-01', expireDate: '2030-05-01', dueDate: '2025-01-11' });
    assert.deepEqual(errorsOf(schema, v), {});
    assert.ok(errorsOf(schema, { ...v, saleOrderDate: '2025-01-11' }).saleOrderDate, 'after its open date');
    assert.deepEqual(errorsOf(schema, { ...v, saleOrderDate: '2025-01-10', expireDate: '2026-01-10' }), {});
    // opened 2025-01-10, today 2026-09-01: a new due date up to a year from today is fine
    assert.deepEqual(errorsOf(schema, { ...v, dueDate: '2026-12-01' }), {});
    assert.ok(errorsOf(schema, { ...v, dueDate: '2025-01-09' }).dueDate);
  });
  test('J: text lengths = the column (Shop 100, รุ่นย่อย 200, อุปกรณ์ / จุดตำหนิ 100, อาการอื่นๆ 200, หมายเหตุ 2000)', () => {
    const at = (k: string, n: number) => errorsOf(jobSchema(), { ...fullJob, [k]: 'ก'.repeat(n) })[k];
    for (const [k, max] of [
      ['shopName', 100],
      ['modelDetail', 200],
      ['equipment', 100],
      ['fault', 100],
      ['symptomOther', 200],
      ['remark', 2000],
      ['jobTypeDetail', 50],
    ] as const) {
      assert.equal(at(k, max), undefined, `${k} ${max}`);
      assert.ok(at(k, max + 1), `${k} ${max + 1}`);
    }
    assert.equal(
      errorsOf(jobSchema(), { ...fullJob, shopName: `  ${'ก'.repeat(100)}  ` }).shopName,
      undefined,
      'trimmed',
    );
  });
  test('J: money 0–1,000,000 with ≤ 2 decimals on the job and repair costs; part qty whole 0–1000', () => {
    assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, estimateCost: '1000000', depositCost: 99.5 }), {});
    assert.ok(errorsOf(jobSchema(), { ...fullJob, depositCost: '1000000.01' }).depositCost);
    assert.ok(errorsOf(jobSchema(), { ...fullJob, estimateCost: '10.555' }).estimateCost);
    const part = (unitPrice: unknown, qty: unknown) => ({ unitPrice, a: { qty }, b: { qty: 0 } });
    assert.deepEqual(errorsOf(repairActionSchema, { status: 'x', parts: [part(100, 1000)] }), {});
    const e = errorsOf(repairActionSchema, { status: 'x', toolCost: 2_000_000, parts: [part(5_000_000, 1001)] });
    assert.deepEqual(Object.keys(e).sort(), ['parts.0.a.qty', 'parts.0.unitPrice', 'toolCost']);
  });
  test('J: repair / outsource text ≤ the column; new serial follows the serial rule', () => {
    const r = errorsOf(repairActionSchema, {
      status: 'x',
      repairDetail: 'ก'.repeat(201),
      engineerRemark: 'ก'.repeat(201),
      newSerial: 'SN ใหม่',
    });
    assert.deepEqual(Object.keys(r).sort(), ['engineerRemark', 'newSerial', 'repairDetail']);
    assert.deepEqual(
      errorsOf(repairActionSchema, { status: 'x', repairDetail: 'ก\n'.repeat(100), newSerial: 'NEW0001' }),
      {},
    );
    const o = errorsOf(outsourceActionSchema, {
      status: 'x',
      repairDetail: 'ก'.repeat(201),
      symptomOther: 'ก'.repeat(201),
      send: { to: 'ร'.repeat(51), date: '2026-10-01', detail: 'ก'.repeat(101) },
    });
    assert.deepEqual(Object.keys(o).sort(), ['repairDetail', 'send.detail', 'send.to', 'symptomOther']);
    assert.ok(
      errorsOf(outsourceActionSchema, { status: 'x', receive: { date: '', detail: 'ก'.repeat(101) } })[
        'receive.detail'
      ],
    );
  });
  test('J: swap — doc no / account ref formats, new serial rule; unchanged stored values pass', () => {
    const swap = { status: 'x', newSerial: 'NEW0001' };
    assert.deepEqual(errorsOf(swapRefundSchema(), { ...swap, docNo: 'wh-2600123', swapDate: '2026-10-01' }), {});
    assert.deepEqual(errorsOf(swapRefundSchema(), { ...swap, docNo: '0' }), {}, '"0" = none, stored as empty');
    for (const [k, bad] of [
      ['docNo', 'เบิก 123'],
      ['newSerial', 'ใหม่'],
      ['swapDate', '2026-02-30'],
      ['inspection', 'ก'.repeat(201)],
    ] as const)
      assert.ok(errorsOf(swapRefundSchema(), { ...swap, [k]: bad })[k], k);
    const prev = { newSerial: 'รอเลขใหม่', docNo: 'เบิก 123', refundRef: 'บัญชี ก' };
    assert.deepEqual(errorsOf(swapRefundSchema({ prev }), { ...swap, newSerial: 'รอเลขใหม่', docNo: 'เบิก 123' }), {});
  });
  test('J: refund — 0–1,000,000 (NOT capped at the job total: a warranty job is 0 but refunds the price); account ref A-Z 0-9 space -', () => {
    const refund = { status: 'x', refundMethod: 'โอน', refundRef: 'KBANK 123-4-56789-0' };
    assert.deepEqual(errorsOf(swapRefundSchema({ total: 0 }), { ...refund, refundAmount: '1290.50' }), {});
    assert.ok(errorsOf(swapRefundSchema(), { ...refund, refundAmount: '12.345' }).refundAmount);
    assert.ok(errorsOf(swapRefundSchema(), { ...refund, refundAmount: '1000000.5' }).refundAmount);
    assert.ok(errorsOf(swapRefundSchema(), { ...refund, refundAmount: 10, refundRef: 'บัญชี#1' }).refundRef);
  });
  test('J: close — receipt no, parcel no (6–40), date; detail + its prefix ≤ 100; legacy values unchanged pass', () => {
    const body = {
      status: 'ปิดงาน (Complete)',
      payment: { type: 'เงินสด', amount: '1500.50', date: '2026-10-01', no: 'RC-001' },
      return: { type: 'ส่งไปรษณีย์', date: '2026-10-01', tracking: 'ed 0063 9063 5th' },
    };
    assert.deepEqual(errorsOf(closeSchema(), body), {});
    const bad = errorsOf(closeSchema(), {
      ...body,
      payment: { ...body.payment, no: 'ใบเสร็จ 1', date: '2026-02-30', detail: 'ก'.repeat(90) },
      return: { ...body.return, tracking: 'ส่งแล้ว', courier: 'Flash', detail: 'ก'.repeat(95) },
    });
    assert.deepEqual(Object.keys(bad).sort(), [
      'payment.date',
      'payment.detail',
      'payment.no',
      'return.detail',
      'return.tracking',
    ]);
    const legacy = {
      ...body,
      payment: { ...body.payment, no: 'ใบเสร็จ 1' },
      return: { ...body.return, tracking: 'ส่งแล้ว' },
    };
    assert.deepEqual(errorsOf(closeSchema({ payNo: 'ใบเสร็จ 1', tracking: 'ส่งแล้ว' }), legacy), {});
  });
  test('J: close details are not prefixed twice when saved again (they used to grow and be cut at 100)', () => {
    assert.equal(paymentDetailOf('2026-10-15', 'ชำระ 2026-10-01 · โอนแล้ว'), 'ชำระ 2026-10-15 · โอนแล้ว');
    assert.equal(paymentDetailOf('2026-10-15', 'ชำระ 2026-10-01'), 'ชำระ 2026-10-15');
    assert.equal(paymentDetailOf('', ' โอนแล้ว '), 'โอนแล้ว');
    assert.equal(returnDetailOf('Flash', 'Flash · ฝากหน้าบ้าน'), 'Flash · ฝากหน้าบ้าน');
    assert.equal(returnDetailOf('Flash', 'Flash'), 'Flash');
    assert.equal(returnDetailOf('', 'ฝากหน้าบ้าน'), 'ฝากหน้าบ้าน');
    assert.deepEqual(parseSwap('New S/N: AB12\nยอดเงินคืน: 10.00'), { 'New S/N': 'AB12', ยอดเงินคืน: '10.00' });
  });
  test('R8 close: a note input takes 100 less what the save puts in front — the most it takes always saves', () => {
    const pay = (date: string, note: string) => {
      const max = noteMaxLength((n) => paymentDetailOf(date, n), note);
      const full = note || 'ก'.repeat(max); // a typed-in note this long saves, one more character does not
      assert.ok(paymentDetailOf(date, full.padEnd(max, 'ก')).length <= 100, date);
      assert.ok(paymentDetailOf(date, full.padEnd(max + 1, 'ก')).length > 100, date);
      return max;
    };
    assert.equal(pay('2026-10-15', ''), 100 - 'ชำระ 2026-10-15 · '.length);
    assert.equal(pay('', ''), 100, 'no date → nothing in front');
    assert.equal(pay('2026-10-15', 'ชำระ 2026-10-01 · โอน'), 100, 'a loaded note keeps its own date part');
    const ret = (courier: string) => noteMaxLength((n) => returnDetailOf(courier, n), '');
    assert.equal(ret('Kerry Express'), 100 - 'Kerry Express · '.length);
    assert.equal(ret(''), 100);
    assert.equal(
      noteMaxLength((n) => returnDetailOf('Flash', n), 'Flash · ฝาก'),
      100,
      'already starts with it',
    );
  });
  test('R8 quotation: sent / agreed on a job already further along says the job stays (never moved back)', () => {
    const job = (statusId: number, status = 'x') => ({ no: 'J1', statusId, status });
    assert.equal(quoteJobNote('เสนอราคาแล้ว', job(1)), '', 'new job → moves to 4');
    assert.equal(quoteJobNote('ลูกค้าตกลงซ่อม', job(4)), '', 'quoted → agreed moves');
    assert.equal(quoteJobNote('เสนอราคาแล้ว', job(4)), '', 'already there');
    assert.equal(quoteJobNote('ลูกค้าไม่ตกลงซ่อม', job(11)), '', 'declined moves nothing — nothing to say');
    assert.equal(quoteJobNote('เสนอราคาแล้ว', null), '');
    assert.equal(
      quoteJobNote('ลูกค้าตกลงซ่อม', job(11, 'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่ ')),
      'สถานะงาน J1 ไม่เปลี่ยน — งานอยู่ที่ "อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่" แล้ว (ไม่ถอยสถานะกลับ)',
    );
    assert.ok(quoteJobNote('เสนอราคาแล้ว', job(12)), 'agreed → sent never goes back');
    assert.ok(quoteJobNote('ลูกค้าตกลงซ่อม รออะไหล่', job(8)), 'a closed job never moves');
  });
  test('J: call log ≤ 200 (= the column; 800 chars used to be lost silently)', () => {
    assert.equal(validate(callLogSchema, { detail: 'ก'.repeat(200) }).ok, true);
    assert.equal(validate(callLogSchema, { detail: 'ก'.repeat(201) }).ok, false);
  });
  test('J: master name one line 1–50 (cleaned); detail per list (หมวดหมู่ 50, others 100); group ≤ 50', () => {
    assert.deepEqual(errorsOf(masterSchema('ชื่อสี'), { name: ' Black\n', detail: 'ก'.repeat(100) }), {});
    assert.equal(errorsOf(masterSchema('ชื่อสี'), { name: 'ก'.repeat(51) }).name, 'ชื่อสียาวเกิน 50 ตัวอักษร');
    assert.ok(errorsOf(masterSchema('ชื่อสี'), { name: '​' }).name, 'invisible only = empty');
    assert.ok(errorsOf(masterSchema('ชื่อหมวดหมู่', { detailMax: 50 }), { name: 'x', detail: 'ก'.repeat(51) }).detail);
    assert.ok(errorsOf(masterSchema('อาการเสีย'), { name: 'x', group: 'ก'.repeat(51) }).group);
    assert.equal(
      errorsOf(modelSchema, { name: 'X'.repeat(51), brand: 'B', price: 0 }).name,
      'Model Name ยาวเกิน 50 ตัวอักษร',
    );
    assert.equal(masterNameKey(' Poco  F5\n'), masterNameKey('POCOF5'), 'duplicates ignore case and spaces');
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
