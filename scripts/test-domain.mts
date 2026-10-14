/**
 * npm run test:domain (scripts/test-domain.mts) — domain rules that must hold under real data:
 * the permission matrix (app_config → can / canViewAny / requireView / GET /api/data/:resource),
 * stock never going negative, the sale-order approve / pick / edit state machine, and the two
 * row-lock regressions (lockStock: opposite-order movements deadlocked; lockJob: duplicate
 * job_log rows when two saves raced).
 *
 * Runs ONLY against the throwaway local test database (npm run db:test:up && npm run db:test:prepare).
 * Seeds its own fixtures (ids 9xxx, codes TD*, roles "TD *") and resets them at every start, so it
 * does not depend on tests/seed.mts (test:track TRUNCATEs job / customer / app_user / app_config).
 * Rows it writes (movements, sale orders, job_log, audit) stay behind for inspection.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { TEST_DATABASE_URL, assertLocal } from "../tests/db-url.mts";

// the app modules read DATABASE_URL when they are imported (below) — point it at the test DB first
assertLocal(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
Object.assign(process.env, {
  SESSION_SECRET: "unit-test-session-secret-0123456789abcdef", // ≥ 32 chars
  DB_POOL_MAX: "25", // the race tests need real concurrency, not 5 queued transactions
});

const { db, pool } = await import("@/db/client");
const { HttpError, userFromRequest, can, canViewAny, requireView, JOB_MODULES } = await import("@/server/auth");
const { signSession, SESSION_COOKIE } = await import("@/lib/session");
const { nextRunningNo } = await import("@/db/running-no");
const { issueOther, issueForJob, receiveStock } = await import("@/server/services/stock");
const { closeJob, saveRepair } = await import("@/server/services/jobs");
const { GET: dataGET } = await import("@/app/api/data/[resource]/route");
const { POST: soPOST } = await import("@/app/api/sale-orders/route");
const { POST: soApprovePOST } = await import("@/app/api/sale-orders/[no]/approve/route");
const { POST: stockIssuePOST } = await import("@/app/api/stock/issue/route");

// ---- fixtures ----
const U = {
  admin: { id: 9101, email: "td-admin@example.invalid", type: "System Admin", status: "ACTIVE" },
  clerk: { id: 9102, email: "td-clerk@example.invalid", type: "TD Job Clerk", status: "ACTIVE" },
  viewer: { id: 9103, email: "td-viewer@example.invalid", type: "TD Customer Viewer", status: "ACTIVE" },
  picker: { id: 9104, email: "td-picker@example.invalid", type: "TD Picker", status: "ACTIVE" },
  pending: { id: 9105, email: "td-pending@example.invalid", type: null, status: "ACTIVE" },
  inactive: { id: 9106, email: "td-inactive@example.invalid", type: "TD Customer Viewer", status: "INACTIVE" },
} as const;
type TestUser = (typeof U)[keyof typeof U];
const SV = 3; // every fixture user's session_version — a cookie must carry exactly this
const P = { a: { id: 9201, code: "TDP1" }, b: { id: 9202, code: "TDP2" }, c: { id: 9203, code: "TDP3" } };
const CUSTOMER = "TDC001";
const JOB_CLOSE = "TDJ0001"; // closeJob race
const JOB_PARTS = "TDJ0002"; // issueForJob over stock
const JOB_REPAIR = "TDJ0003"; // saveRepair race

async function seed() {
  const users = Object.values(U);
  await pool.query(`
    DELETE FROM app_config WHERE user_type LIKE 'TD %';
    INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view) VALUES
      ('TD Job Clerk', 'Job Management', false, true, false, true),
      ('TD Job Clerk', 'Customer', true, true, true, false),          -- every right but view: view is its own grant
      ('TD Customer Viewer', 'Customer', false, false, false, true),
      ('TD Picker', 'Product Pick Stock', true, false, false, true);

    DELETE FROM app_user WHERE user_id BETWEEN 9100 AND 9199 OR email_address LIKE 'td-%@example.invalid';
    INSERT INTO app_user (user_id, first_name, last_name, email_address, user_type, record_status, session_version) VALUES
      ${users.map((u) => `(${u.id}, 'TD', '${u.email.split("@")[0]}', '${u.email}', ${u.type ? `'${u.type}'` : "NULL"}, '${u.status}', ${SV})`).join(",\n      ")};

    INSERT INTO job_status (job_status_id, job_status_name, display_order, job_status_group, is_active)
      SELECT * FROM (VALUES (0, 'ยกเลิก', 0, 'Cancel', true), (1, 'รับงานใหม่', 1, 'Open', true), (2, 'กำลังดำเนินการ', 2, 'Open', true),
                            (5, 'ซ่อมเสร็จ', 5, 'Repaired', true), (20, 'เสร็จสมบูรณ์', 20, 'Finished', true)) v(id, name, ord, grp, act)
       WHERE NOT EXISTS (SELECT 1 FROM job_status s WHERE s.job_status_id = v.id);

    DELETE FROM sale_out_dt WHERE sale_out_hd_no IN (SELECT sale_out_hd_no FROM sale_out_hd WHERE customer_code = '${CUSTOMER}');
    DELETE FROM sale_out_hd WHERE customer_code = '${CUSTOMER}';
    DELETE FROM customer WHERE customer_id = 9001 OR customer_code = '${CUSTOMER}';
    INSERT INTO customer (customer_id, customer_code, customer_name, phone_number) VALUES (9001, '${CUSTOMER}', 'ลูกค้า ทดสอบโดเมน', '02-000-0000');

    DELETE FROM product_none_serial WHERE product_id IN (9201, 9202, 9203) OR item_id IN (9201, 9202, 9203);
    DELETE FROM product WHERE product_id IN (9201, 9202, 9203) OR product_code IN ('TDP1', 'TDP2', 'TDP3');
    INSERT INTO product (product_id, product_code, product_name) VALUES (9201, 'TDP1', 'อะไหล่ทดสอบ 1'), (9202, 'TDP2', 'อะไหล่ทดสอบ 2'), (9203, 'TDP3', 'อะไหล่ทดสอบ 3');
    INSERT INTO product_none_serial (item_id, product_id, quantity_available, quantity_used, quantity_booking, quantity_remain, retail_price) VALUES
      (9201, 9201, 10, 0, 0, 10, 100.00), (9202, 9202, 10, 0, 0, 10, 200.00), (9203, 9203, 10, 0, 0, 10, 300.00);

    DELETE FROM job_log WHERE job_no LIKE 'TDJ%';
    DELETE FROM job_order_spare_part_log WHERE job_no LIKE 'TDJ%';
    DELETE FROM job WHERE job_no LIKE 'TDJ%';
    INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, product_model_name, job_create_date, job_reception_date, job_closed_date) VALUES
      ('${JOB_CLOSE}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_PARTS}', 11, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01'),
      ('${JOB_REPAIR}', 2, 9001, '${CUSTOMER} ลูกค้า ทดสอบโดเมน', 'Model TD', now(), current_date, '1900-01-01');
    -- 15 requested (booked) while only 10 are on hand
    UPDATE product_none_serial SET quantity_booking = 15 WHERE product_id = 9203;
    INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, is_quotation, is_special, request_qty, order_status_id, request_date, request_by, grant_qty, return_qty)
      VALUES ('${JOB_PARTS}', 'TDP3', '', 1, false, true, 15, 1, now(), 9101, 0, 0);
  `);
  // test:running-no deletes the Inventory-In series and restarts it from 0 — the WHI numbers then
  // collide with the movements earlier runs of this script left in inventory_hd (unique inventory_no).
  // Make sure this year's rows exist, then move them past the highest number already used.
  for (const t of ["Inventory-In", "Inventory-Out"] as const) await db.transaction((tx) => nextRunningNo(tx, t));
  await pool.query(`
    UPDATE running_no r SET number = greatest(r.number, coalesce((
      SELECT max(substring(h.inventory_no FROM length(r.prefix) + 3)::int) FROM inventory_hd h
       WHERE h.inventory_no ~ ('^' || r.prefix || right(r.pyear::text, 2) || '[0-9]+$')), 0))
     WHERE r.running_type IN ('Inventory-In', 'Inventory-Out') AND r.length_year = 2`);
}

// ---- helpers ----
type Qty = { available: number; used: number; booking: number; remain: number };
async function qty(code: string): Promise<Qty> {
  const r = await db.execute<Qty>(sql`
    SELECT s.quantity_available AS available, s.quantity_used AS used, s.quantity_booking AS booking, s.quantity_remain AS remain
      FROM product_none_serial s JOIN product p ON p.product_id = s.product_id WHERE p.product_code = ${code}`);
  assert.equal(r.rows.length, 1, `one stock row for ${code}`);
  return r.rows[0];
}
async function setStock(code: string, remain: number) {
  await db.execute(sql`
    UPDATE product_none_serial SET quantity_available = ${remain}, quantity_used = 0, quantity_remain = ${remain}
     WHERE product_id = (SELECT product_id FROM product WHERE product_code = ${code})`);
}
/** HttpError status of a rejected call, 200 when it resolved; anything else is re-thrown. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

async function cookieFor(u: TestUser, sv = SV) {
  const now = Date.now();
  return `${SESSION_COOKIE}=${await signSession({ email: u.email, name: u.email, exp: now + 10 * 60_000, iat: now, sv })}`;
}
async function request(path: string, u: TestUser | null, init: { method?: string; body?: unknown; sv?: number } = {}) {
  const headers: Record<string, string> = { "user-agent": "test-domain" };
  if (u) headers.cookie = await cookieFor(u, init.sv);
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`https://svc.example.test${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function readData(resource: string, u: TestUser | null, sv?: number) {
  const r = await dataGET(await request(`/api/data/${resource}`, u, { sv }), { params: Promise.resolve({ resource }) });
  return r.status;
}
async function json(r: Response) {
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}
async function userOf(u: TestUser) {
  const cu = await userFromRequest(await request("/", u));
  assert.ok(cu, `${u.email} resolves to a user`);
  return cu;
}

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}

await seed();
try {

console.log("\nPermissions — app_config drives can() / canViewAny() / requireView()");
await test("can() follows the seeded grant per action (clerk: Job Management view+edit, not add)", async () => {
  const clerk = await userOf(U.clerk);
  assert.equal(await can(clerk, "Job Management", "view"), true);
  assert.equal(await can(clerk, "Job Management", "edit"), true);
  assert.equal(await can(clerk, "Job Management", "add"), false);
  assert.equal(await can(clerk, "Job Management", "del"), false);
});
await test("a module with add/edit/del but view=false is not viewable; unlisted modules and null deny", async () => {
  const clerk = await userOf(U.clerk);
  assert.equal(await can(clerk, "Customer", "add"), true);
  assert.equal(await can(clerk, "Customer", "view"), false);
  assert.equal(await can(clerk, "Quotation", "view"), false);
  assert.equal(await can(clerk, null, "view"), false);
});
await test("canViewAny(): true if any listed module has view, false otherwise", async () => {
  const clerk = await userOf(U.clerk);
  assert.equal(await canViewAny(clerk, JOB_MODULES), true);
  assert.equal(await canViewAny(clerk, ["Customer", "Quotation", "Sale Order"]), false);
  assert.equal(await canViewAny(clerk, []), false);
});
await test("requireView(): 403 without view, resolves the user with it", async () => {
  assert.equal(await statusOf(requireView(await request("/", U.clerk), ["Customer"])), 403);
  const u = await requireView(await request("/", U.clerk), JOB_MODULES);
  assert.equal(u.userId, U.clerk.id);
});
await test("System Admin passes can() / canViewAny() with no app_config rows at all", async () => {
  const admin = await userOf(U.admin);
  assert.equal(await can(admin, "Sale Order", "del"), true);
  assert.equal(await can(admin, null, "view"), true);
  assert.equal(await canViewAny(admin, ["Quotation"]), true);
});

console.log("\nPermissions — GET /api/data/:resource (readResource)");
await test("customers: 403 without Customer view, 200 with it", async () => {
  assert.equal(await readData("customers", U.clerk), 403);
  assert.equal(await readData("customers", U.picker), 403);
  assert.equal(await readData("customers", U.viewer), 200);
});
await test("admin-only resources (job_summary, issued_lines, sale_order_summary) → 403 for every non-admin", async () => {
  for (const r of ["job_summary", "issued_lines", "sale_order_summary"]) {
    for (const u of [U.clerk, U.viewer, U.picker]) assert.equal(await readData(r, u), 403, `${r} as ${u.email}`);
  }
});
await test("cross-module read stays allowed: Product Pick Stock alone can read sale_orders", async () => {
  assert.equal(await readData("sale_orders", U.picker), 200);
  assert.equal(await readData("sale_orders", U.clerk), 403);
});
await test("pending user (user_type NULL) → 403 everywhere, lookups included", async () => {
  for (const r of ["customers", "jobs", "sale_orders", "job_summary", "job_statuses", "products"]) assert.equal(await readData(r, U.pending), 403, r);
});
await test("INACTIVE user → 403 even on a resource the role may view", async () => {
  for (const r of ["customers", "job_statuses"]) assert.equal(await readData(r, U.inactive), 403, r);
});
await test("no cookie → 401; a cookie with a stale session_version → 401", async () => {
  assert.equal(await readData("customers", null), 401);
  assert.equal(await readData("customers", U.viewer, SV - 1), 401);
});
await test("System Admin → 200 on customers, job_summary, sale_order_summary", async () => {
  for (const r of ["customers", "job_summary", "sale_order_summary"]) assert.equal(await readData(r, U.admin), 200, r);
});

console.log("\nStock never goes negative (adjustQty: remain < 0 → 409, whole movement rolled back)");
await test("issueOther of more than on hand → 409, quantities unchanged", async () => {
  await setStock(P.a.code, 10);
  const before = await qty(P.a.code);
  assert.equal(await statusOf(issueOther({ payTo: "TD", lines: [{ code: P.a.code, qty: 11 }] }, U.admin.id)), 409);
  assert.deepEqual(await qty(P.a.code), before);
});
await test("issueOther: one short line rolls back the good line before it (no partial movement)", async () => {
  await setStock(P.a.code, 10);
  await setStock(P.b.code, 10);
  const docs = async () => (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM inventory_hd WHERE reference_out_to = 'TD-rollback'`)).rows[0].n;
  const [a, b, n] = [await qty(P.a.code), await qty(P.b.code), await docs()];
  assert.equal(await statusOf(issueOther({ payTo: "TD-rollback", lines: [{ code: P.a.code, qty: 5 }, { code: P.b.code, qty: 11 }] }, U.admin.id)), 409);
  assert.deepEqual(await qty(P.a.code), a);
  assert.deepEqual(await qty(P.b.code), b);
  assert.equal(await docs(), n, "no inventory_hd row");
});
await test("issueOther: the same part twice in one movement is summed (6 + 6 of 10 → 409)", async () => {
  await setStock(P.a.code, 10);
  const before = await qty(P.a.code);
  assert.equal(await statusOf(issueOther({ payTo: "TD", lines: [{ code: P.a.code, qty: 6 }, { code: P.a.code, qty: 6 }] }, U.admin.id)), 409);
  assert.deepEqual(await qty(P.a.code), before);
});
await test("issueOther of exactly what is on hand succeeds and leaves 0", async () => {
  await setStock(P.a.code, 10);
  await issueOther({ payTo: "TD", lines: [{ code: P.a.code, qty: 10 }] }, U.admin.id);
  const q = await qty(P.a.code);
  assert.equal(q.remain, 0);
  assert.equal(q.used, 10);
});
await test("issueForJob of a 15-piece request with 10 on hand → 409; stock, booking and the request unchanged", async () => {
  const before = await qty(P.c.code);
  const [log] = (await db.execute<{ id: number }>(sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${JOB_PARTS}`)).rows;
  assert.equal(await statusOf(issueForJob({ jobNo: JOB_PARTS, lines: [{ logId: log.id, qty: 15 }] }, U.admin.id)), 409);
  assert.deepEqual(await qty(P.c.code), before);
  const [after] = (await db.execute<{ g: number; s: number }>(sql`SELECT grant_qty AS g, order_status_id AS s FROM job_order_spare_part_log WHERE job_order_log_id = ${log.id}`)).rows;
  assert.deepEqual({ ...after }, { g: 0, s: 1 });
});
await test("issueForJob of more than was requested → 400 (before stock is touched)", async () => {
  const before = await qty(P.c.code);
  const [log] = (await db.execute<{ id: number }>(sql`SELECT job_order_log_id AS id FROM job_order_spare_part_log WHERE job_no = ${JOB_PARTS}`)).rows;
  assert.equal(await statusOf(issueForJob({ jobNo: JOB_PARTS, lines: [{ logId: log.id, qty: 16 }] }, U.admin.id)), 400);
  assert.deepEqual(await qty(P.c.code), before);
});

console.log("\nSale order — approve / pick / edit");
let soNo = "";
let soDtId = 0;
await test("create (submit → waiting) via POST /api/sale-orders", async () => {
  await setStock(P.a.code, 10);
  const r = await json(await soPOST(await request("/api/sale-orders", U.admin, { method: "POST", body: { customerCode: CUSTOMER, salesId: U.admin.id, submit: true, lines: [{ code: P.a.code, qty: 2 }] } })));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const order = r.body.order as { no: string; approveId: number; lines: { id: number }[] };
  assert.equal(order.approveId, 2);
  soNo = order.no;
  soDtId = order.lines[0].id;
});
await test("pick on a NOT approved order (POST /api/stock/issue type=sale) → 409, stock unchanged", async () => {
  assert.ok(soNo, "needs the order above");
  const before = await qty(P.a.code);
  const r = await stockIssuePOST(await request("/api/stock/issue", U.admin, { method: "POST", body: { type: "sale", ref: soNo, lines: [{ dtId: soDtId, qty: 2 }] } }));
  assert.equal(r.status, 409);
  assert.deepEqual(await qty(P.a.code), before);
});
await test("approve → 200 and stock goes out once; approve again → 409 and stock does not move", async () => {
  assert.ok(soNo, "needs the order above");
  const approve = async () => soApprovePOST(await request(`/api/sale-orders/${soNo}/approve`, U.admin, { method: "POST", body: { decision: "approve" } }), { params: Promise.resolve({ no: soNo }) });
  const first = await approve();
  assert.equal(first.status, 200, JSON.stringify(await first.json()));
  assert.equal((await qty(P.a.code)).remain, 8);
  assert.equal((await approve()).status, 409);
  assert.equal((await qty(P.a.code)).remain, 8);
});
await test("edit an approved order (POST /api/sale-orders with its no) → 409, lines untouched", async () => {
  assert.ok(soNo, "needs the order above");
  const r = await soPOST(await request("/api/sale-orders", U.admin, { method: "POST", body: { no: soNo, customerCode: CUSTOMER, salesId: U.admin.id, lines: [{ code: P.a.code, qty: 9 }] } }));
  assert.equal(r.status, 409);
  const [dt] = (await db.execute<{ q: number; pick: string }>(sql`SELECT sale_out_quantity AS q, pick_inventory_no AS pick FROM sale_out_dt WHERE sale_out_hd_no = ${soNo}`)).rows;
  assert.equal(dt.q, 2);
  assert.ok(dt.pick, "still picked");
});

console.log("\nDeadlock regression — lockStock");
await test("20 concurrent receive / issue movements on 3 parts in opposite line order all commit; totals exact", async () => {
  const START = 1000;
  for (const p of [P.a, P.b, P.c]) await setStock(p.code, START);
  await db.execute(sql`UPDATE product_none_serial SET quantity_booking = 0 WHERE product_id IN (9201, 9202, 9203)`);
  const RECV = { [P.a.code]: 1, [P.b.code]: 2, [P.c.code]: 3 };
  const ISSUE = { [P.a.code]: 3, [P.b.code]: 1, [P.c.code]: 2 };
  const fwd = [P.a.code, P.b.code, P.c.code];
  const rev = [...fwd].reverse();
  const N = 20;
  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) => {
      const order = i % 4 < 2 ? fwd : rev;
      return i % 2 === 0
        ? receiveStock({ supplier: "TD-race", lines: order.map((code) => ({ code, qty: RECV[code] })) }, U.admin.id)
        : issueOther({ payTo: "TD-race", lines: order.map((code) => ({ code, qty: ISSUE[code] })) }, U.admin.id);
    })
  );
  const failed = results.flatMap((r) => (r.status === "rejected" ? [String((r.reason as Error)?.cause ?? r.reason)] : []));
  assert.equal(failed.length, 0, `${failed.length}/${N} failed: ${failed[0]}`);
  for (const code of fwd) {
    const q = await qty(code);
    const recv = (N / 2) * RECV[code];
    const issued = (N / 2) * ISSUE[code];
    assert.deepEqual({ ...q }, { available: START + recv, used: issued, booking: 0, remain: START + recv - issued }, code);
  }
});

console.log("\nJob status race — lockJob");
const logRows = async (jobNo: string) =>
  (await db.execute<{ s: number }>(sql`SELECT job_status_id AS s FROM job_log WHERE job_no = ${jobNo} ORDER BY job_log_id`)).rows.map((r) => r.s);
await test("5 concurrent closeJob → all succeed, exactly one job_log row, job is Finished", async () => {
  const input = { status: "เสร็จสมบูรณ์", payment: { type: "เงินสด" }, return: { type: "รับเอง", date: "2026-10-01" } };
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => closeJob(JOB_CLOSE, input, U.admin.id)));
  const failed = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
  assert.equal(failed.length, 0, failed[0]);
  assert.deepEqual(await logRows(JOB_CLOSE), [20]);
  const [j] = (await db.execute<{ s: number }>(sql`SELECT job_status_id AS s FROM job WHERE job_no = ${JOB_CLOSE}`)).rows;
  assert.equal(j.s, 20);
});
await test("5 concurrent saveRepair to the same status → all succeed, exactly one job_log row", async () => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => saveRepair(JOB_REPAIR, { status: "ซ่อมเสร็จ", repairDetail: "TD race" }, U.admin.id)));
  const failed = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
  assert.equal(failed.length, 0, failed[0]);
  assert.deepEqual(await logRows(JOB_REPAIR), [5]);
});

} finally {
  await pool.end();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
