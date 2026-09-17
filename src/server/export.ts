import "server-only";
import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { HttpError, requireAdmin, requireCan, requireUser, type CurrentUser } from "@/server/auth";
import { parsePageQuery } from "@/server/paging";
import { parseStatusMode } from "@/server/record-status";
import type { Module } from "@/lib/modules";
import { listSimple, isSimpleKind, listSymptoms, listModels } from "@/server/services/masters";
import { listSystemUsers } from "@/server/services/users";
import { listCustomers } from "@/server/services/customers";
import { pageProducts, listMovements, listIssuedLines, type ProductFilters } from "@/server/services/stock";
import { listAudit } from "@/server/audit";
import { listJobs, filtersFromQuery } from "@/server/services/jobs";
import { listQuotations } from "@/server/services/quotations";
import { listSaleOrders } from "@/server/services/sale-orders";

/**
 * Excel export (.xlsx via exceljs) of a list under the SAME filters the screen
 * uses — the URL query is the one the page's hooks send to /api/data/<resource>.
 * Runs on the server, capped at MAX_ROWS so a runaway range cannot exhaust memory.
 */
const MAX_ROWS = 50_000;

type Col = { key: string; header: string; width?: number; num?: boolean; money?: boolean };
type Row = Record<string, unknown>;

const MASTER_COLS: Col[] = [
  { key: "id", header: "ID", width: 8 },
  { key: "name", header: "ชื่อ", width: 40 },
  { key: "detail", header: "รายละเอียด", width: 40 },
  { key: "status", header: "สถานะ", width: 10 },
];

