// Drizzle schema for the legacy SHDElectronicServiceDB tables (converted to
// PostgreSQL by setupdata/convert.py) and the tables this app added.
// The DB is the source of truth — do not "fix" legacy types here.
//
// ADR 0008: column 1 = `pk` (bigint identity ALWAYS — the internal key, never in the API), column 2 = `id`
// (uuid v7 — the external id). Relations are `<role>_<table>_pk` → `<table>.pk` (FK ON DELETE RESTRICT); a
// legacy value that pointed at no row is NULL here and kept in `legacy_orphan_ref`. Code tables (job_status, …,
// and record_status.code) stay the FK target of their code column. Constraints / indexes are owned by the
// migration; the ones declared here are the ones code reads (upsert targets) or that document a rule.
// Legacy → current property names: adr/0008-phase2-renames.md.
import {
  pgTable,
  integer,
  varchar,
  timestamp,
  boolean,
  numeric,
  uniqueIndex,
  text,
  date,
  index,
  doublePrecision,
  jsonb,
  bigint,
  uuid,
  inet,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pkCol, pkRef, uuidId } from './id';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const stockMove = pgTable(
  'stock_move',
  {
    pk: pkCol(),
    id: uuidId(),
    stockMoveNo: varchar('stock_move_no', { length: 50 }),
    stockMoveTypeId: integer('stock_move_type_id'),
    // reference_document_no split by what it pointed at (ADR 0008 decision 11)
    jobPk: pkRef('job_pk'),
    saleOrderPk: pkRef('sale_order_pk'),
    // the receive form's PO no. (free text; legacy rows '')
    poNo: varchar('po_no', { length: 50 }).notNull().default(''),
    referenceOutTo: varchar('reference_out_to', { length: 50 }),
    remark: varchar('remark', { length: 100 }),
    createDate: timestamp('create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
  },
  (t) => [
    uniqueIndex('ux_stock_move_no').on(t.stockMoveNo),
    index('gin_stock_move_po_no').using('gin', t.poNo.op('gin_trgm_ops')),
  ],
);

export const stockMoveType = pgTable(
  'stock_move_type',
  {
    pk: pkCol(),
    id: uuidId(),
    stockMoveTypeId: integer('stock_move_type_id').notNull(),
    stockMoveTypeName: varchar('stock_move_type_name', { length: 50 }),
    movementActionType: varchar('movement_action_type', { length: 50 }),
    movementAction: integer('movement_action'),
    effectMaterial: boolean('effect_material'),
    effectPackage: boolean('effect_package'),
    effectProduct: boolean('effect_product'),
    remark: varchar({ length: 100 }),
    isActive: boolean('is_active'),
  },
  (t) => [uniqueIndex('ux_stock_move_type_stock_move_type_id').on(t.stockMoveTypeId)],
);

export const modelTier = pgTable('model_tier', {
  pk: pkCol(),
  id: uuidId(),
  tierNo: varchar('tier_no', { length: 50 }),
  minPrice: numeric('min_price', { precision: 18, scale: 2 }),
  maxPrice: numeric('max_price', { precision: 18, scale: 2 }),
  rrpPercent: numeric('rrp_percent', { precision: 18, scale: 2 }),
});

export const product = pgTable(
  'product',
  {
    pk: pkCol(),
    id: uuidId(),
    productCode: varchar('product_code', { length: 50 }),
    productVendorCode: varchar('product_vendor_code', { length: 50 }),
    productName: varchar('product_name', { length: 500 }),
    productNameEn: varchar('product_name_en', { length: 200 }),
    productNameCn: varchar('product_name_cn', { length: 200 }),
    productDescription: varchar('product_description', { length: 200 }),
    categoryPk: pkRef('category_pk'),
    brandPk: pkRef('brand_pk'),
    pictureFileName: varchar('picture_file_name', { length: 50 }),
    createDate: timestamp('create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    cancelRemark: varchar('cancel_remark', { length: 100 }),
    cancelDate: timestamp('cancel_date', { mode: 'string' }),
    cancelledByAppUserPk: pkRef('cancelled_by_app_user_pk'),
    isUbRepairOnly: boolean('is_ub_repair_only'),
    forModelColor: varchar('for_model_color', { length: 50 }),
    // soft-delete status (record_status.code)
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
  },
  (t) => [uniqueIndex('ux_product_product_code').on(t.productCode)],
);

export const saleOrderLine = pgTable('sale_order_line', {
  pk: pkCol(),
  id: uuidId(),
  saleOrderPk: pkRef('sale_order_pk').notNull(),
  listNo: integer('list_no'),
  productPk: pkRef('product_pk'),
  capitalPrice: numeric('capital_price', { precision: 18, scale: 2 }),
  wholesalePrice: numeric('wholesale_price', { precision: 18, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 18, scale: 2 }),
  saleOutPrice: numeric('sale_out_price', { precision: 18, scale: 2 }),
  saleOutQuantity: integer('sale_out_quantity').notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }),
  remark: varchar('remark', { length: 100 }),
  // the code printed on the document (ADR 0008 decision 7) — kept beside product_pk
  productCode: varchar('product_code', { length: 50 }),
  pickStockMovePk: pkRef('pick_stock_move_pk'),
  returnStockMovePk: pkRef('return_stock_move_pk'),
});

export const productStock = pgTable('product_stock', {
  pk: pkCol(),
  id: uuidId(),
  productPk: pkRef('product_pk'),
  capitalPrice: numeric('capital_price', { precision: 18, scale: 2 }),
  wholesalePrice: numeric('wholesale_price', { precision: 18, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 18, scale: 2 }),
  remark: varchar({ length: 100 }),
  quantityInspection: integer('quantity_inspection'),
  quantityNotAvailable: integer('quantity_not_available'),
  quantityAvailable: integer('quantity_available'),
  quantityUsed: integer('quantity_used'),
  quantityBooking: integer('quantity_booking').notNull(),
  quantityLoss: integer('quantity_loss'),
  quantityRemain: integer('quantity_remain'),
});

