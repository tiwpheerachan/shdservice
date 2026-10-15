/**
 * npm run test:schemas — the form rules in src/lib/validation (shared by the pages and the API).
 * Pure: no DB, no network.
 */
import assert from 'node:assert/strict';
import { validate, summary, isRealDate } from '../src/lib/validation/index.ts';
import {
  jobSchema,
  filledRequired,
  missingRequired,
  JOB_REQUIRED_KEYS,
  repairActionSchema,
  outsourceActionSchema,
  swapRefundActionSchema,
  closeActionSchema,
  jobAmountDue,
  STATUS_CLOSED_TRACKED,
} from '../src/lib/validation/job.ts';
import { customerSchema, conflictErrors } from '../src/lib/validation/customer.ts';
import { quotationSchema } from '../src/lib/validation/quotation.ts';
import { saleOrderSchema } from '../src/lib/validation/sale-order.ts';
import {
  masterSchema,
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

const fullJob = {
  customerCode: 'C00001',
  jobType: 'งานซ่อม',
  so: 'SO-1',
  channel: 'SHOPEE',
  saleOrderDate: '2026-09-01',
  warrantyMonth: '12',
  expireDate: '2027-09-01',
  serial: 'SN1',
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
  assert.equal(e.serviceCost, 'ค่าบริการการซ่อมต้องไม่ติดลบ');
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
  assert.ok(errorsOf(swapRefundActionSchema, { status: 'x', newSerial: '' }).newSerial);
  assert.deepEqual(errorsOf(swapRefundActionSchema, { status: 'x', newSerial: 'SN2' }), {});
  const r = errorsOf(swapRefundActionSchema, { status: 'x', refundAmount: '0', refundMethod: '' });
  assert.deepEqual(Object.keys(r).sort(), ['refundAmount', 'refundMethod']);
  assert.deepEqual(errorsOf(swapRefundActionSchema, { status: 'x', refundAmount: 500, refundMethod: 'โอน' }), {});
});
test('close: status, payment method, return method and return date', () => {
  const e = errorsOf(closeActionSchema, { status: '', payment: { type: '' }, return: { type: '', date: '' } });
  assert.deepEqual(Object.keys(e).sort(), ['payment.type', 'return.date', 'return.type', 'status']);
  assert.deepEqual(
    errorsOf(closeActionSchema, {
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
  assert.deepEqual(Object.keys(errorsOf(closeActionSchema, body)).sort(), ['payment.amount', 'return.date']);
  assert.deepEqual(
    errorsOf(closeActionSchema, {
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
  assert.deepEqual(errorsOf(closeActionSchema, body), { 'return.tracking': 'ต้องระบุหมายเลขพัสดุ' });
  assert.deepEqual(errorsOf(closeActionSchema, { ...body, return: { ...body.return, tracking: undefined } }), {
    'return.tracking': 'ต้องระบุหมายเลขพัสดุ',
  });
  assert.deepEqual(errorsOf(closeActionSchema, { ...body, return: { ...body.return, tracking: 'TH123' } }), {});
  // 7 = the number is still to come
  assert.deepEqual(errorsOf(closeActionSchema, { ...body, status: 'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)' }), {});
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
  assert.deepEqual(errorsOf(customerSchema(false), { name: 'สมชาย', phone: '' }), {}));
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
  assert.deepEqual(e({ phone: '0812345678', taxId: '1-2345-67890-12-3' }), {});
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
  assert.deepEqual(errorsOf(quotationSchema(false), { ...q, jobNo: '' }), {});
  assert.ok(errorsOf(quotationSchema(false), { ...q, jobNo: 'abc' }).jobNo, 'a given job no must still look like one');
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
test('a complete order passes', () => assert.deepEqual(errorsOf(saleOrderSchema, so), {}));
test('customer, salesperson and a product line are required', () => {
  assert.deepEqual(Object.keys(errorsOf(saleOrderSchema, { customerCode: '', salesId: 0, lines: [] })).sort(), [
    'customerCode',
    'lines',
    'salesId',
  ]);
  assert.ok(
    errorsOf(saleOrderSchema, { ...so, lines: [{ code: '', qty: 1 }] }).lines,
    'a line without a product does not count',
  );
});
test('qty > 0 per row; price and paid amount not negative', () => {
  const e = errorsOf(saleOrderSchema, { ...so, lines: [{ code: 'P1', qty: 0, price: -1 }], paymentAmount: -5 });
  assert.deepEqual(Object.keys(e).sort(), ['lines.0.price', 'lines.0.qty', 'paymentAmount']);
});
test('qty a whole number (1.5 used to be cut to 1); salesperson id whole', () => {
  assert.equal(
    errorsOf(saleOrderSchema, { ...so, lines: [{ code: 'P1', qty: 1.5 }] })['lines.0.qty'],
    'จำนวนต้องเป็นจำนวนเต็ม',
  );
  assert.deepEqual(errorsOf(saleOrderSchema, { ...so, lines: [{ code: 'P1', qty: '2' }] }), {});
  assert.ok(errorsOf(saleOrderSchema, { ...so, salesId: 7.5 }).salesId);
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
  assert.deepEqual(Object.keys(errorsOf(userSchema, { name: '', role: '' })).sort(), ['name', 'role']);
  assert.ok(errorsOf(userSchema, { name: 'a', role: 'Engineer', email: 'x@' }).email);
});
test('spare part: Thai name; prices not negative', () => {
  assert.ok(errorsOf(productSchema, { name: '' }).name);
  assert.deepEqual(
    Object.keys(errorsOf(productSchema, { name: 'แบต', capitalPrice: '-1', wholesalePrice: '', price: '-5' })).sort(),
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
  assert.deepEqual(Object.keys(errorsOf(swapRefundActionSchema, {})).sort(), ['newSerial', 'status']);
  assert.deepEqual(Object.keys(errorsOf(saleOrderSchema, {})).sort(), ['customerCode', 'lines', 'salesId']);
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
  assert.equal(ok(callLogSchema, { detail: 'x'.repeat(1001) }), false);
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
    assert.deepEqual(errorsOf(customerSchema(), { name: 'ก', phone: '02\u2013123\u20134567' }), {});
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

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
