import { Pool } from 'pg';
import { DATABASE_URL, E2E_CUSTOMER } from './env';

/**
 * The specs' own line to the test database (the local *_test one — env.ts refuses anything else): fresh
 * rows for one test and the numbers a flow left behind. Every row a spec makes is new (a fresh job no. /
 * part code per call), so a spec re-runs on a dirty database and never depends on another one.
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 2,
  options: '-c TimeZone=Asia/Bangkok',
  allowExitOnIdle: true, // the worker exits when the specs are done
});

export async function rows<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const r = await rows<T>(text, params);
  if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${text}`);
  return r[0]!;
}

/** the user's DB key (app_user.pk — what *_app_user_pk columns hold), as a number (pg answers bigint as text) */
export const userId = async (email: string) =>
  (await one<{ id: number }>('SELECT pk::int AS id FROM app_user WHERE email_address = $1', [email])).id;
/** the user's external id (uuid) — what the API takes and answers (ADR 0008); userId above is the DB key */
export const userUuid = async (email: string) =>
  (await one<{ id: string }>('SELECT id::text AS id FROM app_user WHERE email_address = $1', [email])).id;

/** the job's external id (uuid) — its link (/jobs/edit?id=, /api/jobs/<uuid>, ADR 0008); the number is what's shown */
export const jobUuid = async (no: string) =>
  (await one<{ id: string }>('SELECT id::text AS id FROM job WHERE job_no = $1', [no])).id;

/** J97 + 5 digits: J + 7 digits like a real job no. (the pick page's rule), a series the app never issues (J + yy).
 *  Stock documents / part logs point at the job by job_pk (drizzle/0006), so they go with it (test:track's
 *  TRUNCATE … CASCADE): the numbers on job are all that is used. */
export async function newJobNo(): Promise<string> {
  const r = await one<{ no: string }>(
    `SELECT 'J97' || lpad((coalesce(max(substring(job_no FROM 4)::int), 0) + 1)::text, 5, '0') AS no
       FROM job WHERE job_no ~ '^J97[0-9]{5}$'`,
  );
  return r.no;
}

/** an ACTIVE part with `remain` on hand (available = remain, nothing used / booked) */
export async function newPart(o: { remain: number; price: number }): Promise<{ code: string; name: string }> {
  const { code } = await one<{ code: string }>(
    `SELECT 'E2EP' || lpad((coalesce(max(substring(product_code FROM 5)::int), 0) + 1)::text, 5, '0') AS code
       FROM product WHERE product_code ~ '^E2EP[0-9]{5}$'`,
  );
  const name = `อะไหล่ทดสอบ ${code}`;
  const { id } = await one<{ id: number }>(
    `INSERT INTO product (product_code, product_name, record_status) VALUES ($1, $2, 'ACTIVE') RETURNING pk AS id`,
    [code, name],
  );
  await pool.query(
    `INSERT INTO product_stock (product_pk, quantity_available, quantity_used, quantity_booking, quantity_remain,
                                      retail_price, wholesale_price, capital_price)
     VALUES ($1, $2, 0, 0, $2, $3, 0, 0)`,
    [id, o.remain, o.price],
  );
  return { code, name };
}

export type Stock = { available: number; used: number; booking: number; remain: number };
export const stockOf = (code: string) =>
  one<Stock>(
    `SELECT s.quantity_available AS available, s.quantity_used AS used, s.quantity_booking AS booking,
            s.quantity_remain AS remain
       FROM product_stock s JOIN product p ON p.pk = s.product_pk WHERE p.product_code = $1`,
    [code],
  );

/** a job of the e2e customer, as a legacy row: the money columns as given, nothing closed yet */
export async function newJob(o: {
  status: number;
  service?: number;
  parts?: number;
  deposit?: number;
  paid?: number;
  payType?: string;
  closed?: boolean;
}): Promise<string> {
  const no = await newJobNo();
  const total = (o.service ?? 0) + (o.parts ?? 0);
  await pool.query(
    `INSERT INTO job (job_no, job_status_id, customer_pk, customer_detail, job_type_pk, model_pk, product_model_name, product_serial,
                      job_create_date, job_reception_date, job_closed_date, job_repaired_date,
                      service_cost, spare_part_total_cost, job_total_cost, deposit_cost,
                      job_payment_type, job_payment_amount, job_payment_no, job_payment_detail)
     SELECT $1::varchar, $2::int, c.pk, c.customer_code || ' ' || c.customer_name, (SELECT pk FROM job_type WHERE job_type_name = 'E2E ซ่อม'),
            (SELECT pk FROM model WHERE model_code = 'E2E-M1'), 'E2E Model 1', 'SN-' || $1::varchar, now() - interval '2 days', current_date - 2,
            CASE WHEN $9::boolean THEN now() - interval '1 hour' ELSE '1900-01-01' END,
            CASE WHEN $2::int IN (5, 7, 8, 9, 20, 24) THEN now() - interval '1 day' ELSE '1900-01-01' END,
            $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::varchar, $8::numeric, '', ''
       FROM customer c WHERE c.customer_code = $10`,
    [
      no,
      o.status,
      o.service ?? 0,
      o.parts ?? 0,
      total,
      o.deposit ?? 0,
      o.payType ?? '',
      o.paid ?? 0,
      !!o.closed,
      E2E_CUSTOMER,
    ],
  );
  return no;
}

/** a part line on a job (job_part): เบิก + เสนอ แบบ A, `granted` of `qty` issued */
export async function newPartLine(o: { jobNo: string; code: string; price: number; qty: number; granted: number }) {
  await pool.query(
    `INSERT INTO job_part (job_pk, product_pk, spare_part_unit_price,
            is_quotation, is_special, request_qty, spare_part_total_price, is_quotation_b, is_special_b, request_qty_b,
            spare_part_total_price_b, job_part_status_id, request_date, grant_qty, grant_date, return_qty, return_date)
     VALUES ((SELECT pk FROM job WHERE job_no = $1), (SELECT pk FROM product WHERE product_code = $2), $3::numeric,
             true, true, $4::int, $3::numeric * $4::int, false, false, 0, 0, $5, now(),
             $6::int, CASE WHEN $6::int > 0 THEN now() ELSE '1900-01-01' END, 0, '1900-01-01')`,
    [o.jobNo, o.code, o.price, o.qty, o.granted >= o.qty ? 3 : 1, o.granted],
  );
  // a pending request holds its quantity on the part (booking) until the store issues it — as saveRepair does
  if (o.qty > o.granted)
    await pool.query(
      `UPDATE product_stock SET quantity_booking = quantity_booking + $2
        WHERE product_pk = (SELECT pk FROM product WHERE product_code = $1)`,
      [o.code, o.qty - o.granted],
    );
}

/** the stock movements (stock_move + its lines) that reference a job / sale order (by its number) */
export const movementsOf = (ref: string) =>
  rows<{ no: string; type: number; code: string; qty: number }>(
    `SELECT h.stock_move_no AS no, h.stock_move_type_id AS type, p.product_code AS code, d.item_quantity::float AS qty
       FROM stock_move h JOIN stock_move_line d ON d.stock_move_pk = h.pk LEFT JOIN product p ON p.pk = d.product_pk
      WHERE h.job_pk = (SELECT pk FROM job WHERE job_no = $1)
         OR h.sale_order_pk = (SELECT pk FROM sale_order WHERE sale_order_no = $1)
      ORDER BY h.stock_move_no`,
    [ref],
  );
