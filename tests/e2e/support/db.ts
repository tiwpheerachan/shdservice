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

export const userId = async (email: string) =>
  (await one<{ id: number }>('SELECT user_id AS id FROM app_user WHERE email_address = $1', [email])).id;

/** J97 + 5 digits: J + 7 digits like a real job no. (the pick page's rule), a series the app never issues (J + yy) */
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
    `INSERT INTO product (product_code, product_name, record_status) VALUES ($1, $2, 'ACTIVE') RETURNING product_id AS id`,
    [code, name],
  );
  await pool.query(
    `INSERT INTO product_none_serial (product_id, quantity_available, quantity_used, quantity_booking, quantity_remain,
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
       FROM product_none_serial s JOIN product p ON p.product_id = s.product_id WHERE p.product_code = $1`,
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
    `INSERT INTO job (job_no, job_status_id, customer_id, customer_detail, job_type_id, product_model_name, product_serial,
                      job_create_date, job_reception_date, job_closed_date, job_repaired_date,
                      service_cost, spare_part_total_cost, job_total_cost, deposit_cost,
                      job_payment_type, job_payment_amount, job_payment_no, job_payment_detail)
     SELECT $1::varchar, $2::int, c.customer_id, c.customer_code || ' ' || c.customer_name, (SELECT job_type_id FROM job_type WHERE job_type_name = 'E2E ซ่อม'),
            'E2E Model 1', 'SN-' || $1::varchar, now() - interval '2 days', current_date - 2,
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

/** a part line on a job (job_order_spare_part_log): เบิก + เสนอ แบบ A, `granted` of `qty` issued */
export async function newPartLine(o: { jobNo: string; code: string; price: number; qty: number; granted: number }) {
  await pool.query(
    `INSERT INTO job_order_spare_part_log (job_no, spare_part_code, spare_part_serial_no, stock_id, spare_part_unit_price,
            is_quotation, is_special, request_qty, spare_part_total_price, is_quotation_b, is_special_b, request_qty_b,
            spare_part_total_price_b, order_status_id, request_date, request_by, grant_qty, grant_date, grant_by,
            return_qty, return_date, return_by, return_stock_id)
     VALUES ($1, $2, '', 1, $3::numeric, true, true, $4::int, $3::numeric * $4::int, false, false, 0, 0, $5, now(), -1,
             $6::int, CASE WHEN $6::int > 0 THEN now() ELSE '1900-01-01' END, -1, 0, '1900-01-01', -1, -1)`,
    [o.jobNo, o.code, o.price, o.qty, o.granted >= o.qty ? 3 : 1, o.granted],
  );
  // a pending request holds its quantity on the part (booking) until the store issues it — as saveRepair does
  if (o.qty > o.granted)
    await pool.query(
      `UPDATE product_none_serial SET quantity_booking = quantity_booking + $2
        WHERE product_id = (SELECT product_id FROM product WHERE product_code = $1)`,
      [o.code, o.qty - o.granted],
    );
}

/** the stock movements (inventory_hd + its lines) that reference a job / sale order */
export const movementsOf = (ref: string) =>
  rows<{ no: string; type: number; code: string; qty: number }>(
    `SELECT h.inventory_no AS no, h.inventory_type_id AS type, d.item_code AS code, d.item_quantity::float AS qty
       FROM inventory_hd h JOIN inventory_dt d ON d.inventory_no = h.inventory_no
      WHERE h.reference_document_no = $1 ORDER BY h.inventory_no`,
    [ref],
  );
