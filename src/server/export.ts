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
import { listCustomers, customerFiltersFromQuery, pageCustomers } from '@/server/services/customers';
import {
  canSeeCost,
  pageProducts,
  listMovements,
  listIssuedLines,
  pageMovements,
  pageIssuedLines,
  productFiltersFromQuery,
} from '@/server/services/stock';
import { audit, listAudit, pageAudit } from '@/server/audit';
import { db } from '@/db/client';
import { ANOMALY_CATEGORIES, ANOMALY_KEYS, anomalyPage, type AnomalyCategory } from '@/server/services/anomalies';
import { filtersFromQuery, pageJobs } from '@/server/services/jobs';
import { listQuotations, quotationFiltersFromQuery, pageQuotations } from '@/server/services/quotations';
import { listSaleOrders, saleOrderFiltersFromQuery, pageSaleOrders } from '@/server/services/sale-orders';
import { today } from '@/lib/dates';
import { fieldLabel, fieldValue } from '@/lib/field-labels';
import { logError } from '@/lib/log';
import { rateLimit } from '@/server/rate-limit';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import { reportPage, REPORT_MODULE } from '@/server/services/reports';
import { defaultDocumentProfile } from '@/server/services/document-profiles';
import { REPORT_KEYS, REPORT_SPECS, isReportKey, type ReportCol } from '@/app/(app)/reports/report-specs';

/**
 * Excel export (.xlsx via exceljs) of a list under the SAME filters the screen
 * uses — the URL query is the one the page's hooks send to /api/data/<resource>.
 * Runs on the server, capped at MAX_ROWS so a runaway range cannot exhaust memory
 * (the rows are loaded in memory on a 512 MB instance; the file itself is streamed). Every list function caps
 * at the same 20k, so a capped file is detectable — and it says so: a note row at
 * the end and "-partial" in the file name, never a silently short file.
 */
/** whole days between two dates, by their date parts (as the close-job report's TAT) */
const calendarDays = (from: string, to: string) =>
  Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);

const MAX_ROWS = MAX_EXPORT_ROWS;

/** `cost` = ราคาทุน: only for a user with Product Cost */
type Col = ReportCol;
/** a row of any list: read by column key, so every list function's own type fits without a cast */
type Row = object;

// no ID column (ADR 0008): the row's uuid tells a reader nothing — the pages no longer show it either
const MASTER_COLS: Col[] = [
  { key: 'name', header: 'ชื่อ', width: 40 },
  { key: 'detail', header: 'รายละเอียด', width: 40 },
  { key: 'status', header: 'สถานะ', width: 10 },
];