export const productSerial = pgTable('product_serial', {
  pk: pkCol(),
  id: uuidId(),
  serialNo: varchar('serial_no', { length: 100 }),
  productPk: pkRef('product_pk'),
  storeLocationId: integer('store_location_id'),
  conditionId: integer('condition_id'),
  quantity: integer().notNull(),
  quantityBooking: integer('quantity_booking').notNull(),
  capitalPrice: numeric('capital_price', { precision: 18, scale: 2 }),
  wholesalePrice: numeric('wholesale_price', { precision: 18, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 18, scale: 2 }),
  remark: varchar({ length: 100 }),
  pictureFileName: varchar('picture_file_name', { length: 50 }),
  isPublish: boolean('is_publish'),
  isSaled: boolean('is_saled'),
  saleOrderPk: pkRef('sale_order_pk'),
  isActive: boolean('is_active'),
  createDate: timestamp('create_date', { mode: 'string' }),
  createdByAppUserPk: pkRef('created_by_app_user_pk'),
  cancelRemark: varchar('cancel_remark', { length: 100 }),
  cancelDate: timestamp('cancel_date', { mode: 'string' }),
  cancelledByAppUserPk: pkRef('cancelled_by_app_user_pk'),
});

// a customer without an address has NULL *_pk — there is no -1 "not given" row (ADR 0008 decision 6)
export const province = pgTable('province', {
  pk: pkCol(),
  id: uuidId(),
  nameEn: varchar('name_en', { length: 50 }).notNull(),
  nameTh: varchar('name_th', { length: 50 }).notNull(),
  region: varchar({ length: 15 }).notNull(),
});

export const district = pgTable('district', {
  pk: pkCol(),
  id: uuidId(),
  provincePk: pkRef('province_pk'),
  nameEn: varchar('name_en', { length: 50 }).notNull(),
  nameTh: varchar('name_th', { length: 50 }).notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
});

