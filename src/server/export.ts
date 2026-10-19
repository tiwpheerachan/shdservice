import 'server-only';
import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { NextRequest } from 'next/server';
import { hasRight, HttpError, parseQuery, requireAdmin, requireCan, type CurrentUser } from '@/server/auth';
import { exportXlsx as exportOperation } from '@/server/contract/data';
import { parsePageQuery, searchOf } from '@/server/paging';
import { parseStatusMode } from '@/server/record-status';
import { noRight, type Module } from '@/lib/modules';
import { listSimple, isSimpleKind, listSymptoms, listModels } from '@/server/services/masters';
import { listSystemUsers } from '@/server/services/users';
import { listCustomers, customerFiltersFromQuery } from '@/server/services/customers';
import {
  canSeeCost,
  pageProducts,
  listMovements,
  listIssuedLines,
  productFiltersFromQuery,
} from '@/server/services/stock';
import { listAudit } from '@/server/audit';
import { listJobs, filtersFromQuery } from '@/server/services/jobs';
import { listQuotations, quotationFiltersFromQuery } from '@/server/services/quotations';
import { listSaleOrders, saleOrderFiltersFromQuery } from '@/server/services/sale-orders';
import { today } from '@/lib/dates';
import { fieldLabel } from '@/lib/field-labels';
import { logError } from '@/lib/log';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';

/**
 * Excel export (.xlsx via exceljs) of a list under the SAME filters the screen
 * uses — the URL query is the one the page's hooks send to /api/data/<resource>.
 * Runs on the server, capped at MAX_ROWS so a runaway range cannot exhaust memory
 * (the rows are loaded in memory on a 512 MB instance; the file itself is streamed). Every list function caps
 * at the same 20k, so a capped file is detectable — and it says so: a note row at
 * the end and "-partial" in the file name, never a silently short file.
 */
const MAX_ROWS = MAX_EXPORT_ROWS;

type Col = { key: string; header: string; width?: number; num?: boolean; money?: boolean };
/** a row of any list: read by column key, so every list function's own type fits without a cast */
type Row = object;

const MASTER_COLS: Col[] = [
  { key: 'id', header: 'ID', width: 8 },
  { key: 'name', header: 'ชื่อ', width: 40 },
  { key: 'detail', header: 'รายละเอียด', width: 40 },
  { key: 'status', header: 'สถานะ', width: 10 },
];