const SPECS: Record<string, { title: string; module: Module | null | "any"; cols: Col[] }> = {
  users: {
    title: "ผู้ใช้ระบบ",
    module: null,
    cols: [
      { key: "id", header: "ID", width: 8 },
      { key: "name", header: "ชื่อ-สกุล", width: 30 },
      { key: "username", header: "Username", width: 18 },
      { key: "email", header: "อีเมล", width: 34 },
      { key: "role", header: "บทบาท", width: 18 },
      { key: "branch", header: "หน่วยงาน", width: 20 },
      { key: "phone", header: "โทรศัพท์", width: 14 },
      { key: "lastLogin", header: "เข้าใช้ล่าสุด", width: 18 },
      { key: "status", header: "สถานะ", width: 10 },
    ],
  },
  models: {
    title: "รุ่นสินค้า",
    module: null,
    cols: [
      { key: "code", header: "Model Code", width: 12 },
      { key: "name", header: "Model Name", width: 32 },
      { key: "brand", header: "ยี่ห้อ", width: 18 },
      { key: "price", header: "Market Price", width: 14, money: true },
      { key: "updated", header: "Last Update", width: 18 },
      { key: "status", header: "สถานะ", width: 10 },
    ],
  },
  customers: {
    title: "ลูกค้า",
    module: "Customer",
    cols: [
      { key: "code", header: "รหัสลูกค้า", width: 12 },
      { key: "name", header: "ชื่อ-สกุล", width: 32 },
      { key: "taxId", header: "เลขบัตร/ผู้เสียภาษี", width: 18 },
      { key: "address", header: "ที่อยู่", width: 50 },
      { key: "phone", header: "โทรศัพท์", width: 14 },
      { key: "email", header: "อีเมล", width: 26 },
      { key: "line", header: "Line ID", width: 16 },
      { key: "type", header: "ประเภท", width: 12 },
      { key: "status", header: "สถานะ", width: 10 },
    ],
  },
  jobs: {
    title: "รายการงาน",
    module: "Job Management",
    cols: [
      { key: "no", header: "เลขที่งาน", width: 12 },
      { key: "openDate", header: "วันที่เปิดงาน", width: 18 },
      { key: "customer", header: "ลูกค้า", width: 36 },
      { key: "so", header: "เลขคำสั่งซื้อ", width: 18 },
      { key: "channel", header: "ช่องทาง", width: 14 },
      { key: "brandModel", header: "ยี่ห้อ/รุ่น", width: 28 },
      { key: "imei", header: "IMEI", width: 18 },
      { key: "serial", header: "Serial", width: 18 },
      { key: "jobType", header: "ประเภทงาน", width: 22 },
      { key: "symptom", header: "อาการเสีย", width: 26 },
      { key: "owner", header: "ผู้รับผิดชอบ", width: 20 },
      { key: "status", header: "สถานะงาน", width: 34 },
      { key: "repairedDate", header: "วันที่ซ่อมเสร็จ", width: 18 },
      { key: "closedDate", header: "วันที่ปิดงาน", width: 18 },
      { key: "returnType", header: "วิธีส่งคืน", width: 18 },
      { key: "returnTracking", header: "เลขพัสดุ", width: 18 },
      { key: "partsCost", header: "ค่าอะไหล่", width: 12, money: true },
      { key: "serviceCost", header: "ค่าบริการ", width: 12, money: true },
      { key: "amount", header: "รวมสุทธิ", width: 12, money: true },
      { key: "paymentType", header: "วิธีชำระ", width: 12 },
      { key: "paymentAmount", header: "ยอดชำระ", width: 12, money: true },
    ],
  },
  quotations: {
    title: "ใบเสนอราคา",
    module: "Quotation",
    cols: [
      { key: "no", header: "เลขที่", width: 12 },
      { key: "date", header: "วันที่", width: 18 },
      { key: "type", header: "ประเภท", width: 16 },
      { key: "customerCode", header: "รหัสลูกค้า", width: 12 },
      { key: "customer", header: "ลูกค้า", width: 30 },
      { key: "jobRef", header: "งานซ่อม", width: 12 },
      { key: "brandModel", header: "ยี่ห้อ/รุ่น", width: 26 },
      { key: "partsAmount", header: "ค่าอะไหล่", width: 12, money: true },
      { key: "serviceAmount", header: "ค่าบริการ", width: 12, money: true },
      { key: "discountAmount", header: "ส่วนลด", width: 12, money: true },
      { key: "vatAmount", header: "VAT", width: 10, money: true },
      { key: "amount", header: "สุทธิ", width: 12, money: true },
      { key: "status", header: "สถานะ", width: 26 },
      { key: "approveDate", header: "วันที่ลูกค้าตกลง", width: 18 },
      { key: "createdBy", header: "ผู้สร้าง", width: 20 },
    ],
  },
  sale_orders: {
    title: "ใบสั่งขาย",
    module: "Sale Order",
    cols: [
      { key: "no", header: "SO No.", width: 12 },
      { key: "date", header: "วันที่", width: 18 },
      { key: "customerCode", header: "รหัสลูกค้า", width: 12 },
      { key: "customer", header: "ลูกค้า", width: 30 },
      { key: "sales", header: "พนักงานขาย", width: 20 },
      { key: "amount", header: "ยอดสุทธิ", width: 12, money: true },
      { key: "paymentType", header: "วิธีชำระ", width: 12 },
      { key: "paymentAmount", header: "ยอดชำระ", width: 12, money: true },
      { key: "approve", header: "สถานะอนุมัติ", width: 18 },
      { key: "approvedBy", header: "ผู้อนุมัติ", width: 20 },
      { key: "stockDoc", header: "เอกสารจ่ายสต๊อก", width: 14 },
      { key: "tracking", header: "Tracking", width: 18 },
    ],
  },
  products: {
    title: "อะไหล่",
    module: "Product",
    cols: [
      { key: "sysCode", header: "รหัส (ระบบ)", width: 12 },
      { key: "mfgCode", header: "รหัส (ผู้ผลิต)", width: 22 },
      { key: "name", header: "ชื่ออะไหล่", width: 44 },
      { key: "category", header: "หมวดหมู่", width: 16 },
      { key: "brand", header: "ยี่ห้อ", width: 16 },
      { key: "onhand", header: "คงเหลือ", width: 10, num: true },
      { key: "received", header: "รับเข้าสะสม", width: 12, num: true },
      { key: "issued", header: "จ่ายออกสะสม", width: 12, num: true },
      { key: "capitalPrice", header: "ราคาทุน", width: 12, money: true },
      { key: "price", header: "ราคาขาย", width: 12, money: true },
      { key: "status", header: "สถานะ", width: 10 },
    ],
  },
  movements: {
    title: "ประวัติสต๊อก",
    module: "Product Onhand",
    cols: [
      { key: "doc", header: "เลขเอกสาร", width: 14 },
      { key: "type", header: "ประเภท", width: 22 },
      { key: "ref", header: "อ้างอิง", width: 14 },
      { key: "date", header: "วันที่", width: 18 },
      { key: "by", header: "ผู้ทำรายการ", width: 20 },
      { key: "qty", header: "จำนวนรวม", width: 10, num: true },
      { key: "items", header: "รายการ", width: 60 },
    ],
  },
  issued_lines: {
    title: "รายงานเบิกจ่ายอะไหล่",
    module: "any",
    cols: [
      { key: "doc", header: "เลขเอกสาร", width: 14 },
      { key: "date", header: "วันที่", width: 18 },
      { key: "type", header: "ประเภท", width: 22 },
      { key: "ref", header: "อ้างอิง", width: 14 },
      { key: "code", header: "รหัสอะไหล่", width: 12 },
      { key: "item", header: "ชื่ออะไหล่", width: 44 },
      { key: "category", header: "หมวดหมู่", width: 16 },
      { key: "qty", header: "จำนวน", width: 10, num: true },
      { key: "value", header: "มูลค่า", width: 12, money: true },
      { key: "by", header: "ผู้ทำรายการ", width: 20 },
    ],
  },
};

