/**
 * One column list for the screen table, the exports (server/export.ts) and the server query (reports.ts reportPage) — pure, so client and server both import it.
 * `m` = money (2 decimals, right), `n` = a count (right); `cost` = ราคาทุน, only with the right Product Cost.
 */
export type ReportCol = { key: string; header: string; width?: number; money?: boolean; num?: boolean; cost?: boolean };

const c = (key: string, header: string, kind?: 'm' | 'n' | 'cost', width?: number): ReportCol => ({
  key,
  header,
  width,
  ...(kind === 'm'
    ? { money: true }
    : kind === 'n'
      ? { num: true }
      : kind === 'cost'
        ? { money: true, cost: true }
        : {}),
});

const IDX = c('idx', '#', 'n', 6);
/** the customer / device block every job report starts with */
const JOB_HEAD = (by: string, code: string) => [
  IDX,
  c('no', 'Job No', undefined, 12),
  c('openDate', 'Job Create Date', undefined, 18),
  c('openedBy', by, undefined, 20),
  c('customerCode', code, undefined, 10),
  c('customerName', 'Customer Name', undefined, 28),
  c('phone', 'Phone Number', undefined, 14),
];
const DEVICE = (warranty: string) => [
  c('serial', 'Product Serial No', undefined, 18),
  c('brand', 'Brand Name', undefined, 14),
  c('model', 'Model Name', undefined, 18),
  c('productType', 'Product Type Name', undefined, 16),
  c('warranty', warranty, undefined, 8),
];
const SYMPTOM = (name: string) => [
  c('symptom', name, undefined, 22),
  c('symptomOther', 'Product Symptom Other', undefined, 22),
  c('fault', 'Product Fault', undefined, 18),
  c('equipment', 'Product Equipment', undefined, 18),
];
const COSTS = [
  c('partsCost', 'SparePart Cost', 'm', 12),
  c('serviceCost', 'Service Cost', 'm', 12),
  c('toolCost', 'Service Tool Cost', 'm', 12),
  c('deliveryCost', 'Delivery Cost', 'm', 12),
  c('boxCost', 'Carton Box Cost', 'm', 12),
  c('totalCost', 'Job Total Cost', 'm', 12),
  c('paid', 'Payment Amount', 'm', 12),
];
const JOB_TYPE = [c('jobType', 'Job Type Name', undefined, 20), c('jobTypeDetail', 'Job Type Detail', undefined, 18)];
const STATUS_TAT = [c('status', 'Job Status Name', undefined, 26), c('tat', 'TAT Day', 'n', 8)];

