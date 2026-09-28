/**
 * npm run test:schemas — the form rules in src/lib/validation (shared by the pages and the API).
 * Pure: no DB, no network.
 */
import assert from "node:assert/strict";
import { validate } from "../src/lib/validation/index.ts";
import {
  jobSchema,
  filledRequired,
  missingRequired,
  JOB_REQUIRED_KEYS,
  repairActionSchema,
  outsourceActionSchema,
  swapRefundActionSchema,
  closeActionSchema,
} from "../src/lib/validation/job.ts";
import { customerSchema, conflictErrors } from "../src/lib/validation/customer.ts";

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
  customerCode: "C00001", jobType: "งานซ่อม", so: "SO-1", channel: "SHOPEE", saleOrderDate: "2026-09-01",
  warrantyMonth: "12", expireDate: "2027-09-01", serial: "SN1", brand: "Dreame", modelCode: "MD00001", symptoms: ["แบตหมดไว"],
};

console.log("\nJob — new job (every required field)");
test("a complete job passes", () => assert.deepEqual(errorsOf(jobSchema(), fullJob), {}));
test("an empty job reports all 11 required fields at once, in form order", () => {
  const e = errorsOf(jobSchema(), {});
  assert.deepEqual(Object.keys(e), JOB_REQUIRED_KEYS);
  assert.equal(e.so, "ต้องระบุ Sale Order No.");
});
test("blank strings, spaces and empty symptom lists count as empty", () => {
  const e = errorsOf(jobSchema(), { ...fullJob, so: "   ", serial: "", symptoms: [""] });
  assert.deepEqual(Object.keys(e).sort(), ["serial", "so", "symptoms"]);
});
test("warranty months 0 is a value (not empty); negative / text is rejected", () => {
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: 0 }), {});
  assert.ok(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: -1 }).warrantyMonth);
  assert.ok(errorsOf(jobSchema(), { ...fullJob, warrantyMonth: "abc" }).warrantyMonth);
});
test("dates must be YYYY-MM-DD", () => {
  assert.ok(errorsOf(jobSchema(), { ...fullJob, saleOrderDate: "01/09/2026" }).saleOrderDate);
  assert.deepEqual(errorsOf(jobSchema(), { ...fullJob, receptionDate: "" }), {});
});
test("costs must not be negative", () => assert.ok(errorsOf(jobSchema(), { ...fullJob, serviceCost: -5 }).serviceCost));

console.log("\nJob — edit (never worse than before)");
const legacy = { ...fullJob, serial: "", so: "" }; // an old swap job saved without these
test("an old job may keep its empty fields", () => {
  const before = filledRequired(legacy);
  assert.ok(!before.includes("serial") && !before.includes("so"));
  assert.deepEqual(errorsOf(jobSchema(before), legacy), {});
});
test("…but a field that had a value cannot be cleared", () => {
  const before = filledRequired(legacy);
  assert.deepEqual(Object.keys(errorsOf(jobSchema(before), { ...legacy, brand: "" })), ["brand"]);
});
test("the 'ข้อมูลไม่ครบ' notice lists what is still missing", () => assert.deepEqual(missingRequired(legacy), ["so", "serial"]));
test('legacy placeholders "0" / "-" in text fields count as empty (warranty months 0 does not)', () => {
  assert.deepEqual(missingRequired({ ...fullJob, serial: "0", so: "-" }), ["so", "serial"]);
  assert.ok(errorsOf(jobSchema(), { ...fullJob, serial: "0" }).serial);
  assert.deepEqual(missingRequired({ ...fullJob, warrantyMonth: 0 }), []);
});

console.log("\nWorkflow screens");
test("repair: status required", () => {
  assert.ok(errorsOf(repairActionSchema, { repairDetail: "x" }).status);
  assert.deepEqual(errorsOf(repairActionSchema, { status: "ซ่อมเสร็จ", parts: [] }), {});
});
test("outsource: sending needs to + date; receiving back needs neither", () => {
  assert.deepEqual(Object.keys(errorsOf(outsourceActionSchema, { status: "x", send: { to: "", date: "" } })).sort(), ["send.date", "send.to"]);
  assert.deepEqual(errorsOf(outsourceActionSchema, { status: "x", receive: { from: "ร้าน A", date: "2026-09-28" } }), {});
  assert.ok(errorsOf(outsourceActionSchema, { status: "x" })["send.to"], "neither send nor receive");
});
test("swap needs New Serial; refund needs amount > 0 and a method", () => {
  assert.ok(errorsOf(swapRefundActionSchema, { status: "x", newSerial: "" }).newSerial);
  assert.deepEqual(errorsOf(swapRefundActionSchema, { status: "x", newSerial: "SN2" }), {});
  const r = errorsOf(swapRefundActionSchema, { status: "x", refundAmount: "0", refundMethod: "" });
  assert.deepEqual(Object.keys(r).sort(), ["refundAmount", "refundMethod"]);
  assert.deepEqual(errorsOf(swapRefundActionSchema, { status: "x", refundAmount: 500, refundMethod: "โอน" }), {});
});
test("close: status, payment method, return method and return date", () => {
  const e = errorsOf(closeActionSchema, { status: "", payment: { type: "" }, return: { type: "", date: "" } });
  assert.deepEqual(Object.keys(e).sort(), ["payment.type", "return.date", "return.type", "status"]);
  assert.deepEqual(errorsOf(closeActionSchema, { status: "ปิดงาน (Complete)", payment: { type: "เงินสด" }, return: { type: "ลูกค้ามารับเอง", date: "2026-09-28" } }), {});
});

console.log("\nCustomer");
test("name and phone required for a new customer", () => {
  assert.deepEqual(Object.keys(errorsOf(customerSchema(), { name: " ", phone: "" })).sort(), ["name", "phone"]);
  assert.deepEqual(errorsOf(customerSchema(), { name: "สมชาย", phone: "0812345678", email: "" }), {});
});
test("an old customer without a phone may stay without one", () => assert.deepEqual(errorsOf(customerSchema(false), { name: "สมชาย", phone: "" }), {}));
test("email must be a real address when given", () => {
  assert.ok(errorsOf(customerSchema(), { name: "a", phone: "1", email: "abc" }).email);
  assert.deepEqual(errorsOf(customerSchema(), { name: "a", phone: "1", email: "a@b.co" }), {});
});
test("a 409 clash becomes a message under the clashing field", () => {
  const e = conflictErrors([{ field: "phone", code: "C00001", name: "สมชาย" }]);
  assert.match(e.phone, /C00001/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
