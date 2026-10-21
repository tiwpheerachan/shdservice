import { z } from 'zod';
import { UiStatus } from './common';

/**
 * The records the API answers with, as they travel (JSON): the service types in
 * src/server/services/* and src/data/types.ts, field by field. Shared by several operations,
 * so each is a named component in the document.
 */

const s = z.string();
const n = z.number();
const b = z.boolean();

export const Customer = z
  .object({
    code: s,
    name: s,
    address: s,
    phone: s,
    email: s,
    line: s,
    taxId: s,
    status: UiStatus,
    id: n.optional(),
    type: s.optional().meta({ description: '`Normal` = a person; otherwise a company type.' }),
    online: b.optional(),
    address1: s.optional(),
    address2: s.optional(),
    cityId: n.optional(),
    districtId: n.optional(),
    subDistrictId: n.optional(),
    postalCode: s.optional(),
    priceGroup: s.optional(),
    createdDate: s.optional(),
    createdBy: s.optional(),
    version: n.optional().meta({ description: 'row_version — send it back on save (409 `stale` if it moved).' }),
  })
  .meta({ id: 'Customer' });

export const AuditRow = z
  .object({
    id: n,
    at: s,
    userId: n,
    user: s,
    action: z.enum([
      'CREATE',
      'UPDATE',
      'DELETE',
      'STATUS',
      'APPROVE',
      'ASSIGN',
      'ISSUE',
      'RECEIVE',
      'RETURN',
      'UPLOAD',
      'LOGIN',
      'EXPORT',
    ]),
    module: s,
    entity: s,
    key: s,
    summary: s,
    changes: z
      .record(s, z.tuple([z.unknown(), z.unknown()]))
      .nullable()
      .meta({ description: '{ field: [before, after] }' }),
  })
  .meta({ id: 'AuditRow' });

export const PartRequestLine = z
  .object({
    logId: n,
    jobNo: s,
    code: s,
    name: s,
    onhand: n,
    need: n,
    requested: n,
    granted: n,
    returned: n,
    statusId: n,
    status: s,
    unitPrice: n,
    isQuotation: b,
    isSpecial: b,
    requestQtyB: n,
    isQuotationB: b,
    isSpecialB: b,
  })
  .meta({ id: 'PartRequestLine' });

export const JobDetail = z
  .object({
    no: s,
    documentProfileId: n,
    statusId: n,
    status: s,
    statusGroup: s,
    createDate: s,
    createBy: n,
    createByName: s,
    jobTypeId: n,
    jobType: s,
    jobTypeDetail: s,
    customer: z.object({ id: n, code: s, name: s, taxId: s, address: s, phone: s, line: s, email: s }).nullable(),
    customerDetail: s,
    so: s,
    channel: s,
    shopName: s,
    saleOrderDate: s,
    warrantyMonth: n,
    expireDate: s,
    warranty: s,
    productTypeId: n,
    productType: s,
    imei: s,
    serial: s,
    brandId: n,
    brand: s,
    modelId: n,
    modelCode: s,
    modelName: s,
    modelDetail: s,
    color: s,
    receptionDate: s,
    receptionTrackingNo: s,
    receptionShipper: s,
    receptionType: s,
    equipment: s,
    fault: s,
    symptomIds: z.array(n),
    symptoms: z.array(s),
    symptomOther: s,
    remark: s,
    estimateCost: n,
    depositCost: n,
    partsCost: n,
    serviceCost: n,
    toolCost: n,
    deliveryCost: n,
    boxCost: n,
    totalCost: n,
    amountDue: n,
    depositRefund: n,
    outstanding: n,
    dueDate: s,
    dueDateAuto: b,
    engineerId: n,
    engineer: s,
    engineerSymptomId: n,
    engineerSymptom: s,
    repairDetail: s,
    engineerRemark: s,
    repairedDate: s,
    closedDate: s,
    repairedBy: s,
    closedBy: s,
    sparePartReplace: s,
    payment: z.object({ type: s, no: s, amount: n, detail: s, slip: s }),
    return: z.object({ date: s, type: s, tracking: s, detail: s, shipperId: n }),
    swap: z.object({ detail: s, docNo: s }),
    quotationNo: s,
    isBounce: b,
    gspnNo: s,
    outsource: z.array(
      z.object({
        id: n,
        sendTo: s,
        sendDetail: s,
        sendDate: s,
        sendBy: s,
        sendById: n,
        receiveDate: s,
        receiveBy: s,
        receiveById: n,
        receiveDetail: s,
        status: s,
      }),
    ),
    parts: z.array(PartRequestLine.extend({ total: n })),
    attachments: z.array(z.object({ id: n, name: s, file: s, remark: s })),
    logs: z.array(z.object({ statusId: n, status: s, date: s, by: s })),
    history: z.array(AuditRow),
    version: n.meta({ description: 'row_version — send it back on save (409 `stale` if it moved).' }),
  })
  .meta({ id: 'JobDetail' });