const SPECS: Record<string, { title: string; module: Module | null; cols: Col[] }> = {
  users: {
    title: 'ผู้ใช้ระบบ',
    module: null,
    cols: [
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
      { key: 'channel', header: 'ช่องทางการขาย', width: 14 },
      { key: 'brandModel', header: 'ยี่ห้อ/รุ่น', width: 28 },
      { key: 'imei', header: 'IMEI', width: 18 },
      { key: 'serial', header: 'Serial', width: 18 },
      { key: 'jobType', header: 'ประเภทงาน', width: 22 },
      { key: 'symptom', header: 'อาการเสีย', width: 26 },
      { key: 'owner', header: 'ผู้รับผิดชอบ', width: 20 },
      { key: 'status', header: 'สถานะงาน', width: 34 },
      { key: 'repairedDate', header: 'วันที่ซ่อมเสร็จ', width: 18 },
      { key: 'closedDate', header: 'วันที่ปิดงาน', width: 18 },
      { key: 'tat', header: 'TAT (วัน)', width: 10 }, // calendar days open → return / close / today
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
      { key: 'capitalPrice', header: 'ราคาทุน', width: 12, money: true, cost: true },
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
    { key: 'email', header: 'อีเมล', width: 28 },
    { key: 'role', header: 'ตำแหน่ง (ขณะนั้น)', width: 18 },
    { key: 'department', header: 'แผนก (ขณะนั้น)', width: 18 },
    { key: 'action', header: 'การกระทำ', width: 10 },
    { key: 'module', header: 'โมดูล', width: 20 },
    { key: 'entity', header: 'ตาราง', width: 16 },
    { key: 'no', header: 'เลขที่', width: 16 },
    { key: 'key', header: 'รหัสรายการ', width: 16 },
    { key: 'summary', header: 'รายละเอียด', width: 60 },
    { key: 'changesText', header: 'ค่าที่เปลี่ยน', width: 60 },
    { key: 'reason', header: 'เหตุผล', width: 30 },
  ],
};

SPECS.anomalies = {
  title: 'ข้อมูลผิดปกติ',
  module: null,
  cols: [
    { key: 'categoryLabel', header: 'ประเภท', width: 34 },
    { key: 'ref', header: 'เลขที่/รหัส', width: 16 },
    { key: 'message', header: 'รายละเอียด', width: 60 },
    { key: 'stored', header: 'ค่าที่บันทึก', width: 14, money: true },
    { key: 'expected', header: 'ค่าที่ควรเป็น', width: 14, money: true },
  ],
};

/** ?category= of the anomaly export: one of ANOMALY_KEYS, else every category */
const anomalyCategory = (v: string | undefined) =>
  ANOMALY_KEYS.includes(v as AnomalyCategory) ? (v as AnomalyCategory) : undefined;
/** the audit log's filters, as its page sends them */
const logFilters = (f: Record<string, string>) => ({
  from: f.from,
  to: f.to,
  user: f.user,
  role: f.role,
  no: f.no,
});

for (const k of ['categories', 'manufacturers', 'colors', 'job_types', 'product_types', 'symptoms']) {
  SPECS[k] = { title: k, module: null, cols: MASTER_COLS };
}
// the reports' row-level tables (report-specs.ts), with the module each report page always exported under
for (const k of REPORT_KEYS) SPECS[`report_${k}`] = { ...REPORT_SPECS[k], module: REPORT_MODULE[k] };

/** a report key of `report_<key>` */
const reportOf = (resource: string) => {
  const k = resource.slice('report_'.length);
  return resource.startsWith('report_') && isReportKey(k) ? k : null;
};

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
  const report = reportOf(resource);
  if (report) return (await reportPage(report, { ...p, page: 1, pageSize: MAX_ROWS }, await canSeeCost(user))).rows;
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
    case 'users': {
      // the page's filter bar (admin/users: evaluated in the browser over the whole list) — the same rules here
      const has = (v: string, t = '') => !t.trim() || v.toLowerCase().includes(t.trim().toLowerCase());
      return (await listSystemUsers(mode)).filter(
        (u) =>
          has(u.name, f.name) &&
          has(u.username, f.username) &&
          (!f.role || u.role === f.role) &&
          (!f.status || u.status === f.status),
      );
    }
    case 'customers':
      return listCustomers({
        q: p.q,
        // deleted customers (PDPA: erased on request) are System Admin's alone — as GET /api/data/customers
        deleted: !user.isAdmin && (mode === 'only' || mode === 'all') ? 'exclude' : mode,
        limit: MAX_ROWS,
        filters: customerFiltersFromQuery(f),
      });
    case 'jobs':
      // ยอดชำระ = money taken (≥ 0); a refund (stored as a negative payment) is its own คืนเงิน column;
      // ค้างชำระ only on a closed job — an open one is not billed yet
      // in the order the table shows (its sort, as on screen)
      return (await pageJobs({ ...p, page: 1, pageSize: MAX_ROWS }, filtersFromQuery(f))).rows.map((j) => ({
        ...j,
        // as the dashboard's TAT (jobs.ts tatDays): to the return, else the close, else today
        tat: j.openDate ? calendarDays(j.openDate, j.returnDate || j.closedDate || today()) : '',
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
          ...logFilters(f),
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
              .map(([k, [a, b]]) => `${fieldLabel(k)}: ${fieldValue(a)} → ${fieldValue(b)}`)
              .join('; ')
          : '',
      }));
    case 'anomalies':
      // one SQL page of at most MAX_ROWS (anomalyPage's own LIMIT) — never the whole set
      return (await anomalyPage({ ...p, page: 1, pageSize: MAX_ROWS }, anomalyCategory(f.category))).rows.map((r) => ({
        ...r,
        categoryLabel: ANOMALY_CATEGORIES[r.category],
      }));
  }
  throw new HttpError(404, `unknown export: ${resource}`);
}

/** How many rows the filters match in all, for a file that hit the cap: the paged list's own count under the same
 *  filters (the route answers it as X-Export-Truncated, the button says "ส่งออกได้ 20,000 จาก N แถว"). */