SPECS.audit_log = {
  title: "ประวัติการใช้งาน",
  module: null,
  cols: [
    { key: "at", header: "เวลา", width: 18 },
    { key: "user", header: "ผู้ใช้", width: 24 },
    { key: "action", header: "การกระทำ", width: 10 },
    { key: "module", header: "โมดูล", width: 20 },
    { key: "entity", header: "ตาราง", width: 16 },
    { key: "key", header: "เลขที่/รหัส", width: 16 },
    { key: "summary", header: "รายละเอียด", width: 60 },
    { key: "changesText", header: "ค่าที่เปลี่ยน", width: 60 },
  ],
};

for (const k of ["categories", "manufacturers", "colors", "job_types", "product_types", "symptoms"]) {
  SPECS[k] = { title: k, module: null, cols: MASTER_COLS };
}

async function loadRows(req: NextRequest, resource: string, user: CurrentUser): Promise<Row[]> {
  void user;
  const sp = new URL(req.url).searchParams;
  const p = parsePageQuery(sp);
  const mode = parseStatusMode(sp.get("deleted"));
  const f = p.f;
  if (isSimpleKind(resource)) return listSimple(resource, mode) as unknown as Row[];
  switch (resource) {
    case "symptoms":
      return listSymptoms(mode) as unknown as Row[];
    case "models":
      return listModels(mode) as unknown as Row[];
    case "users":
      return listSystemUsers(mode) as unknown as Row[];
    case "customers":
      return listCustomers({ q: p.q, deleted: mode, limit: MAX_ROWS }) as unknown as Row[];
    case "jobs":
      return listJobs({ ...filtersFromQuery(f), q: p.q, limit: MAX_ROWS }) as unknown as Row[];
    case "quotations":
      return listQuotations({ status: f.status, from: f.from, to: f.to, type: f.type, warranty: f.warranty, brand: f.brand, jobNo: f.jobNo, deleted: mode, q: p.q, limit: MAX_ROWS }) as unknown as Row[];
    case "sale_orders":
      return listSaleOrders({ approve: f.approve, from: f.from, to: f.to, sales: f.sales, deleted: mode, q: p.q, limit: MAX_ROWS }) as unknown as Row[];
    case "products": {
      // same filters as the products list / stock report tables (category, brand, stock state, …)
      const pf: ProductFilters = {
        mode,
        status: f.status,
        sysCode: f.sysCode,
        mfgCode: f.mfgCode,
        name: f.name,
        brand: f.brand,
        category: f.category,
        creator: f.creator,
        date: f.date,
        stock: f.stock === "in" || f.stock === "low" || f.stock === "out" ? f.stock : undefined,
      };
      return (await pageProducts({ ...p, page: 1, pageSize: MAX_ROWS }, pf)).rows as unknown as Row[];
    }
    case "movements":
      return listMovements({ q: p.q || f.code || f.doc || f.ref, from: f.from, to: f.to, type: f.type, limit: MAX_ROWS }) as unknown as Row[];
    case "issued_lines":
      return listIssuedLines({ from: f.from, to: f.to, category: f.category, code: f.code || p.q, limit: MAX_ROWS }) as unknown as Row[];
    case "audit_log":
      return (await listAudit({ q: p.q, from: f.from, to: f.to, user: f.user, module: f.module, entity: f.entity, key: f.key, action: f.action, limit: MAX_ROWS })).map((r) => ({
        ...r,
        changesText: r.changes ? Object.entries(r.changes).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join("; ") : "",
      })) as unknown as Row[];
  }
  throw new HttpError(404, `unknown export: ${resource}`);
}

export async function exportXlsx(req: NextRequest, resource: string): Promise<{ buffer: Buffer; filename: string }> {
  const spec = SPECS[resource];
  if (!spec) throw new HttpError(404, `unknown export: ${resource}`);
  const user =
    spec.module === null ? await requireAdmin(req) : spec.module === "any" ? await requireUser(req) : await requireCan(req, spec.module, "view");
  const rows = await loadRows(req, resource, user);

  const wb = new ExcelJS.Workbook();
  wb.creator = "OneService";
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = spec.cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF9" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.cols.length } };

  for (const r of rows.slice(0, MAX_ROWS)) {
    const out: Row = {};
    for (const c of spec.cols) {
      const v = r[c.key];
      out[c.key] = c.money || c.num ? Number(v ?? 0) : (v ?? "");
    }
    ws.addRow(out);
  }
  for (const c of spec.cols) {
    if (c.money) ws.getColumn(c.key).numFmt = "#,##0.00";
    else if (c.num) ws.getColumn(c.key).numFmt = "#,##0";
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `${resource}-${stamp}.xlsx` };
}