export const customer = pgTable(
  'customer',
  {
    pk: pkCol(),
    id: uuidId(),
    customerCode: varchar('customer_code', { length: 50 }),
    customerCardId: varchar('customer_card_id', { length: 20 }),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: varchar('customer_address', { length: 200 }),
    customerAddress1: varchar('customer_address1', { length: 100 }),
    customerAddress2: varchar('customer_address2', { length: 100 }),
    postalCode: varchar('postal_code', { length: 5 }),
    phoneNumber: varchar('phone_number', { length: 50 }),
    faxNumber: varchar('fax_number', { length: 50 }),
    email: varchar({ length: 50 }),
    customerType: varchar('customer_type', { length: 50 }),
    createdDate: timestamp('created_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    usePriceGroup: varchar('use_price_group', { length: 50 }),
    lineId: varchar('line_id', { length: 50 }),
    isCustomerOnline: boolean('is_customer_online'),
    provincePk: pkRef('province_pk'),
    districtPk: pkRef('district_pk'),
    subDistrictPk: pkRef('sub_district_pk'),
    // soft-delete status (record_status.code)
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    // optimistic-locking token — bumped by a trigger on every update; edit forms send it back
    rowVersion: integer('row_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('ux_customer_customer_code').on(table.customerCode),
    // customers.ts: cardDigits LIKE / = (search, duplicate tax id) and the duplicate e-mail check — same expressions
    index('gin_customer_card_id_digits').using(
      'gin',
      sql`regexp_replace(coalesce(${table.customerCardId}, ''), '\\D', '', 'g') gin_trgm_ops`,
    ),
    index('ix_customer_email_norm').on(sql`lower(trim(coalesce(${table.email}, '')))`),
  ],
);

export const subDistrict = pgTable('sub_district', {
  pk: pkCol(),
  id: uuidId(),
  provincePk: pkRef('province_pk'),
  districtPk: pkRef('district_pk'),
  nameEn: varchar('name_en', { length: 50 }).notNull(),
  nameTh: varchar('name_th', { length: 50 }).notNull(),
  postalCode: varchar('postal_code', { length: 10 }).notNull(),
});

export const appBackUpDbLog = pgTable('app_back_up_db_log', {
  pk: pkCol(),
  id: uuidId(),
  backUpDate: timestamp('back_up_date', { mode: 'string' }),
  backedUpByAppUserPk: pkRef('backed_up_by_app_user_pk'),
  backUpFileName: varchar('back_up_file_name', { length: 100 }),
});

export const rolePermission = pgTable(
  'role_permission',
  {
    pk: pkCol(),
    id: uuidId(),
    userType: varchar('user_type', { length: 50 }),
    moduleName: varchar('module_name', { length: 50 }),
    canInsert: boolean('can_insert'),
    canEdit: boolean('can_edit'),
    canDelete: boolean('can_delete'),
    canView: boolean('can_view'),
  },
  // the upsert target of services/users.ts
  (table) => [uniqueIndex('ix_user_type_and_module_name').on(table.userType, table.moduleName)],
);

export const approveStatus = pgTable(
  'approve_status',
  {
    pk: pkCol(),
    id: uuidId(),
    approveStatusId: integer('approve_status_id').notNull(),
    approveNameTh: varchar('approve_name_th', { length: 50 }),
    approveNameEn: varchar('approve_name_en', { length: 50 }),
    approveDescription: varchar('approve_description', { length: 100 }),
    isCanEdit: boolean('is_can_edit'),
    isCanRevise: boolean('is_can_revise'),
  },
  (t) => [uniqueIndex('ux_approve_status_approve_status_id').on(t.approveStatusId)],
);

export const category = pgTable(
  'category',
  {
    pk: pkCol(),
    id: uuidId(),
    categoryName: varchar('category_name', { length: 50 }),
    categoryDescription: varchar('category_description', { length: 50 }),
    shortCode: varchar('short_code', { length: 50 }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
  },
  (table) => [uniqueIndex('ix_category_name').on(table.categoryName)],
);

export const color = pgTable('color', {
  pk: pkCol(),
  id: uuidId(),
  colorName: varchar('color_name', { length: 50 }),
  description: varchar({ length: 100 }),
  recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
  statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
  statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
});

export const condition = pgTable(
  'condition',
  {
    pk: pkCol(),
    id: uuidId(),
    conditionId: integer('condition_id').notNull(),
    conditionName: varchar('condition_name', { length: 50 }),
    conditionDescription: varchar('condition_description', { length: 100 }),
    isActive: boolean('is_active'),
  },
  (t) => [uniqueIndex('ux_condition_condition_id').on(t.conditionId)],
);

export const jobAttachment = pgTable('job_attachment', {
  pk: pkCol(),
  id: uuidId(),
  // every attachment belongs to a job
  jobPk: pkRef('job_pk').notNull(),
  originalFileName: varchar('original_file_name', { length: 50 }),
  systemFileName: varchar('system_file_name', { length: 50 }),
  remark: varchar({ length: 100 }),
  recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
  statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
  statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
});

export const stockMoveLine = pgTable('stock_move_line', {
  pk: pkCol(),
  id: uuidId(),
  stockMovePk: pkRef('stock_move_pk').notNull(),
  productPk: pkRef('product_pk'),
  itemQuantity: numeric('item_quantity', { precision: 18, scale: 4 }),
});

export const job = pgTable(
  'job',
  {
    // NOT the job number: pk = the digits of job_no for the loaded jobs (ADR 0008 decision 8), identity after
    pk: pkCol(),
    id: uuidId(),
    jobNo: varchar('job_no', { length: 50 }).notNull(),
    customerPk: pkRef('customer_pk'),
    customerDetail: varchar('customer_detail', { length: 200 }),
    customerDueDate: timestamp('customer_due_date', { mode: 'string' }),
    jobCreateDate: timestamp('job_create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    jobTypePk: pkRef('job_type_pk'),
    jobTypeDetail: varchar('job_type_detail', { length: 50 }),
    jobStatusId: integer('job_status_id'),
    jobRepairedDate: timestamp('job_repaired_date', { mode: 'string' }),
    repairedByAppUserPk: pkRef('repaired_by_app_user_pk'),
    jobClosedDate: timestamp('job_closed_date', { mode: 'string' }),
    closedByAppUserPk: pkRef('closed_by_app_user_pk'),
    productImeiNo: varchar('product_imei_no', { length: 50 }),
    productSerial: varchar('product_serial', { length: 50 }),
    newSerialNo: varchar('new_serial_no', { length: 50 }),
    productTypePk: pkRef('product_type_pk'),
    modelPk: pkRef('model_pk').notNull(),
    productModelName: varchar('product_model_name', { length: 50 }),
    productModelDetail: varchar('product_model_detail', { length: 200 }),
    reportedSymptomPk: pkRef('reported_symptom_pk'),
    productSymptomOther: varchar('product_symptom_other', { length: 200 }),
    productEquipment: varchar('product_equipment', { length: 100 }),
    productFault: varchar('product_fault', { length: 100 }),
    estimateCost: numeric('estimate_cost', { precision: 18, scale: 2 }),
    depositCost: numeric('deposit_cost', { precision: 18, scale: 2 }),
    sparePartTotalCost: numeric('spare_part_total_cost', { precision: 18, scale: 2 }),
    serviceCost: numeric('service_cost', { precision: 18, scale: 2 }),
    serviceToolCost: numeric('service_tool_cost', { precision: 18, scale: 2 }),
    deliveryCost: numeric('delivery_cost', { precision: 18, scale: 2 }),
    cartonBoxCost: numeric('carton_box_cost', { precision: 18, scale: 2 }),
    jobTotalCost: numeric('job_total_cost', { precision: 18, scale: 2 }),
    jobReferenceNo: varchar('job_reference_no', { length: 50 }),
    jobRemark: text('job_remark'),
    engineerAppUserPk: pkRef('engineer_app_user_pk'),
    engineerSymptomPk: pkRef('engineer_symptom_pk'),
    engineerRepairDetail: varchar('engineer_repair_detail', { length: 200 }),
    engineerRemark: varchar('engineer_remark', { length: 200 }),
    jobPaymentType: varchar('job_payment_type', { length: 50 }),
    jobPaymentNo: varchar('job_payment_no', { length: 50 }),
    jobPaymentAmount: numeric('job_payment_amount', { precision: 18, scale: 2 }),
    jobPaymentDetail: varchar('job_payment_detail', { length: 100 }),
    jobReturnDate: timestamp('job_return_date', { mode: 'string' }),
    returnCustomerType: varchar('return_customer_type', { length: 50 }),
    returnCustomerTrackingNo: varchar('return_customer_tracking_no', { length: 50 }),
    returnCustomerDetail: varchar('return_customer_detail', { length: 100 }),
    returnedByAppUserPk: pkRef('returned_by_app_user_pk'),
    sparePartReplace: varchar('spare_part_replace', { length: 300 }),
    productWarranty: varchar('product_warranty', { length: 50 }),
    approvedQuotationPk: pkRef('approved_quotation_pk'),
    productSaleOutChannel: varchar('product_sale_out_channel', { length: 50 }),
    productSaleOrderDate: date('product_sale_order_date'),
    productWarrantyMonth: integer('product_warranty_month'),
    productExpireDate: date('product_expire_date'),
    jobReceptionType: varchar('job_reception_type', { length: 50 }),
    jobReceptionDate: date('job_reception_date'),
    jobReceptionTrackingNo: varchar('job_reception_tracking_no', { length: 50 }),
    jobReceptionShipper: varchar('job_reception_shipper', { length: 50 }),
    receptionShippingProfilePk: pkRef('reception_shipping_profile_pk'),
    swapRefundDetail: text('swap_refund_detail'),
    jobPaymentSlipFileName: varchar('job_payment_slip_file_name', { length: 100 }),
    swapRefundDocumentNo: varchar('swap_refund_document_no', { length: 100 }),
    isJobBounce: boolean('is_job_bounce'),
    productSaleOutShopName: varchar('product_sale_out_shop_name', { length: 100 }),
    // soft-delete status (record_status.code)
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    // issuing profile; NULL = SHD
    documentProfilePk: pkRef('document_profile_pk'),
    trackTokenAt: timestamp('track_token_at', { mode: 'string' }),
    // courier used for the return leg; NULL on legacy jobs
    returnShippingProfilePk: pkRef('return_shipping_profile_pk'),
    // first customer open of the current link — link lives 15 min from here
    trackOpenedAt: timestamp('track_opened_at', { mode: 'string', withTimezone: true }),
    // current expiry of an opened link — the keepalive moves it, capped at open + 60 min
    trackLinkExpiresAt: timestamp('track_link_expires_at', { mode: 'string', withTimezone: true }),
    // true only when a user picked / changed the due date in this app;
    // false = the legacy system's automatic "opened + 1 day" → the job type's SLA applies instead
    dueDateSetByUser: boolean('due_date_set_by_user').notNull().default(false),
    // sha256(link token) as hex — the only thing a link is looked up by
    trackTokenHash: varchar('track_token_hash', { length: 64 }),
    // optimistic-locking token — see customer.rowVersion
    rowVersion: integer('row_version').notNull().default(0),
  },
  (t) => [uniqueIndex('ux_job_job_no').on(t.jobNo)],
);

export const jobCallLog = pgTable('job_call_log', {
  pk: pkCol(),
  id: uuidId(),
  jobPk: pkRef('job_pk').notNull(),
  callLogDescription: varchar('call_log_description', { length: 200 }),
  callLogDate: timestamp('call_log_date', { mode: 'string' }),
  calledByAppUserPk: pkRef('called_by_app_user_pk'),
});

export const jobCloseTemp = pgTable('job_close_temp', {
  pk: pkCol(),
  id: uuidId(),
  serialNo: varchar('serial_no', { length: 50 }),
  isCanCloseJob: boolean('is_can_close_job'),
  refJobPk: pkRef('ref_job_pk'),
  nextStatusId: integer('next_status_id'),
  remark: varchar({ length: 50 }),
});

export const jobCreateTemp = pgTable('job_create_temp', {
  pk: pkCol(),
  id: uuidId(),
  productImeiNo: varchar('product_imei_no', { length: 50 }),
  lotNo: varchar('lot_no', { length: 50 }),
  modelPk: pkRef('model_pk'),
  warranty: varchar({ length: 50 }),
  isCanGenerateJob: boolean('is_can_generate_job'),
  remark: varchar({ length: 200 }),
  productSerial: varchar('product_serial', { length: 50 }),
  productModelDetail: varchar('product_model_detail', { length: 50 }),
  jobReferenceNoGspn: varchar('job_reference_no_gspn', { length: 50 }),
});

export const jobStatusLog = pgTable('job_status_log', {
  pk: pkCol(),
  id: uuidId(),
  jobPk: pkRef('job_pk').notNull(),
  jobStatusId: integer('job_status_id'),
  logDate: timestamp('log_date', { mode: 'string' }),
  actionByAppUserPk: pkRef('action_by_app_user_pk'),
});

export const jobPart = pgTable(
  'job_part',
  {
    pk: pkCol(),
    id: uuidId(),
    jobPk: pkRef('job_pk').notNull(),
    productPk: pkRef('product_pk'),
    sparePartUnitPrice: numeric('spare_part_unit_price', { precision: 18, scale: 2 }),
    isQuotation: boolean('is_quotation'),
    isSpecial: boolean('is_special'),
    requestQty: integer('request_qty'),
    sparePartTotalPrice: numeric('spare_part_total_price', { precision: 18, scale: 2 }),
    isQuotationB: boolean('is_quotation_b'),
    isSpecialB: boolean('is_special_b'),
    requestQtyB: integer('request_qty_b'),
    sparePartTotalPriceB: numeric('spare_part_total_price_b', { precision: 18, scale: 2 }),
    jobPartStatusId: integer('job_part_status_id'),
    requestDate: timestamp('request_date', { mode: 'string' }),
    requestedByAppUserPk: pkRef('requested_by_app_user_pk'),
    grantQty: integer('grant_qty'),
    grantDate: timestamp('grant_date', { mode: 'string' }),
    grantedByAppUserPk: pkRef('granted_by_app_user_pk'),
    returnQty: integer('return_qty'),
    returnDate: timestamp('return_date', { mode: 'string' }),
    returnedByAppUserPk: pkRef('returned_by_app_user_pk'),
    // store_location.store_location_id (code table)
    returnStockId: integer('return_stock_id'),
  },
  (t) => [index('ix_job_part_request_date').on(t.requestDate, t.pk)],
);

export const jobPartStatus = pgTable(
  'job_part_status',
  {
    pk: pkCol(),
    id: uuidId(),
    jobPartStatusId: integer('job_part_status_id').notNull(),
    jobPartStatusName: varchar('job_part_status_name', { length: 50 }),
    jobPartStatusDescription: varchar('job_part_status_description', { length: 50 }),
  },
  (t) => [uniqueIndex('ux_job_part_status_job_part_status_id').on(t.jobPartStatusId)],
);

export const jobReturnDt = pgTable('job_return_dt', {
  pk: pkCol(),
  id: uuidId(),
  jobReturnHdPk: pkRef('job_return_hd_pk'),
  itemNo: varchar('item_no', { length: 50 }),
  endUserName: varchar('end_user_name', { length: 100 }),
  jobPk: pkRef('job_pk'),
  productModelName: varchar('product_model_name', { length: 50 }),
  productSerialNo: varchar('product_serial_no', { length: 50 }),
  equipmentReturn: varchar('equipment_return', { length: 100 }),
});

export const jobReturnHd = pgTable(
  'job_return_hd',
  {
    pk: pkCol(),
    id: uuidId(),
    returnDate: timestamp('return_date', { mode: 'string' }),
    returnCustomerName: varchar('return_customer_name', { length: 100 }),
    originalFileName: varchar('original_file_name', { length: 50 }),
    systemFileName: varchar('system_file_name', { length: 50 }),
    createDate: timestamp('create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    returnCustomerPk: pkRef('return_customer_pk'),
    returnNo: varchar('return_no', { length: 50 }),
    imageFileName: varchar('image_file_name', { length: 50 }),
  },
  (t) => [uniqueIndex('ux_job_return_hd_return_no').on(t.returnNo)],
);

export const jobOutsource = pgTable('job_outsource', {
  pk: pkCol(),
  id: uuidId(),
  jobPk: pkRef('job_pk').notNull(),
  sendToName: varchar('send_to_name', { length: 50 }),
  sendDetail: varchar('send_detail', { length: 100 }),
  sendDate: timestamp('send_date', { mode: 'string' }),
  sentByAppUserPk: pkRef('sent_by_app_user_pk'),
  receiveDate: timestamp('receive_date', { mode: 'string' }),
  receivedByAppUserPk: pkRef('received_by_app_user_pk'),
  receiveDetail: varchar('receive_detail', { length: 100 }),
});

export const jobServiceCode = pgTable(
  'job_service_code',
  {
    pk: pkCol(),
    id: uuidId(),
    serviceCode: varchar('service_code', { length: 50 }).notNull(),
    serviceName: varchar('service_name', { length: 50 }),
    serviceDescription: varchar('service_description', { length: 50 }),
  },
  (t) => [uniqueIndex('ux_job_service_code_service_code').on(t.serviceCode)],
);

export const jobStatus = pgTable(
  'job_status',
  {
    pk: pkCol(),
    id: uuidId(),
    jobStatusId: integer('job_status_id').notNull(),
    jobStatusName: varchar('job_status_name', { length: 100 }),
    displayOrder: integer('display_order'),
    jobStatusGroup: varchar('job_status_group', { length: 50 }),
    isActive: boolean('is_active'),
  },
  (t) => [uniqueIndex('ux_job_status_job_status_id').on(t.jobStatusId)],
);

export const jobType = pgTable(
  'job_type',
  {
    pk: pkCol(),
    id: uuidId(),
    jobTypeName: varchar('job_type_name', { length: 50 }),
    jobTypeDescription: varchar('job_type_description', { length: 100 }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    // target turnaround in days
    defaultDueDays: integer('default_due_days').notNull().default(7),
  },
  (table) => [uniqueIndex('ix_job_type_name').on(table.jobTypeName)],
);

export const brand = pgTable(
  'brand',
  {
    pk: pkCol(),
    id: uuidId(),
    brandName: varchar('brand_name', { length: 50 }),
    logoName: varchar('logo_name', { length: 50 }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
  },
  (table) => [uniqueIndex('ix_brand_name').on(table.brandName)],
);

export const model = pgTable(
  'model',
  {
    pk: pkCol(),
    id: uuidId(),
    modelCode: varchar('model_code', { length: 50 }),
    modelName: varchar('model_name', { length: 50 }),
    marketPrice: numeric('market_price', { precision: 18, scale: 2 }),
    brandPk: pkRef('brand_pk'),
    lastUpdate: timestamp('last_update', { mode: 'string' }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
  },
  (table) => [
    uniqueIndex('ux_model_model_code').on(table.modelCode),
    // (name, brand, active): active = record_status 'ACTIVE'
    uniqueIndex('ix_unique_model').on(table.modelName, table.brandPk, sql`(record_status = 'ACTIVE')`),
  ],
);

export const modelColor = pgTable('model_color', {
  pk: pkCol(),
  id: uuidId(),
  modelName: varchar('model_name', { length: 50 }),
  colorName: varchar('color_name', { length: 100 }),
  defaultColor: varchar('default_color', { length: 50 }),
  extenFileName: varchar('exten_file_name', { length: 50 }),
  isActive: boolean('is_active'),
});

export const modelPart = pgTable('model_part', {
  pk: pkCol(),
  id: uuidId(),
  modelItemId: integer('model_item_id'),
  color: varchar({ length: 50 }),
  partName: varchar('part_name', { length: 50 }),
  price: numeric({ precision: 18, scale: 2 }),
  service: numeric({ precision: 18, scale: 2 }),
  remark: varchar({ length: 50 }),
});

export const productCompatibleModel = pgTable('product_compatible_model', {
  pk: pkCol(),
  id: uuidId(),
  productPk: pkRef('product_pk'),
  modelPk: pkRef('model_pk'),
});

export const productType = pgTable(
  'product_type',
  {
    pk: pkCol(),
    id: uuidId(),
    productTypeName: varchar('product_type_name', { length: 50 }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    productTypeDescription: varchar('product_type_description', { length: 100 }).notNull().default(''),
  },
  (table) => [uniqueIndex('ix_product_type_name').on(table.productTypeName)],
);

export const quotationLine = pgTable('quotation_line', {
  pk: pkCol(),
  id: uuidId(),
  quotationPk: pkRef('quotation_pk').notNull(),
  lineNumber: integer('line_number'),
  itemType: varchar('item_type', { length: 50 }),
  // the code printed on the document (ADR 0008 decision 7) — kept beside product_pk
  itemCode: varchar('item_code', { length: 50 }),
  productPk: pkRef('product_pk'),
  itemDetail: varchar('item_detail', { length: 100 }),
  quantity: numeric({ precision: 12, scale: 2 }),
  unitPrice: numeric('unit_price', { precision: 18, scale: 2 }),
  unitPriceDiscount: numeric('unit_price_discount', { precision: 18, scale: 2 }),
  totalPrice: numeric('total_price', { precision: 18, scale: 2 }),
  unitPriceDiscountPercent: numeric('unit_price_discount_percent', { precision: 18, scale: 2 }),
});

export const quotation = pgTable(
  'quotation',
  {
    pk: pkCol(),
    id: uuidId(),
    quotationNo: varchar('quotation_no', { length: 50 }),
    customerPk: pkRef('customer_pk'),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: varchar('customer_address', { length: 500 }),
    customerTaxId: varchar('customer_tax_id', { length: 20 }),
    customerPhone: varchar('customer_phone', { length: 50 }),
    createDate: timestamp('create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    sparePartAmount: numeric('spare_part_amount', { precision: 19, scale: 4 }),
    serviceAmount: numeric('service_amount', { precision: 19, scale: 4 }),
    sumExcludeAmount: numeric('sum_exclude_amount', { precision: 19, scale: 4 }),
    discountType: varchar('discount_type', { length: 50 }),
    discountFormula: varchar('discount_formula', { length: 100 }),
    discountAmount: numeric('discount_amount', { precision: 19, scale: 4 }),
    afterDiscountAmount: numeric('after_discount_amount', { precision: 19, scale: 4 }),
    totalBaseAmount: numeric('total_base_amount', { precision: 19, scale: 4 }),
    vatRate: doublePrecision('vat_rate'),
    vatAmount: numeric('vat_amount', { precision: 19, scale: 4 }),
    totalAmount: numeric('total_amount', { precision: 19, scale: 4 }),
    roundingAmount: numeric('rounding_amount', { precision: 19, scale: 4 }),
    netAmount: numeric('net_amount', { precision: 19, scale: 4 }),
    remark: text(),
    jobPk: pkRef('job_pk'),
    quotationStatusId: integer('quotation_status_id'),
    customerApproveDate: timestamp('customer_approve_date', { mode: 'string' }),
    customerApproveRemark: varchar('customer_approve_remark', { length: 100 }),
    quotationType: varchar('quotation_type', { length: 50 }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    // issuing profile; NULL = SHD
    documentProfilePk: pkRef('document_profile_pk'),
    // optimistic-locking token — see customer.rowVersion
    rowVersion: integer('row_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('ux_quotation_no').on(table.quotationNo),
    // one agreed quotation per job (QS.AGREED / AGREED_WAIT_PAY / AGREED_WAIT_PARTS) — the job's approved one
    uniqueIndex('ux_quotation_agreed_job')
      .on(table.jobPk)
      .where(sql`quotation_status_id IN (3, 6, 9)`),
    index('ix_quotation_create_date').on(table.createDate),
  ],
);

export const quotationStatus = pgTable(
  'quotation_status',
  {
    pk: pkCol(),
    id: uuidId(),
    quotationStatusId: integer('quotation_status_id').notNull(),
    quotationStatusName: varchar('quotation_status_name', { length: 50 }).notNull(),
  },
  (t) => [uniqueIndex('ux_quotation_status_quotation_status_id').on(t.quotationStatusId)],
);

export const quotationTemp = pgTable('quotation_temp', {
  pk: pkCol(),
  id: uuidId(),
  quotationPk: pkRef('quotation_pk'),
  isCanEdit: boolean('is_can_edit'),
});

export const runningNo = pgTable('running_no', {
  pk: pkCol(),
  id: uuidId(),
  runningType: varchar('running_type', { length: 50 }).notNull(),
  companyId: integer('company_id').notNull(),
  branchId: integer('branch_id').notNull(),
  prefix: varchar({ length: 10 }).notNull(),
  pyear: integer().notNull(),
  pmonth: integer().notNull(),
  pday: integer().notNull(),
  number: integer().notNull(),
  lengthYear: integer('length_year').notNull(),
  lengthMonth: integer('length_month').notNull(),
  lengthNumber: integer('length_number').notNull(),
});

export const saleInDt = pgTable('sale_in_dt', {
  pk: pkCol(),
  id: uuidId(),
  saleInHdPk: pkRef('sale_in_hd_pk'),
  listNo: integer('list_no'),
  productPk: pkRef('product_pk'),
  storeLocationId: integer('store_location_id'),
  conditionId: integer('condition_id'),
  serialNo: varchar('serial_no', { length: 50 }),
  quantityAtCurrent: integer('quantity_at_current'),
  quantityIncome: integer('quantity_income'),
  capitalPrice: numeric('capital_price', { precision: 18, scale: 2 }),
  wholesalePrice: numeric('wholesale_price', { precision: 18, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 18, scale: 2 }),
  remark: varchar({ length: 100 }),
});

export const saleInHd = pgTable(
  'sale_in_hd',
  {
    pk: pkCol(),
    id: uuidId(),
    saleInHdNo: varchar('sale_in_hd_no', { length: 50 }),
    saleInType: varchar('sale_in_type', { length: 50 }),
    saleInDate: timestamp('sale_in_date', { mode: 'string' }),
    saleInByAppUserPk: pkRef('sale_in_by_app_user_pk'),
  },
  (t) => [uniqueIndex('ux_sale_in_hd_sale_in_hd_no').on(t.saleInHdNo)],
);

export const saleOrder = pgTable(
  'sale_order',
  {
    pk: pkCol(),
    id: uuidId(),
    saleOrderNo: varchar('sale_order_no', { length: 50 }),
    documentCreateDate: timestamp('document_create_date', { mode: 'string' }),
    createdByAppUserPk: pkRef('created_by_app_user_pk'),
    documentCancelDate: timestamp('document_cancel_date', { mode: 'string' }),
    cancelledByAppUserPk: pkRef('cancelled_by_app_user_pk'),
    documentCancelRemark: varchar('document_cancel_remark', { length: 100 }),
    customerPk: pkRef('customer_pk'),
    customerCardId: varchar('customer_card_id', { length: 50 }),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: varchar('customer_address', { length: 500 }),
    customerPhoneNumber: varchar('customer_phone_number', { length: 50 }),
    customerFaxNumber: varchar('customer_fax_number', { length: 50 }),
    totalBaseAmount: numeric('total_base_amount', { precision: 18, scale: 2 }),
    vatRate: numeric('vat_rate', { precision: 18, scale: 2 }),
    vatAmount: numeric('vat_amount', { precision: 18, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 18, scale: 2 }),
    roundingAmount: numeric('rounding_amount', { precision: 18, scale: 2 }),
    feeAmount: numeric('fee_amount', { precision: 18, scale: 2 }),
    netAmount: numeric('net_amount', { precision: 18, scale: 2 }),
    remark: varchar('remark', { length: 100 }),
    saleOutByAppUserPk: pkRef('sale_out_by_app_user_pk'),
    paymentType: varchar('payment_type', { length: 50 }),
    paymentAmount: numeric('payment_amount', { precision: 11, scale: 2 }),
    slipFileName: varchar('slip_file_name', { length: 100 }),
    approveStatusId: integer('approve_status_id'),
    approveDate: timestamp('approve_date', { mode: 'string' }),
    approvedByAppUserPk: pkRef('approved_by_app_user_pk'),
    approveRemark: varchar('approve_remark', { length: 100 }),
    deliveryTrackingNo: varchar('delivery_tracking_no', { length: 50 }),
    deliveryDate: timestamp('delivery_date', { mode: 'string' }),
    recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
    statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
    // issuing profile; NULL = SHD
    documentProfilePk: pkRef('document_profile_pk'),
    // optimistic-locking token — see customer.rowVersion
    rowVersion: integer('row_version').notNull().default(0),
  },
  (t) => [uniqueIndex('ux_sale_order_no').on(t.saleOrderNo)],
);

export const serviceCost = pgTable(
  'service_cost',
  {
    pk: pkCol(),
    id: uuidId(),
    serviceCode: varchar('service_code', { length: 50 }).notNull(),
    serviceDescription: varchar('service_description', { length: 100 }),
    serviceCost: numeric('service_cost', { precision: 18, scale: 2 }),
  },
  (t) => [uniqueIndex('ux_service_cost_service_code').on(t.serviceCode)],
);

export const storeLocation = pgTable(
  'store_location',
  {
    pk: pkCol(),
    id: uuidId(),
    storeLocationId: integer('store_location_id').notNull(),
    storeLocationName: varchar('store_location_name', { length: 50 }),
    storeLocationDescription: varchar('store_location_description', { length: 50 }),
    storeLocationGroup: varchar('store_location_group', { length: 50 }),
    isActive: boolean('is_active'),
  },
  (table) => [
    uniqueIndex('ux_store_location_store_location_id').on(table.storeLocationId),
    uniqueIndex('ix_store_location_name').on(table.storeLocationName),
  ],
);

export const symptom = pgTable('symptom', {
  pk: pkCol(),
  id: uuidId(),
  symptomName: varchar('symptom_name', { length: 50 }),
  symptomDescription: varchar('symptom_description', { length: 100 }),
  symptomGroupName: varchar('symptom_group_name', { length: 50 }),
  recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
  statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
  statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
});

export const tempModel = pgTable('temp_model', {
  pk: pkCol(),
  id: uuidId(),
  modelName: varchar('model_name', { length: 50 }),
  modelCode: varchar('model_code', { length: 50 }),
  marketPrice: numeric('market_price', { precision: 18, scale: 2 }),
});

export const tempSparePart = pgTable('temp_spare_part', {
  pk: pkCol(),
  id: uuidId(),
  itemId: integer('item_id'),
  productVenderCode: varchar('product_vender_code', { length: 50 }),
  sparePartNameTh: varchar('spare_part_name_th', { length: 100 }),
  sparePartNameEn: varchar('spare_part_name_en', { length: 100 }),
  sparePartNameCn: varchar('spare_part_name_cn', { length: 100 }),
  sparePartDescription: varchar('spare_part_description', { length: 200 }),
  manufacturerName: varchar('manufacturer_name', { length: 50 }),
  quantityRemain: integer('quantity_remain'),
  capitalPrice: numeric('capital_price', { precision: 18, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 18, scale: 2 }),
});

export const appUser = pgTable('app_user', {
  // = the legacy user_id (user 105 = pk 105)
  pk: pkCol(),
  id: uuidId(),
  username: varchar({ length: 50 }),
  firstName: varchar('first_name', { length: 50 }),
  lastName: varchar('last_name', { length: 50 }),
  userType: varchar('user_type', { length: 50 }),
  phoneNo: varchar('phone_no', { length: 50 }),
  emailAddress: varchar('email_address', { length: 100 }),
  // SSO profile
  larkId: varchar('lark_id', { length: 50 }),
  department: varchar({ length: 100 }),
  title: varchar({ length: 100 }),
  avatar: text(),
  lastLogin: timestamp('last_login', { mode: 'string' }),
  recordStatus: varchar('record_status', { length: 10 }).notNull().default('ACTIVE'),
  statusChangedAt: timestamp('status_changed_at', { mode: 'string' }),
  statusChangedByAppUserPk: pkRef('status_changed_by_app_user_pk'),
  // part of every session cookie; logout bumps it (all devices signed out)
  sessionVersion: integer('session_version').notNull().default(0),
});

export const jobSymptom = pgTable(
  'job_symptom',
  {
    pk: pkCol(),
    id: uuidId(),
    jobPk: pkRef('job_pk').notNull(),
    symptomPk: pkRef('symptom_pk').notNull(),
  },
  (table) => [uniqueIndex('ux_job_symptom_job_pk_symptom_pk').on(table.jobPk, table.symptomPk)],
);

export const recordStatus = pgTable(
  'record_status',
  {
    pk: pkCol(),
    id: uuidId(),
    // the FK target of every record_status column (code table)
    code: varchar({ length: 10 }).notNull(),
    nameTh: varchar('name_th', { length: 50 }).notNull(),
    nameEn: varchar('name_en', { length: 50 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [uniqueIndex('ux_record_status_code').on(t.code)],
);

/**
 * What staff changed — the actor as at the time of the action. Append-only (trigger); row_hash = sha256 of the
 * row, set by a trigger on insert (no chain). Rows older than drizzle/0006 have NULL where they never recorded a
 * value (actor_email … request_id).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    pk: pkCol(),
    id: uuidId(),
    at: timestamp('at', { mode: 'string' }).notNull(),
    // NULL = the system / anonymous
    actorPk: pkRef('actor_pk'),
    actorName: varchar('actor_name', { length: 100 }).notNull().default(''),
    actorEmail: varchar('actor_email', { length: 100 }),
    /** app_user.user_type at the time */
    actorRole: varchar('actor_role', { length: 50 }),
    actorDepartment: varchar('actor_department', { length: 100 }),
    action: varchar('action', { length: 20 }).notNull(),
    module: varchar('module', { length: 50 }).notNull().default(''),
    /** the module / right + action used */
    permission: text('permission'),
    entity: varchar('entity', { length: 50 }).notNull(),
    entityKey: varchar('entity_key', { length: 100 }).notNull().default(''),
    entityId: uuid('entity_id'),
    /** its business number (J…, SO…, Q…, C…) */
    entityNo: text('entity_no'),
    summary: varchar('summary', { length: 200 }).notNull().default(''),
    reason: text('reason'),
    changes: jsonb('changes'),
    meta: jsonb('meta'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    /** the session's identifier — never the cookie */
    sessionId: text('session_id'),
    requestId: text('request_id'),
    /** set by the database (trigger) */
    rowHash: bytea('row_hash'),
  },
  (table) => [
    index('ix_audit_log_entity').using('btree', table.entity.asc(), table.entityKey.asc(), table.at.desc()),
    index('ix_audit_log_entity_id').using('btree', table.entity.asc(), table.entityId.asc(), table.at.desc()),
    index('ix_audit_log_entity_no').on(table.entityNo),
    index('ix_audit_log_actor').using('btree', table.actorPk.asc(), table.at.desc()),
    index('ix_audit_log_at').using('btree', table.at.desc()),
    index('ix_audit_log_module').using('btree', table.module.asc(), table.at.desc()),
  ],
);

/**
 * Security events: sign-in / failed sign-in / sign-out, refusals, role / permission / user status changes,
 * exports, prints — actor as at the time. Append-only, row_hash by trigger. LOGIN rows older than drizzle/0006
 * are in audit_log.
 */
export const securityLog = pgTable(
  'security_log',
  {
    pk: pkCol(),
    id: uuidId(),
    // as auditLog.at: Thai wall clock (ADR 0001), written by the app
    at: timestamp('at', { mode: 'string' }).notNull(),
    /** LOGIN | LOGIN_FAILED | LOGOUT | DENIED | ROLE_CHANGE | PERMISSION_CHANGE | USER_STATUS | EXPORT | PRINT (CHECK) */
    event: varchar('event', { length: 20 }).notNull(),
    /** OK | DENIED | FAILED (CHECK) */
    result: varchar('result', { length: 10 }).notNull(),
    actorPk: pkRef('actor_pk'),
    actorName: varchar('actor_name', { length: 100 }),
    actorEmail: varchar('actor_email', { length: 100 }),
    actorRole: varchar('actor_role', { length: 50 }),
    actorDepartment: varchar('actor_department', { length: 100 }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    sessionId: text('session_id'),
    requestId: text('request_id'),
    module: varchar('module', { length: 50 }),
    permission: text('permission'),
    entity: varchar('entity', { length: 50 }),
    entityId: uuid('entity_id'),
    entityNo: text('entity_no'),
    detail: jsonb('detail'),
    rowHash: bytea('row_hash'),
  },
  (table) => [
    index('ix_security_log_at').on(table.at),
    index('ix_security_log_actor').on(table.actorPk, table.at),
    index('ix_security_log_event').on(table.event, table.at),
  ],
);

// "ออกเอกสารในนาม" — the company a document is issued as
export const documentProfile = pgTable(
  'document_profile',
  {
    pk: pkCol(),
    id: uuidId(),
    code: varchar('code', { length: 20 }).notNull(),
    nameTh: varchar('name_th', { length: 200 }).notNull(),
    nameEn: varchar('name_en', { length: 200 }).notNull().default(''),
    addressLine1: varchar('address_line1', { length: 200 }).notNull().default(''),
    addressLine2: varchar('address_line2', { length: 200 }).notNull().default(''),
    phone: varchar('phone', { length: 50 }).notNull().default(''),
    email: varchar('email', { length: 100 }).notNull().default(''),
    taxId: varchar('tax_id', { length: 20 }).notNull().default(''),
    bankName: varchar('bank_name', { length: 100 }).notNull().default(''),
    bankAccountType: varchar('bank_account_type', { length: 50 }).notNull().default(''),
    bankAccountNo: varchar('bank_account_no', { length: 50 }).notNull().default(''),
    bankAccountName: varchar('bank_account_name', { length: 200 }).notNull().default(''),
    logoPath: varchar('logo_path', { length: 200 }).notNull().default(''),
    stampPath: varchar('stamp_path', { length: 200 }).notNull().default(''),
    prefixJob: varchar('prefix_job', { length: 10 }).notNull(),
    prefixQuotation: varchar('prefix_quotation', { length: 10 }).notNull(),
    prefixSaleOrder: varchar('prefix_sale_order', { length: 10 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
    // soft delete: hidden from lists/dropdowns, still printable for old documents
    deletedAt: timestamp('deleted_at', { mode: 'string' }),
    deletedByAppUserPk: pkRef('deleted_by_app_user_pk'),
    /** 'document' = an issuer (ออกเอกสารในนาม) · 'pick_slip' = the header of ใบเบิกสินค้า only */
    purpose: varchar('purpose', { length: 20 }).notNull().default('document'),
  },
  // a deleted profile frees its code: unique among live rows only
  (t) => [
    uniqueIndex('ux_document_profile_code_live')
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

/** โปรไฟล์บริษัทขนส่ง — logo + tracking URL shown on the public tracking page */
export const shippingProfile = pgTable(
  'shipping_profile',
  {
    pk: pkCol(),
    id: uuidId(),
    code: varchar('code', { length: 20 }).notNull(),
    nameTh: varchar('name_th', { length: 200 }).notNull(),
    nameEn: varchar('name_en', { length: 200 }).notNull().default(''),
    logoPath: varchar('logo_path', { length: 200 }).notNull().default(''),
    /** {no} is replaced with the tracking number */
    trackUrl: varchar('track_url', { length: 300 }).notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { mode: 'string' }),
    deletedByAppUserPk: pkRef('deleted_by_app_user_pk'),
    /** other names of the courier (legacy free text), comma separated — src/lib/shipper.ts */
    aliases: varchar('aliases', { length: 500 }).notNull().default(''),
  },
  // a deleted profile frees its code: unique among live rows only
  (t) => [
    uniqueIndex('ux_shipping_profile_code_live')
      .on(t.code)
      .where(sql`deleted_at IS NULL`),
  ],
);

/**
 * A legacy relation value that pointed at no row (ADR 0008 decision 4): the FK went NULL, the old value is kept
 * here, one row per (table, row, column). No FK (row_pk is any table's pk).
 */
export const legacyOrphanRef = pgTable(
  'legacy_orphan_ref',
  {
    pk: pkCol(),
    id: uuidId(),
    tableName: varchar('table_name', { length: 63 }).notNull(),
    rowPk: pkRef('row_pk').notNull(),
    /** the legacy column name */
    columnName: varchar('column_name', { length: 63 }).notNull(),
    legacyValue: text('legacy_value').notNull(),
  },
  (table) => [uniqueIndex('ux_legacy_orphan_ref_row').on(table.tableName, table.rowPk, table.columnName)],
);

/**
 * The highest pk each table had when the legacy data was converted (table_name = the current table name).
 * A row with pk <= maxPk came from the legacy system — its money / quantity fields are locked.
 */
export const legacyBoundary = pgTable(
  'legacy_boundary',
  {
    pk: pkCol(),
    id: uuidId(),
    tableName: varchar('table_name', { length: 63 }).notNull(),
    maxPk: bigint('max_pk', { mode: 'number' }).notNull(),
    loadedAt: timestamp('loaded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ux_legacy_boundary_table_name').on(table.tableName)],
);
