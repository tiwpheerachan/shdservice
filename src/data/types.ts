/**
 * Shared TypeScript types of the domain records the screens and services exchange.
 * All DATA comes from the legacy database (src/server/services/*); the core fields of each type are what
 * the screens render, the optional ones the extra DB-backed values the forms need for editing.
 * Every row id is the row's uuid `id` (ADR 0008, string); status codes (statusId, approveId) stay numbers.
 */

export type Status = 'Active' | 'Inactive' | 'Cancel';

export type MasterRow = {
  id: string;
  name: string;
  detail: string;
  status: Status;
  extra?: string;
  /** job types: target turnaround (SLA) in days */
  days?: number;
};

export type User = {
  id: string;
  code: string;
  name: string;
  username: string;
  role: string;
  branch: string;
  email: string;
  phone: string;
  lastLogin: string;
  status: Status;
  avatar?: string | null;
  title?: string | null;
};

export type Permission = {
  role: string;
  menu: string;
  add: boolean;
  edit: boolean;
  del: boolean;
  view: boolean;
};

export type Model = {
  code: string;
  name: string;
  brand: string;
  price: number;
  updated: string;
  status: Status;
};

export type Symptom = MasterRow & { group: string };

export type Product = {
  sysCode: string;
  mfgCode: string;
  name: string;
  category: string;
  brand: string;
  onhand: number;
  price: number;
  status: Status;
  // DB-backed extras (product + product_stock)
  id?: string;
  nameEn?: string;
  nameCn?: string;
  description?: string;
  capitalPrice?: number;
  wholesalePrice?: number;
  received?: number;
  issued?: number;
  reserved?: number;
  ubRepairOnly?: boolean;
  /** product.is_serial_control (dropped in drizzle/0006) — always False */
  serialControl?: boolean;
  forModelColor?: string;
  createdDate?: string;
  createdBy?: string;
  models?: string[];
  image?: string; // products/{code}/{file} — serve via fileUrl()
  stockRemark?: string; // product_stock.remark — legacy stock-adjustment log
  cancelRemark?: string; // product.cancel_remark / cancel_date / cancel_by (เหตุผลที่ยกเลิกอะไหล่)
  cancelDate?: string;
  cancelBy?: string;
};

export type Movement = {
  doc: string;
  type: string;
  ref: string;
  date: string;
  by: string;
  from: string;
  to: string;
  remark: string;
  // DB-backed extras (stock_move / stock_move_line)
  qty?: number;
  items?: string;
};

export type Customer = {
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  line: string;
  taxId: string;
  status: Status;
  // DB-backed extras (customer table)
  id?: string;
  type?: string;
  online?: boolean;
  address1?: string;
  address2?: string;
  cityId?: string;
  districtId?: string;
  subDistrictId?: string;
  postalCode?: string;
  priceGroup?: string;
  createdDate?: string;
  createdBy?: string;
  /** customer.row_version — the edit form sends it back with its save */
  version?: number;
};

export type Job = {
  id: string;
  no: string;
  openDate: string;
  customer: string;
  so: string;
  brandModel: string;
  jobType: string;
  owner: string;
  status: string;
  imei: string;
  amount: number;
  // DB-backed extras (job table)
  statusId?: number;
  statusGroup?: string;
  isBounce?: boolean; // job.is_job_bounce — งานเด้ง (สินค้ากลับมาซ่อมซ้ำ)
  serial?: string;
  channel?: string;
  receptionType?: string;
  receptionDate?: string;
  warranty?: string;
  symptom?: string;
  symptomOther?: string;
  repairDetail?: string;
  repairedDate?: string;
  closedDate?: string;
  returnType?: string;
  returnTracking?: string;
  returnDate?: string;
  paymentType?: string;
  paymentAmount?: number;
  dueDate?: string;
  openedBy?: string;
  jobTypeDetail?: string;
  quotationNo?: string;
  serviceCost?: number;
  partsCost?: number;
  modelDetail?: string;
  /** the job's customer (customer.id) — none on a job without one */
  customerId?: string;
};

export type Quotation = {
  id: string;
  no: string;
  date: string;
  type: 'Type A (Normal)' | 'Type B (VIP)';
  customer: string;
  jobRef: string;
  imei: string;
  brandModel: string;
  amount: number;
  status: string;
  // DB-backed extras (quotation)
  statusId?: number;
  customerCode?: string;
  warranty?: string;
  partsAmount?: number;
  serviceAmount?: number;
  discountAmount?: number;
  vatAmount?: number;
  approveDate?: string;
  createdBy?: string;
  active?: boolean;
};

export type SaleOrder = {
  id: string;
  no: string;
  date: string;
  customer: string;
  amount: number;
  sales: string;
  approve: string;
  stockDoc: string;
  tracking: string;
  // DB-backed extras (sale_order)
  approveId?: number;
  customerCode?: string;
  paymentType?: string;
  paymentAmount?: number;
  cancelled?: boolean;
  approveDate?: string;
  approvedBy?: string;
  deliveryDate?: string;
  remark?: string;
};

/* ---------- Dashboard aggregate rows ---------- */

export type StatTone = 'primary' | 'warning' | 'info' | 'success' | 'danger';

export type DashGroup = {
  key: string;
  label: string;
  sub: string;
  jobs: number;
  percent: number;
  tone: StatTone;
  ord?: number;
};

export type TatRow = {
  statusId?: number; // job_status_id — used to deep-link a cell into the job list
  status: string;
  group: string; // job_status_group (Pending / Repaired / Finished) — the row's colour bar
  d13: number;
  d47: number;
  d814: number;
  d1530: number;
  over30: number;
};

export type MonthlyRow = { m: string; open: number; close: number };

export type TopSymptom = { name: string; count: number };