/** A job as the lists show it (src/data/types.ts Job). */
const jobRow = {
  no: s,
  openDate: s,
  customer: s,
  so: s,
  brandModel: s,
  jobType: s,
  owner: s,
  status: s,
  imei: s,
  amount: n,
  statusId: n.optional(),
  statusGroup: s.optional(),
  isBounce: b.optional(),
  customerId: n.optional(),
  engineerId: n.optional(),
  serial: s.optional(),
  channel: s.optional(),
  receptionType: s.optional(),
  receptionDate: s.optional(),
  warranty: s.optional(),
  symptom: s.optional(),
  symptomOther: s.optional(),
  repairDetail: s.optional(),
  repairedDate: s.optional(),
  closedDate: s.optional(),
  returnType: s.optional(),
  returnTracking: s.optional(),
  returnDate: s.optional(),
  paymentType: s.optional(),
  paymentAmount: n.optional(),
  dueDate: s.optional(),
  openedBy: s.optional(),
  jobTypeDetail: s.optional(),
  quotationNo: s.optional(),
  serviceCost: n.optional(),
  partsCost: n.optional(),
  modelDetail: s.optional(),
};
/** + deposit / outstanding (services/jobs.ts JobListRow) — the list and its pages (pageJobs: Page<JobListRow>) */
export const Job = z.object({ ...jobRow, deposit: n, outstanding: n }).meta({ id: 'Job' });

const quotationRow = {
  no: s,
  date: s,
  type: z.enum(['Type A (Normal)', 'Type B (VIP)']),
  customer: s,
  jobRef: s,
  imei: s,
  brandModel: s,
  amount: n,
  status: s,
  statusId: n.optional(),
  customerCode: s.optional(),
  warranty: s.optional(),
  partsAmount: n.optional(),
  serviceAmount: n.optional(),
  discountAmount: n.optional(),
  vatAmount: n.optional(),
  approveDate: s.optional(),
  createdBy: s.optional(),
  active: b.optional(),
};
export const Quotation = z.object(quotationRow).meta({ id: 'Quotation' });
export const QuotationDetail = z
  .object({
    ...quotationRow,
    contactName: s,
    customerDetail: Customer.nullable(),
    job: JobDetail.nullable(),
    lines: z.array(
      z.object({
        id: n.optional(),
        lineNumber: n,
        itemType: z.enum(['SparePart', 'Service', 'Delivery']),
        code: s,
        detail: s,
        qty: n,
        unit: s,
        unitPrice: n,
        discount: n,
        discountPercent: n,
        total: n,
      }),
    ),
    remark: s,
    discountType: s,
    discountFormula: s,
    sumExclude: n,
    afterDiscount: n,
    totalBase: n,
    vatRate: n,
    totalAmount: n,
    rounding: n,
    netAmount: n,
    approveRemark: s,
    documentProfileId: n,
    createdByPhone: s,
    createdByEmail: s,
    version: n,
  })
  .meta({ id: 'QuotationDetail' });

const saleOrderRow = {
  no: s,
  date: s,
  customer: s,
  amount: n,
  sales: s,
  approve: s,
  stockDoc: s,
  tracking: s,
  approveId: n.optional(),
  customerCode: s.optional(),
  paymentType: s.optional(),
  paymentAmount: n.optional(),
  cancelled: b.optional(),
  approveDate: s.optional(),
  approvedBy: s.optional(),
  deliveryDate: s.optional(),
  remark: s.optional(),
};
export const SaleOrder = z.object(saleOrderRow).meta({ id: 'SaleOrder' });
export const SaleOrderDetail = z
  .object({
    ...saleOrderRow,
    customerDetail: z.object({
      code: s,
      taxId: s,
      name: s,
      address: s,
      phone: s,
      line: s,
      email: s,
      subDistrict: s,
      district: s,
      province: s,
      status: s.meta({ description: "the customer's status now (Active / Inactive …)" }),
    }),
    cancelRemark: s.meta({ description: 'why it was cancelled (empty unless cancelled)' }),
    lines: z.array(
      z.object({
        id: n.optional(),
        listNo: n,
        productId: n,
        code: s,
        name: s,
        type: z.enum(['SparePart', 'Service']),
        qty: n,
        unit: s,
        price: n,
        amount: n,
        picked: s,
      }),
    ),
    totalBase: n,
    fee: n,
    slip: s,
    approveRemark: s,
    createdBy: s,
    createdById: n,
    creatorIds: z.array(n),
    approverRoles: z.array(s),
    documentProfileId: n,
    version: n,
    salesId: n,
  })
  .meta({ id: 'SaleOrderDetail' });