export const REPORT_SPECS = {
  open_job: {
    title: 'รายงานการเปิดงานซ่อม',
    cols: [
      ...JOB_HEAD('Create By Name', 'Cust. Code'),
      c('so', 'Sale Order No', undefined, 16),
      c('soDate', 'SO Date', undefined, 12),
      ...DEVICE('Prod.Warranty'),
      c('bounce', 'Job Bounce', undefined, 8),
      ...JOB_TYPE,
      c('outSent', 'Send OutSource Date', undefined, 18),
      c('outReceived', 'Receive OutSource Date', undefined, 18),
      ...SYMPTOM('Product Symptom'),
      c('remark', 'Job Remark', undefined, 24),
      c('engineer', 'Engineer Name', undefined, 20),
      c('tracking', 'Tracking No.', undefined, 16),
      ...COSTS,
      ...STATUS_TAT,
    ],
  },
  repair_job: {
    title: 'รายงานการซ่อม',
    cols: [
      ...JOB_HEAD('Job Create By Name', 'Customer Code'),
      ...DEVICE('Prod. Warranty'),
      ...SYMPTOM('Product Symptom Name'),
      c('receptionDate', 'Reception Date', undefined, 12),
      ...JOB_TYPE,
      c('so', 'Job Reference No', undefined, 16),
      c('remark', 'Job Remark', undefined, 24),
      c('engineer', 'Engineer Name', undefined, 20),
      c('partsReplaced', 'Spare Part Replace', undefined, 28),
      c('repairDetail', 'Engineer Repair Detail', undefined, 28),
      c('engineerRemark', 'Engineer Remark', undefined, 24),
      ...COSTS,
      c('repairedDate', 'Job Repaired Date', undefined, 18),
      ...STATUS_TAT,
    ],
  },
  close_job: {
    title: 'รายงานการปิดงานซ่อม',
    cols: [
      ...JOB_HEAD('Job Create By Name', 'Customer Code'),
      ...DEVICE('Prod. Warranty'),
      ...SYMPTOM('Product Symptom Name'),
      c('so', 'Job Reference No', undefined, 16),
      c('remark', 'Job Remark', undefined, 24),
      c('engineer', 'Engineer Name', undefined, 20),
      c('repairedDate', 'Job Repaired Date', undefined, 18),
      c('repairDetail', 'Engineer Repair Detail', undefined, 28),
      c('partsReplaced', 'Spare Part Replace', undefined, 28),
      c('engineerRemark', 'Engineer Remark', undefined, 24),
      c('closedBy', 'Job Closed By Name', undefined, 20),
      c('closedDate', 'Job Closed Date', undefined, 18),
      ...COSTS,
      c('paymentType', 'Payment Type', undefined, 12),
      c('paymentNo', 'Payment No', undefined, 14),
      c('paymentDetail', 'Payment Detail', undefined, 24),
      ...STATUS_TAT,
    ],
  },
  quotation: {
    title: 'รายงานการเสนอราคา (Summary)',
    cols: [
      c('idx', 'No', 'n', 6),
      c('no', 'Quotation No', undefined, 14),
      c('date', 'Quotation Date', undefined, 18),
      c('status', 'Quotation Status', undefined, 24),
      c('jobRef', 'Ref Job No.', undefined, 12),
      c('customerDetail', 'Customer Detail', undefined, 32),
      c('brand', 'Brand Name', undefined, 14),
      c('model', 'Model name', undefined, 18),
      c('serial', 'Serial No.', undefined, 18),
      c('symptom', 'Symptom', undefined, 22),
      c('parts', 'Spare Part', undefined, 36),
      c('amount', 'Quotation Amount', 'm', 14),
      c('engineer', 'ชื่อช่าง', undefined, 20),
      c('remark', 'หมายเหตุ', undefined, 28),
    ],
  },
  quotation_detail: {
    title: 'รายงานการเสนอราคา (Detail Part)',
    cols: [
      IDX,
      c('no', 'Quotation No', undefined, 14),
      c('date', 'Create Date', undefined, 18),
      c('status', 'Quotation Status Name', undefined, 24),
      c('jobRef', 'Job No', undefined, 12),
      c('customerDetail', 'Customer Detail', undefined, 32),
      c('itemCode', 'Item Code', undefined, 14),
      c('itemDetail', 'Item Detail', undefined, 36),
      c('qty', 'Quantity', 'n', 8),
      c('unit', 'Unit', undefined, 8),
      c('unitPrice', 'Unit Price', 'm', 12),
      c('totalPrice', 'Total Price', 'm', 12),
      c('jobRefNo', 'Job Reference No', undefined, 16),
    ],
  },
  sale_order: {
    title: 'รายงานการขาย (Grouping by SO)',
    cols: [
      IDX,
      c('no', 'SaleOrder No', undefined, 14),
      c('date', 'SaleOrder Date', undefined, 18),
      c('customerCode', 'Customer Code', undefined, 12),
      c('customerName', 'Customer Name', undefined, 28),
      c('address', 'Customer Address', undefined, 40),
      c('phone', 'Phone No.', undefined, 14),
      c('base', 'Total Base Amount', 'm', 14),
      c('vat', 'Vat Amount', 'm', 12),
      c('total', 'Total Amount', 'm', 14),
      c('remark', 'Remark', undefined, 24),
      c('createdBy', 'Create By Name', undefined, 20),
      c('status', 'SaleOrder Status', undefined, 18),
      c('approveDate', 'Approved Date', undefined, 18),
      c('stockDoc', 'Ref Inventory No.', undefined, 14),
      c('tracking', 'Tracking No.', undefined, 16),
      c('deliveryDate', 'Delivery Date', undefined, 18),
    ],
  },
  sale_order_detail: {
    title: 'รายงานการขาย (Detail Items Part)',
    cols: [
      IDX,
      c('no', 'SaleOrder No', undefined, 14),
      c('date', 'SaleOrder Date', undefined, 18),
      c('customerCode', 'Customer Code', undefined, 12),
      c('customerName', 'Customer Name', undefined, 28),
      c('itemCode', 'Item Code', undefined, 14),
      c('itemName', 'Item Name', undefined, 36),
      c('qty', 'Quantity', 'n', 8),
      c('unitPrice', 'Unit Price', 'm', 12),
      c('amount', 'Amount', 'm', 12),
      c('createdBy', 'Create By Name', undefined, 20),
      c('status', 'SaleOrder Status', undefined, 18),
    ],
  },
  product_used: {
    title: 'รายงานการเบิกจ่ายอะไหล่ (อ้างอิงงานซ่อม)',
    cols: [
      IDX,
      c('code', 'Product Code', undefined, 12),
      c('name', 'Product Name', undefined, 36),
      c('nameEn', 'Product Name EN', undefined, 30),
      c('isQuotation', 'Is Quotation', undefined, 8),
      c('requestQty', 'Request Qty', 'n', 8),
      c('requestDate', 'Request Date', undefined, 18),
      c('grantQty', 'Grant Qty', 'n', 8),
      c('grantDate', 'Grant Date', undefined, 18),
      c('returnQty', 'Return Qty', 'n', 8),
      c('returnDate', 'Return Date', undefined, 18),
      c('status', 'Order Status', undefined, 10),
      c('jobNo', 'Job No', undefined, 12),
    ],
  },
  product_onhand: {
    title: 'รายงานอะไหล่คงเหลือ',
    cols: [
      IDX,
      c('code', 'Product Code', undefined, 12),
      c('mfgCode', 'ProductVender Code', undefined, 18),
      c('name', 'Product Name', undefined, 36),
      c('description', 'Product Description', undefined, 28),
      c('category', 'Category Name', undefined, 16),
      c('brand', 'Brand Name', undefined, 14),
      c('modelCode', 'Model Code', undefined, 16),
      c('modelName', 'Model Name', undefined, 22),
      c('color', 'Model Color', undefined, 10),
      c('available', 'Qty Available', 'n', 10),
      c('used', 'Qty Used', 'n', 10),
      c('booking', 'Qty Booking', 'n', 10),
      c('remain', 'Qty Remain', 'n', 10),
      c('capitalPrice', 'Capital Price', 'cost', 12),
      c('price', 'Retail Price', 'm', 12),
      c('location', 'Location Name', undefined, 16),
    ],
  },
} satisfies Record<string, { title: string; cols: ReportCol[] }>;