async function totalRows(sp: URLSearchParams, resource: string, user: CurrentUser): Promise<number> {
  const p = { ...parsePageQuery(sp), page: 1, pageSize: 1 };
  const mode = parseStatusMode(sp.get('deleted'));
  const f = p.f;
  const report = reportOf(resource);
  if (report) return (await reportPage(report, p)).total;
  switch (resource) {
    case 'jobs':
      return (await pageJobs(p, filtersFromQuery(f))).total;
    case 'quotations':
      return (await pageQuotations(p, quotationFiltersFromQuery(f, mode))).total;
    case 'sale_orders':
      return (await pageSaleOrders(p, saleOrderFiltersFromQuery(f, mode))).total;
    case 'customers':
      return (
        await pageCustomers(
          p,
          !user.isAdmin && (mode === 'only' || mode === 'all') ? 'exclude' : mode,
          customerFiltersFromQuery(f),
        )
      ).total;
    case 'products':
      return (await pageProducts(p, productFiltersFromQuery(f, mode))).total;
    case 'movements':
      return (await pageMovements(p, { from: f.from, to: f.to, type: f.type, code: f.code, doc: f.doc, ref: f.ref }))
        .total;
    case 'issued_lines':
      return (await pageIssuedLines(p, { from: f.from, to: f.to, category: f.category, code: f.code })).total;
    case 'audit_log':
      return (
        await pageAudit(p, {
          ...logFilters(f),
          module: f.module,
          entity: f.entity,
          key: f.key,
          action: f.action,
        })
      ).total;
    case 'anomalies':
      return (await anomalyPage(p, anomalyCategory(f.category))).matched;
  }
  return MAX_ROWS; // the small lists (masters, users) never reach the cap
}

/** One export at a time per process: a second concurrent one answers 429 instead of doubling the memory.
 *  Owned by a token: an export's own (late, repeated) release never frees the slot a next export took. */