export const Product = z
  .object({
    sysCode: s,
    mfgCode: s,
    name: s,
    category: s,
    brand: s,
    onhand: n,
    price: n,
    status: UiStatus,
    id: n.optional(),
    nameEn: s.optional(),
    nameCn: s.optional(),
    description: s.optional(),
    capitalPrice: n.optional().meta({ description: 'ราคาทุน — only for a role with the special right Product Cost.' }),
    wholesalePrice: n.optional(),
    received: n.optional(),
    issued: n.optional(),
    reserved: n.optional(),
    ubRepairOnly: b.optional(),
    serialControl: b.optional(),
    forModelColor: s.optional(),
    createdDate: s.optional(),
    createdBy: s.optional(),
    models: z.array(s).optional(),
    image: s.optional(),
    stockRemark: s.optional(),
    cancelRemark: s.optional(),
    cancelDate: s.optional(),
    cancelBy: s.optional(),
    version: n
      .optional()
      .meta({ description: 'row_version (a hash) — only with ราคาทุน, since it would give the cost away.' }),
  })
  .meta({ id: 'Product' });

export const Movement = z
  .object({
    doc: s,
    type: s,
    ref: s,
    date: s,
    by: s,
    from: s,
    to: s,
    remark: s,
    qty: n.optional(),
    items: s.optional(),
  })
  .meta({ id: 'Movement' });

export const IssuedLine = z
  .object({
    doc: s,
    date: s,
    type: s,
    ref: s,
    by: s,
    from: s,
    to: s,
    remark: s,
    code: s,
    item: s,
    category: s,
    qty: n,
    price: n,
    priceBasis: s,
    value: n,
  })
  .meta({ id: 'IssuedLine' });

export const SystemUser = z
  .object({
    id: s,
    code: s,
    name: s,
    username: s,
    role: s,
    branch: s,
    email: s,
    phone: s,
    lastLogin: s,
    status: UiStatus,
    avatar: s.nullish(),
    title: s.nullish(),
  })
  .meta({ id: 'SystemUser' });

export const Permission = z
  .object({ id: s, role: s, menu: s, add: b, edit: b, del: b, view: b })
  .meta({ id: 'Permission' });

/** a row of a simple master list (categories, colors, job types, …) */
export const MasterRow = z
  .object({
    id: s,
    name: s,
    detail: s,
    status: UiStatus,
    extra: s.optional(),
    days: n.optional().meta({ description: 'job types: the SLA in days' }),
  })
  .meta({ id: 'MasterRow' });
export const Symptom = MasterRow.extend({ group: s }).meta({ id: 'Symptom' });
export const Model = z
  .object({ code: s, name: s, brand: s, price: n, updated: s, status: UiStatus })
  .meta({ id: 'Model' });

export const DocumentProfile = z
  .object({
    id: n,
    code: s,
    nameTh: s,
    nameEn: s,
    addressLine1: s,
    addressLine2: s,
    address: s,
    phone: s,
    email: s,
    taxId: s,
    bankName: s,
    bankAccountType: s,
    bankAccountNo: s,
    bankAccountName: s,
    logoPath: s,
    logoUrl: s,
    stampPath: s,
    isDefault: b,
    isActive: b,
    isDeleted: b,
    sortOrder: n,
  })
  .meta({ id: 'DocumentProfile' });

export const ShippingProfile = z
  .object({
    id: n,
    code: s,
    nameTh: s,
    nameEn: s,
    logoPath: s,
    logoUrl: s,
    trackUrl: s,
    isActive: b,
    isDeleted: b,
    sortOrder: n,
  })
  .meta({ id: 'ShippingProfile' });

export const LinkStatus = z
  .object({
    state: z.enum(['unopened', 'opened', 'expired']),
    id: s.nullable().meta({
      description:
        'Which issue the current link is (the start of its hash) — compare this, not `issuedAt`, to tell two links apart.',
    }),
    issuedAt: s.nullable(),
    openedAt: s.nullable(),
    expiresAt: s.nullable(),
  })
  .meta({ id: 'LinkStatus' });

const TrackStep = z.enum(['received', 'diagnosing', 'waiting', 'repaired', 'returned']);

/** What an anonymous visitor may see of a job (src/lib/track-public.ts PublicJob — a whitelist). */
export const PublicJob = z
  .object({
    no: s,
    customerMasked: s,
    brandModel: s,
    deviceRef: s,
    receivedDate: s,
    dueDate: s,
    step: TrackStep.nullable(),
    stepLabel: s,
    cancelled: b,
    history: z.array(z.object({ key: TrackStep, at: s, label: s.optional() })),
    shipper: s,
    trackingNo: s,
    closedDate: s,
    courier: z.object({ name: s, logoUrl: s, trackUrl: s }).nullable(),
    docs: z.array(
      z.object({ kind: z.enum(['job', 'quotation', 'return']), ref: s, label: s, date: s, step: TrackStep }),
    ),
  })
  .meta({ id: 'PublicJob' });

export const PublicJobSummary = z
  .object({
    no: s,
    brandModel: s,
    deviceRef: s,
    receivedDate: s,
    closedDate: s,
    step: TrackStep.nullable(),
    stepLabel: s,
    cancelled: b,
  })
  .meta({ id: 'PublicJobSummary' });