export type ReportKey = keyof typeof REPORT_SPECS;
export const REPORT_KEYS = Object.keys(REPORT_SPECS) as ReportKey[];
export const isReportKey = (v: unknown): v is ReportKey => typeof v === 'string' && Object.hasOwn(REPORT_SPECS, v);
export type ReportRow = Record<string, string | number>;

/** the legacy status filter's group entries → statusGroup (kpiGroup) */
export const JOB_STATUS_GROUPS: Record<string, string> = {
  กลุ่มงานอยู่ระหว่างดำเนินการ: 'Pending',
  กลุ่มงานซ่อมเสร็จ: 'Repaired',
  กลุ่มงานปิดงาน: 'Finished',
};
export const JOB_WARRANTY: Record<string, string> = { ยังไม่ได้ระบุ: 'NONE', IN: 'IN', OUT: 'OUT' };

/** the legacy screen's job filters as their query (jobs.ts filtersFromQuery + reports.ts jobReportWhere) — pure, so open-job's server render builds the same first keys */
export function jobReportQuery(
  f: Record<string, string | undefined>,
  // staff: the user's uuid (ADR 0008); status: the job status code
  ids: { staff?: (name: string) => string | undefined; status?: (name: string) => number | undefined } = {},
  fixed: Record<string, string> = {},
) {
  const status = f.status ?? '';
  return {
    dateBy: f.dateBy ?? '',
    from: f.from,
    to: f.to,
    no: f.no,
    customerCode: f.customerCode,
    imei: f.imei,
    tracking: f.tracking,
    warranty: JOB_WARRANTY[f.warranty ?? ''] ?? '',
    brand: f.brand,
    model: f.model,
    bounce: JOB_BOUNCE[f.bounce ?? ''] ?? '',
    type: f.type,
    typeDetail: f.typeDetail,
    cost: f.cost === 'มีค่าใช้จ่าย' ? 'yes' : f.cost === 'ไม่มีค่าใช้จ่าย' ? 'no' : '',
    createdBy: String(ids.staff?.(f.createdBy ?? '') ?? ''),
    engineer: String(ids.staff?.(f.engineer ?? '') ?? ''),
    statusGroup: JOB_STATUS_GROUPS[status] ?? '',
    statusId: status && !JOB_STATUS_GROUPS[status] ? String(ids.status?.(status) ?? '') : '',
    ...fixed,
  };
}

/** รุ่น under the chosen ยี่ห้อ, as the legacy filter cascades (no brand / ทั้งหมด = every model) */
export const modelsOfBrand = <M extends { brand: string }>(models: M[], brand?: string) =>
  models.filter((m) => !brand || brand === 'ทั้งหมด' || m.brand === brand);
/** งานซ่อมซ้ำ (legacy checkbox): ticked = only is_job_bounce jobs; the other option (ทั้งหมด) = no filter */
export const JOB_BOUNCE: Record<string, string> = { เฉพาะงานซ่อมซ้ำ: '1' };
/** "และอะไหล่ที่ใช้ได้กับทุกสี" (legacy checkbox, unticked by default): with a สี chosen, รวมด้วย = that colour + the
 *  parts with no colour, ไม่รวม = that colour only; no สี = every part either way */
export const ONHAND_ALL_COLORS: Record<string, string> = { ไม่รวม: '', รวมด้วย: '1' };