let slot: object | null = null;

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
): Promise<{
  stream: ReadableStream<Uint8Array>;
  filename: string;
  /** the rows the filters match, when the file stops at MAX_ROWS (doc / html: PRINT_MAX) */
  truncatedOf?: number;
  /** ?format=doc|html: the Word file / print view instead of the workbook */
  contentType: string;
}> {
  const spec = SPECS[resource];
  if (!spec) throw new HttpError(404, `unknown export: ${resource}`);
  const user = spec.module === null ? await requireAdmin(req) : await requireCan(req, spec.module, 'view');
  // ส่งออก Excel is its own special right on top of seeing the list
  if (!(await hasRight(user, 'Export'))) throw new HttpError(403, noRight('Export'));
  const busy = () => new HttpError(429, 'มีการส่งออกอยู่ กรุณาลองใหม่อีกครั้ง', { retryAfter: 10 });
  // busy first, so a "มีการส่งออกอยู่" refusal does not use up the user's 5 a minute; the limit before the
  // slot, so a user over it never holds the slot another user is waiting for
  if (slot) throw busy();
  await rateLimit(req, 'export', 5); // xlsx of up to 20k rows (MAX_ROWS) is the heaviest thing we do
  if (slot) throw busy(); // taken while the limit was checked — no await from here to slot = mine
  const mine = {};
  slot = mine;
  const release = () => {
    if (slot === mine) slot = null;
  };
  const format = query.format === 'doc' || query.format === 'html' ? query.format : 'xlsx';
  const cap = format === 'xlsx' ? MAX_ROWS : PRINT_MAX;
  const what = { xlsx: 'Excel', doc: 'Word', html: 'PDF' }[format];
  let rows: Row[];
  let cols: Col[];
  let total = 0;
  try {
    rows = await loadRows(searchOf(query), resource, user);
    total = rows.length >= MAX_ROWS ? await totalRows(searchOf(query), resource, user) : rows.length;
    // ราคาทุน: only for a user who may see it — without it the column goes too, not a column of zeros
    const cost = await canSeeCost(user);
    cols = spec.cols.filter((c) => cost || !c.cost);
    // who took which data out, before a byte leaves: no record, no file
    const filters = Object.fromEntries(
      Object.entries(query).filter(([k, v]) => v !== undefined && v !== '' && k !== 'file'),
    );
    // a Word / print (PDF) view is a printout (security_log PRINT); the request's ip is audit()'s own
    await audit(db, user.pk, {
      action: format === 'xlsx' ? 'EXPORT' : 'PRINT',
      module: spec.module ?? 'Admin',
      entity: resource,
      key: resource,
      summary: `ส่งออก ${what} ${spec.title} ${Math.min(rows.length, cap).toLocaleString('en-US')} แถว`,
      meta: { rows: Math.min(rows.length, cap), filters },
    });
  } catch (e) {
    release();
    throw e;
  }
  const stamp = today(); // Thai calendar date in the file name
  // ?file= the report's own name (repair-job, close-job … — every job report exports `jobs`); a-z 0-9 - only
  const file = typeof query.file === 'string' && /^[a-z0-9-]{1,40}$/.test(query.file) ? query.file : resource;

  if (format !== 'xlsx') {
    try {
      const html = await reportHtml({
        title: spec.title,
        cond: typeof query.cond === 'string' ? query.cond.slice(0, 500) : '',
        cols,
        rows: rows.slice(0, PRINT_MAX),
        total,
        word: format === 'doc',
      });
      return {
        stream: new Response(format === 'doc' ? `\ufeff${html}` : html).body!,
        filename: `${file}-${stamp}${total > PRINT_MAX ? '-partial' : ''}.${format === 'doc' ? 'doc' : 'html'}`,
        truncatedOf: total > PRINT_MAX ? total : undefined,
        contentType: format === 'doc' ? 'application/msword; charset=utf-8' : 'text/html; charset=utf-8',
      };
    } finally {
      release();
    }
  }

  // ponytail: no backpressure into the writer — a slow client buffers the zipped file (a few MB at 20k rows)
  // so the slot never waits on the network
  const out = new PassThrough({ highWaterMark: 64 * 1024 * 1024 });
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

  const truncated = total > MAX_ROWS;
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
  return {
    stream: Readable.toWeb(out) as ReadableStream<Uint8Array>,
    filename: `${file}-${stamp}${truncated ? '-partial' : ''}.xlsx`,
    truncatedOf: truncated ? total : undefined,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/** the Word / print (PDF) export's row cap: a browser prints, and Word opens, a few thousand table rows well */
export const PRINT_MAX = 3000;

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const cellText = (c: Col, v: unknown) =>
  c.money
    ? Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : c.num
      ? Number(v ?? 0).toLocaleString('en-US')
      : String(v ?? '');

/**
 * The report as one HTML table — the Word export (.doc: Word opens HTML, UTF-8 BOM + meta so Thai shows) and the
 * print view the page writes into a new tab and prints (save as PDF): landscape A4, the company header, the
 * filters in words, every row up to PRINT_MAX (a cut one says so above the table).
 */
async function reportHtml(o: { title: string; cond: string; cols: Col[]; rows: Row[]; total: number; word: boolean }) {
  const company = await defaultDocumentProfile().catch(() => null);
  const printed = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const cut =
    o.total > o.rows.length
      ? `<p class="warn">⚠ แสดง ${o.rows.length.toLocaleString('en-US')} แถวแรกจาก ${o.total.toLocaleString('en-US')} แถว — กรองช่วงวันที่/เงื่อนไขให้แคบลง หรือใช้ส่งออก Excel เพื่อได้ข้อมูลครบ</p>`
      : '';
  const head = o.cols.map((c) => `<th>${esc(c.header)}</th>`).join('');
  const body = o.rows
    .map(
      (r) =>
        `<tr>${o.cols.map((c) => `<td${c.money || c.num ? ' class="r"' : ''}>${esc(cellText(c, (r as Record<string, unknown>)[c.key]))}</td>`).join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="th"${o.word ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ''}>
<head><meta charset="utf-8"><title>${esc(o.title)}</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
${o.word ? '@page Section1 { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 0.4in; } div.Section1 { page: Section1; }' : ''}
body { font-family: 'Noto Sans Thai', 'Sarabun', Tahoma, 'Leelawadee UI', Thonburi, sans-serif; font-size: 9pt; color: #000; margin: 0; }
h1 { font-size: 13pt; margin: 0 0 2pt; } .co { font-size: 10pt; font-weight: bold; } .sub { margin: 0 0 4pt; color: #333; }
.warn { color: #b45309; font-weight: bold; }
table { border-collapse: collapse; width: 100%; } thead { display: table-header-group; }
th, td { border: 0.5pt solid #999; padding: 2pt 3pt; vertical-align: top; text-align: left; }
th { background: #e8eef9; font-weight: bold; } td.r { text-align: right; white-space: nowrap; } tr { page-break-inside: avoid; }
</style></head>
<body><div class="Section1">
${company ? `<div class="co">${esc(company.nameTh || company.nameEn)}</div><div class="sub">${esc([company.address, company.phone && `โทร ${company.phone}`].filter(Boolean).join(' '))}</div>` : ''}
<h1>${esc(o.title)}</h1>
<p class="sub">${esc(o.cond || 'ทุกรายการ')} · ${o.total.toLocaleString('en-US')} แถว · พิมพ์เมื่อ ${esc(printed)}</p>
${cut}
<table><thead><tr>${head}</tr></thead><tbody>
${body}
</tbody></table>
</div></body></html>`;
}