const SPECS: Record<string, { title: string; module: Module | null; cols: Col[] }> = {
  users: {
    title: 'ผู้ใช้ระบบ',
    module: null,
    cols: [
      { key: 'id', header: 'ID', width: 8 },
      { key: 'name', header: 'ชื่อ-สกุล', width: 30 },
      { key: 'username', header: 'Username', width: 18 },
      { key: 'email', header: 'อีเมล', width: 34 },
      { key: 'role', header: 'บทบาท', width: 18 },
      { key: 'branch', header: 'หน่วยงาน', width: 20 },
      { key: 'phone', header: 'โทรศัพท์', width: 14 },
      { key: 'lastLogin', header: 'เข้าใช้ล่าสุด', width: 18 },
      { key: 'status', header: 'สถานะ', width: 10 },
    ],
  },
  models: {
    title: 'รุ่นสินค้า',
    module: null,
    cols: [
      { key: 'code', header: 'Model Code', width: 12 },
      { key: 'name', header: 'Model Name', width: 32 },
      { key: 'brand', header: 'ยี่ห้อ', width: 18 },
      { key: 'price', header: 'Market Price', width: 14, money: true },
      { key: 'updated', header: 'Last Update', width: 18 },
      { key: 'status', header: 'สถานะ', width: 10 },
    ],
  },
  customers: {
    title: 'ลูกค้า',
    module: 'Customer',
    cols: [
      { key: 'code', header: 'รหัสลูกค้า', width: 12 },
      { key: 'name', header: 'ชื่อ-สกุล', width: 32 },
      { key: 'taxId', header: 'เลขบัตร/ผู้เสียภาษี', width: 18 },
      { key: 'address', header: 'ที่อยู่', width: 50 },
      { key: 'phone', header: 'โทรศัพท์', width: 14 },
      { key: 'email', header: 'อีเมล', width: 26 },
      { key: 'line', header: 'Line ID', width: 16 },
      { key: 'type', header: 'ประเภท', width: 12 },
      { key: 'status', header: 'สถานะ', width: 10 },
    ],
  },
  jobs: {
    title: 'รายการงาน',
    module: 'Job Management',
    cols: [
      { key: 'no', header: 'เลขที่งาน', width: 12 },
      { key: 'openDate', header: 'วันที่เปิดงาน', width: 18 },
      { key: 'customer', header: 'ลูกค้า', width: 36 },
      { key: 'so', header: 'เลขคำสั่งซื้อ', width: 18 },
      { key: 'channel', header: 'ช่องทาง', width: 14 },
      { key: 'brandModel', header: 'ยี่ห้อ/รุ่น', width: 28 },
      { key: 'imei', header: 'IMEI', width: 18 },
      { key: 'serial', header: 'Serial', width: 18 },
      { key: 'jobType', header: 'ประเภทงาน', width: 22 },
      { key: 'symptom', header: 'อาการเสีย', width: 26 },
      { key: 'owner', header: 'ผู้รับผิดชอบ', width: 20 },
      { key: 'status', header: 'สถานะงาน', width: 34 },
      { key: 'repairedDate', header: 'วันที่ซ่อมเสร็จ', width: 18 },
      { key: 'closedDate', header: 'วันที่ปิดงาน', width: 18 },
      { key: 'returnType', header: 'วิธีส่งคืน', width: 18 },
      { key: 'returnTracking', header: 'เลขพัสดุ', width: 18 },
      { key: 'partsCost', header: 'ค่าอะไหล่', width: 12, money: true },
      { key: 'serviceCost', header: 'ค่าบริการ', width: 12, money: true },
      { key: 'amount', header: 'รวมสุทธิ', width: 12, money: true },
      { key: 'paymentType', header: 'วิธีชำระ', width: 12 },
      { key: 'paymentAmount', header: 'ยอดชำระ', width: 12, money: true },
      { key: 'refund', header: 'คืนเงิน', width: 12, money: true },
      { key: 'deposit', header: 'มัดจำ', width: 12, money: true },
      { key: 'outstanding', header: 'ค้างชำระ', width: 12, money: true }, // jobBalance — closed jobs only
    ],
  },
  quotations: {
    title: 'ใบเสนอราคา',
    module: 'Quotation',
    cols: [
      { key: 'no', header: 'เลขที่', width: 12 },
      { key: 'date', header: 'วันที่', width: 18 },
      { key: 'type', header: 'ประเภท', width: 16 },
      { key: 'customerCode', header: 'รหัสลูกค้า', width: 12 },
      { key: 'customer', header: 'ลูกค้า', width: 30 },
      { key: 'jobRef', header: 'งานซ่อม', width: 12 },
      { key: 'brandModel', header: 'ยี่ห้อ/รุ่น', width: 26 },
      { key: 'partsAmount', header: 'ค่าอะไหล่', width: 12, money: true },
      { key: 'serviceAmount', header: 'ค่าบริการ', width: 12, money: true },
      { key: 'discountAmount', header: 'ส่วนลด', width: 12, money: true },
      { key: 'vatAmount', header: 'VAT', width: 10, money: true },
      { key: 'amount', header: 'สุทธิ', width: 12, money: true },
      { key: 'status', header: 'สถานะ', width: 26 },
      { key: 'approveDate', header: 'วันที่ลูกค้าตกลง', width: 18 },
      { key: 'createdBy', header: 'ผู้สร้าง', width: 20 },
    ],
  },
  sale_orders: {
    title: 'ใบสั่งขาย',
    module: 'Sale Order',
    cols: [
      { key: 'no', header: 'SO No.', width: 12 },
      { key: 'date', header: 'วันที่', width: 18 },
      { key: 'customerCode', header: 'รหัสลูกค้า', width: 12 },
      { key: 'customer', header: 'ลูกค้า', width: 30 },
      { key: 'sales', header: 'พนักงานขาย', width: 20 },
      { key: 'amount', header: 'ยอดสุทธิ', width: 12, money: true },
      { key: 'paymentType', header: 'วิธีชำระ', width: 12 },
      { key: 'paymentAmount', header: 'ยอดชำระ', width: 12, money: true },
      { key: 'approve', header: 'สถานะอนุมัติ', width: 18 },
      { key: 'approvedBy', header: 'ผู้อนุมัติ', width: 20 },
      { key: 'stockDoc', header: 'เอกสารจ่ายสต๊อก', width: 14 },
      { key: 'tracking', header: 'Tracking', width: 18 },
      { key: 'deliveryDate', header: 'วันที่จัดส่ง', width: 18 },
    ],
  },
  products: {
    title: 'อะไหล่',
    module: 'Product',
    cols: [
      { key: 'sysCode', header: 'รหัส (ระบบ)', width: 12 },
      { key: 'mfgCode', header: 'รหัส (ผู้ผลิต)', width: 22 },
      { key: 'name', header: 'ชื่ออะไหล่', width: 44 },
      { key: 'category', header: 'หมวดหมู่', width: 16 },
      { key: 'brand', header: 'ยี่ห้อ', width: 16 },
      { key: 'onhand', header: 'คงเหลือ', width: 10, num: true },
      { key: 'received', header: 'รับเข้าสะสม', width: 12, num: true },
      { key: 'issued', header: 'จ่ายออกสะสม', width: 12, num: true },
      { key: 'capitalPrice', header: 'ราคาทุน', width: 12, money: true },
      { key: 'price', header: 'ราคาขาย', width: 12, money: true },
      { key: 'value', header: 'มูลค่าคงเหลือ', width: 14, money: true }, // pageProducts: max(0, คงเหลือ) × ราคาขาย
      { key: 'status', header: 'สถานะ', width: 10 },
    ],
  },
  movements: {
    title: 'ประวัติสต๊อก',
    module: 'Product Onhand',
    cols: [
      { key: 'doc', header: 'เลขเอกสาร', width: 14 },
      { key: 'type', header: 'ประเภท', width: 22 },
      { key: 'ref', header: 'อ้างอิง', width: 14 },
      { key: 'date', header: 'วันที่', width: 18 },
      { key: 'by', header: 'ผู้ทำรายการ', width: 20 },
      { key: 'qty', header: 'จำนวนรวม', width: 10, num: true },
      { key: 'items', header: 'รายการ', width: 60 },
    ],
  },
  issued_lines: {
    title: 'รายงานเบิกจ่ายอะไหล่',
    module: 'Report',
    cols: [
      { key: 'doc', header: 'เลขเอกสาร', width: 14 },
      { key: 'date', header: 'วันที่', width: 18 },
      { key: 'type', header: 'ประเภท', width: 22 },
      { key: 'ref', header: 'อ้างอิง', width: 14 },
      { key: 'code', header: 'รหัสอะไหล่', width: 12 },
      { key: 'item', header: 'ชื่ออะไหล่', width: 44 },
      { key: 'category', header: 'หมวดหมู่', width: 16 },
      { key: 'qty', header: 'จำนวน (รับคืน = ติดลบ)', width: 12, num: true },
      { key: 'price', header: 'ราคาต่อหน่วย', width: 12, money: true },
      { key: 'priceBasis', header: 'ที่มาราคา', width: 14 },
      { key: 'value', header: 'มูลค่า', width: 12, money: true },
      { key: 'by', header: 'ผู้ทำรายการ', width: 20 },
    ],
  },
};

SPECS.audit_log = {
  title: 'ประวัติการใช้งาน',
  module: null,
  cols: [
    { key: 'at', header: 'เวลา', width: 18 },
    { key: 'user', header: 'ผู้ใช้', width: 24 },
    { key: 'action', header: 'การกระทำ', width: 10 },
    { key: 'module', header: 'โมดูล', width: 20 },
    { key: 'entity', header: 'ตาราง', width: 16 },
    { key: 'key', header: 'เลขที่/รหัส', width: 16 },
    { key: 'summary', header: 'รายละเอียด', width: 60 },
    { key: 'changesText', header: 'ค่าที่เปลี่ยน', width: 60 },
  ],
};

for (const k of ['categories', 'manufacturers', 'colors', 'job_types', 'product_types', 'symptoms']) {
  SPECS[k] = { title: k, module: null, cols: MASTER_COLS };
}

async function loadRows(sp: URLSearchParams, resource: string, user: CurrentUser): Promise<Row[]> {
  const p = parsePageQuery(sp);
  const mode = parseStatusMode(sp.get('deleted'));
  const f = p.f;
  // master lists: ?q= (name contains) and ?status=Active|Inactive from the page's filter bar
  const masterFilter = <T extends { name: string; status: string }>(rows: T[]) => {
    const term = p.q.trim().toLowerCase();
    return rows.filter((r) => (!term || r.name.toLowerCase().includes(term)) && (!f.status || r.status === f.status));
  };
  if (isSimpleKind(resource)) return masterFilter(await listSimple(resource, mode));
  switch (resource) {
    case 'symptoms':
      return masterFilter(await listSymptoms(mode));
    case 'models':
      return (await listModels(mode)).filter(
        (m) =>
          (!f.brand || m.brand === f.brand) &&
          (!f.code || m.code.toLowerCase().includes(f.code.toLowerCase())) &&
          (!f.name || m.name.toLowerCase().includes(f.name.toLowerCase())) &&
          (!f.status || m.status === f.status),
      );
    case 'users':
      return listSystemUsers(mode);
    case 'customers':
      return listCustomers({
        q: p.q,
        deleted: mode,
        limit: MAX_ROWS,
        filters: customerFiltersFromQuery(f),
      });
    case 'jobs':
      // ยอดชำระ = money taken (≥ 0); a refund (stored as a negative payment) is its own คืนเงิน column;
      // ค้างชำระ only on a closed job — an open one is not billed yet
      return (await listJobs({ ...filtersFromQuery(f), q: p.q, limit: MAX_ROWS })).map((j) => ({
        ...j,
        paymentAmount: Math.max(0, j.paymentAmount ?? 0),
        refund: Math.max(0, -(j.paymentAmount ?? 0)),
        outstanding: j.statusGroup === 'Finished' ? j.outstanding : 0,
      }));
    case 'quotations':
      return listQuotations({ ...quotationFiltersFromQuery(f, mode), q: p.q, limit: MAX_ROWS });
    case 'sale_orders':
      return listSaleOrders({ ...saleOrderFiltersFromQuery(f, mode), q: p.q, limit: MAX_ROWS });
    case 'products':
      // same filters as the products list / stock report tables (category, brand, stock state, …)
      return (
        await pageProducts(
          { ...p, page: 1, pageSize: MAX_ROWS },
          productFiltersFromQuery(f, mode),
          await canSeeCost(user),
        )
      ).rows;
    case 'movements':
      return listMovements({
        q: p.q,
        from: f.from,
        to: f.to,
        type: f.type,
        code: f.code,
        doc: f.doc,
        ref: f.ref,
        limit: MAX_ROWS,
      });
    case 'issued_lines':
      return listIssuedLines({
        from: f.from,
        to: f.to,
        category: f.category,
        code: f.code || p.q,
        limit: MAX_ROWS,
      });
    case 'audit_log':
      return (
        await listAudit({
          q: p.q,
          from: f.from,
          to: f.to,
          user: f.user,
          module: f.module,
          entity: f.entity,
          key: f.key,
          action: f.action,
          limit: MAX_ROWS,
        })
      ).map((r) => ({
        ...r,
        changesText: r.changes
          ? Object.entries(r.changes)
              .map(([k, [a, b]]) => `${fieldLabel(k)}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
              .join('; ')
          : '',
      }));
  }
  throw new HttpError(404, `unknown export: ${resource}`);
}

/** One export at a time per process: a second concurrent one answers 429 instead of doubling the memory. */
let exporting = false;

/**
 * `query` = the request's query as GET /export/{resource} declares it (any other name is a filter, as on /data).
 * The workbook is streamed (exceljs WorkbookWriter, inline strings): 20k rows × 24 Thai columns run in a ~90 MB
 * heap, rows included, where the in-memory Workbook ran out of 400 MB. The slot is freed once the file is
 * written or the client goes away.
 */
export async function exportXlsx(
  req: NextRequest,
  resource: string,
  query: Record<string, unknown> = parseQuery(req, exportOperation),
): Promise<{ stream: ReadableStream<Uint8Array>; filename: string }> {
  const spec = SPECS[resource];
  if (!spec) throw new HttpError(404, `unknown export: ${resource}`);
  const user = spec.module === null ? await requireAdmin(req) : await requireCan(req, spec.module, 'view');
  // ส่งออก Excel is its own special right on top of seeing the list
  if (!(await hasRight(user, 'Export'))) throw new HttpError(403, noRight('Export'));
  if (exporting) throw new HttpError(429, 'มีการส่งออกอยู่ กรุณาลองใหม่อีกครั้ง', { retryAfter: 10 });
  exporting = true;
  let rows: Row[];
  let cols: Col[];
  try {
    rows = await loadRows(searchOf(query), resource, user);
    // ราคาทุน: only for a user who may see it — without it the column goes too, not a column of zeros
    cols =
      resource === 'products' && !(await canSeeCost(user))
        ? spec.cols.filter((c) => c.key !== 'capitalPrice')
        : spec.cols;
  } catch (e) {
    exporting = false;
    throw e;
  }

  // ponytail: no backpressure into the writer — a slow client buffers the zipped file (a few MB at 20k rows)
  // so the slot never waits on the network
  const out = new PassThrough({ highWaterMark: 64 * 1024 * 1024 });
  const release = () => (exporting = false);
  const gone = new Promise<void>((resolve) => out.once('close', resolve)); // done, or the client went away
  void gone.then(release);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = 'OneService';
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; // written on ws.commit()
  // number formats on the column itself: a streamed cell takes its column's style when it is created
  ws.columns = cols.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
    style: c.money ? { numFmt: '#,##0.00' } : c.num ? { numFmt: '#,##0' } : {},
  }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
  head.commit();

  const truncated = rows.length >= MAX_ROWS;
  void (async () => {
    let n = 0;
    for (const r of rows.slice(0, MAX_ROWS)) {
      if (out.destroyed) return; // client went away: stop (the zip would never finish and pin the rows)
      const line: Record<string, unknown> = {};
      for (const c of cols) {
        const v = (r as Record<string, unknown>)[c.key];
        line[c.key] = c.money || c.num ? Number(v ?? 0) : (v ?? '');
      }
      ws.addRow(line).commit();
      // let the zip stream drain now and then, or every row's XML waits in memory until the loop ends
      if (++n % 500 === 0) await new Promise(setImmediate);
    }
    if (truncated) {
      const note = ws.addRow([
        `⚠ แสดง ${MAX_ROWS.toLocaleString('en-US')} แถวแรกเท่านั้น — กรองช่วงวันที่/เงื่อนไขให้แคบลงเพื่อได้ข้อมูลครบ`,
      ]);
      note.font = { bold: true, color: { argb: 'FFB45309' } };
      note.commit();
    }
    ws.commit();
    release(); // every row is in the zip — freed before the client can finish reading, so a next export never races it
    await Promise.race([wb.commit(), gone]);
  })()
    .catch((e) => {
      logError(e, 'export failed mid-stream', { resource }, req);
      out.destroy(e instanceof Error ? e : new Error(String(e)));
    })
    .finally(release);
  const stamp = today(); // Thai calendar date in the file name
  return {
    stream: Readable.toWeb(out) as ReadableStream<Uint8Array>,
    filename: `${resource}-${stamp}${truncated ? '-partial' : ''}.xlsx`,
  };
}
