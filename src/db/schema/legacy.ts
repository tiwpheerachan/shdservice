// Drizzle schema for the legacy SHDElectronicServiceDB tables (converted to
// PostgreSQL by setupdata/convert.py). Generated with `drizzle-kit pull` against
// a local load of the dump, then hand-edited:
//   - identity options simplified
//   - app_user gained the SSO profile columns (see drizzle/0001_app.sql)
// Column names are the DB's snake_case names; property names are camelCase.
// The DB is the source of truth — do not "fix" legacy types here.
import { pgTable, integer, varchar, timestamp, boolean, numeric, foreignKey, uniqueIndex, text, date, bigint, index, doublePrecision, pgView, primaryKey, jsonb, bigserial, serial } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const inventoryHd = pgTable("inventory_hd", {
	inventoryHdId: integer("inventory_hd_id").primaryKey().generatedByDefaultAsIdentity(),
	inventoryNo: varchar("inventory_no", { length: 50 }),
	inventoryTypeId: integer("inventory_type_id"),
	itemType: varchar("item_type", { length: 50 }),
	referenceDocumentNo: varchar("reference_document_no", { length: 50 }),
	referenceOutTo: varchar("reference_out_to", { length: 50 }),
	inventoryRemark: varchar("inventory_remark", { length: 100 }),
	createDate: timestamp("create_date", { mode: 'string' }),
	createBy: integer("create_by"),
	isActive: boolean("is_active"),
	companyId: integer("company_id"),
	branchId: integer("branch_id"),
});

export const inventoryType = pgTable("inventory_type", {
	inventoryTypeId: integer("inventory_type_id").primaryKey().notNull(),
	inventoryTypeName: varchar("inventory_type_name", { length: 50 }),
	movementActionType: varchar("movement_action_type", { length: 50 }),
	movementAction: integer("movement_action"),
	effectMaterial: boolean("effect_material"),
	effectPackage: boolean("effect_package"),
	effectProduct: boolean("effect_product"),
	remark: varchar({ length: 100 }),
	isActive: boolean("is_active"),
});

export const modelTier = pgTable("model_tier", {
	tierId: integer("tier_id").primaryKey().generatedByDefaultAsIdentity(),
	tierNo: varchar("tier_no", { length: 50 }),
	minPrice: numeric("min_price", { precision: 18, scale:  2 }),
	maxPrice: numeric("max_price", { precision: 18, scale:  2 }),
	rrpPercent: numeric("rrp_percent", { precision: 18, scale:  2 }),
});

export const product = pgTable("product", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	productId: integer("product_id").primaryKey().generatedByDefaultAsIdentity(),
	productCode: varchar("product_code", { length: 50 }),
	productVenderCode: varchar("product_vender_code", { length: 50 }),
	productName: varchar("product_name", { length: 500 }),
	productNameEn: varchar("product_name_en", { length: 200 }),
	productNameCn: varchar("product_name_cn", { length: 200 }),
	productDescription: varchar("product_description", { length: 200 }),
	categoryId: integer("category_id"),
	manufacturerId: integer("manufacturer_id"),
	isSerialControl: boolean("is_serial_control"),
	pictrueFileName: varchar("pictrue_file_name", { length: 50 }),
	isActive: boolean("is_active"),
	createDate: timestamp("create_date", { mode: 'string' }),
	createBy: integer("create_by"),
	cancelRemark: varchar("cancel_remark", { length: 100 }),
	cancelDate: timestamp("cancel_date", { mode: 'string' }),
	cancelBy: integer("cancel_by"),
	isUbRepairOnly: boolean("is_ub_repair_only"),
	forModelColor: varchar("for_model_color", { length: 50 }),
});

export const saleOutDt = pgTable("sale_out_dt", {
	saleOutDtId: integer("sale_out_dt_id").primaryKey().generatedByDefaultAsIdentity(),
	saleOutHdNo: varchar("sale_out_hd_no", { length: 50 }),
	listNo: integer("list_no"),
	productId: integer("product_id"),
	storeLocationId: integer("store_location_id"),
	conditionId: integer("condition_id"),
	serialNo: varchar("serial_no", { length: 50 }),
	capitalPrice: numeric("capital_price", { precision: 18, scale:  2 }),
	wholesalePrice: numeric("wholesale_price", { precision: 18, scale:  2 }),
	retailPrice: numeric("retail_price", { precision: 18, scale:  2 }),
	saleOutPrice: numeric("sale_out_price", { precision: 18, scale:  2 }),
	saleOutQuantity: integer("sale_out_quantity").notNull(),
	amountDt: numeric("amount_dt", { precision: 18, scale:  2 }),
	remarkDt: varchar("remark_dt", { length: 100 }),
	onhandItemId: integer("onhand_item_id"),
	productType: varchar("product_type", { length: 50 }),
	documentCreditNoteNo: varchar("document_credit_note_no", { length: 50 }),
	productCode: varchar("product_code", { length: 50 }),
	pickInventoryNo: varchar("pick_inventory_no", { length: 50 }),
	returnInventoryNo: varchar("return_inventory_no", { length: 50 }),
});

export const productNoneSerial = pgTable("product_none_serial", {
	itemId: integer("item_id").primaryKey().generatedByDefaultAsIdentity(),
	productId: integer("product_id"),
	storeLocationId: integer("store_location_id"),
	conditionId: integer("condition_id"),
	capitalPrice: numeric("capital_price", { precision: 18, scale:  2 }),
	wholesalePrice: numeric("wholesale_price", { precision: 18, scale:  2 }),
	retailPrice: numeric("retail_price", { precision: 18, scale:  2 }),
	remark: varchar({ length: 100 }),
	isPublish: boolean("is_publish"),
	quantityInspection: integer("quantity_inspection"),
	quantityNotAvailable: integer("quantity_not_available"),
	quantityAvailable: integer("quantity_available"),
	quantityUsed: integer("quantity_used"),
	quantityBooking: integer("quantity_booking").notNull(),
	quantityLoss: integer("quantity_loss"),
	quantityRemain: integer("quantity_remain"),
});

export const productSerial = pgTable("product_serial", {
	itemId: integer("item_id").primaryKey().generatedByDefaultAsIdentity(),
	serialNo: varchar("serial_no", { length: 100 }),
	productId: integer("product_id"),
	storeLocationId: integer("store_location_id"),
	conditionId: integer("condition_id"),
	quantity: integer().notNull(),
	quantityBooking: integer("quantity_booking").notNull(),
	capitalPrice: numeric("capital_price", { precision: 18, scale:  2 }),
	wholesalePrice: numeric("wholesale_price", { precision: 18, scale:  2 }),
	retailPrice: numeric("retail_price", { precision: 18, scale:  2 }),
	remark: varchar({ length: 100 }),
	pictureFileName: varchar("picture_file_name", { length: 50 }),
	isPublish: boolean("is_publish"),
	isSaled: boolean("is_saled"),
	saleOutHdNo: varchar("sale_out_hd_no", { length: 50 }),
	isActive: boolean("is_active"),
	createDate: timestamp("create_date", { mode: 'string' }),
	createBy: integer("create_by"),
	cancelRemark: varchar("cancel_remark", { length: 100 }),
	cancelDate: timestamp("cancel_date", { mode: 'string' }),
	cancelBy: integer("cancel_by"),
});

export const mtCity = pgTable("mt_city", {
	cityId: integer("city_id").primaryKey().notNull(),
	nameEn: varchar("name_en", { length: 50 }).notNull(),
	nameTh: varchar("name_th", { length: 50 }).notNull(),
	region: varchar({ length: 15 }).notNull(),
});

export const mtDistrict = pgTable("mt_district", {
	cityId: integer("city_id").notNull(),
	districtId: integer("district_id").primaryKey().notNull(),
	nameEn: varchar("name_en", { length: 50 }).notNull(),
	nameTh: varchar("name_th", { length: 50 }).notNull(),
	postalCode: varchar("postal_code", { length: 10 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [mtCity.cityId],
			name: "fk_mt_district_mt_city"
		}),
]);

export const customer = pgTable("customer", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	customerId: integer("customer_id").primaryKey().generatedByDefaultAsIdentity(),
	customerCode: varchar("customer_code", { length: 50 }),
	customerCardId: varchar("customer_card_id", { length: 20 }),
	customerName: varchar("customer_name", { length: 200 }),
	customerAddress: varchar("customer_address", { length: 200 }),
	customerAddress1: varchar("customer_address1", { length: 100 }),
	customerAddress2: varchar("customer_address2", { length: 100 }),
	postalCode: varchar("postal_code", { length: 5 }),
	phoneNumber: varchar("phone_number", { length: 50 }),
	faxNumber: varchar("fax_number", { length: 50 }),
	email: varchar({ length: 50 }),
	customerType: varchar("customer_type", { length: 50 }),
	createdDate: timestamp("created_date", { mode: 'string' }),
	createBy: integer("create_by"),
	isActive: boolean("is_active"),
	usePriceGroup: varchar("use_price_group", { length: 50 }),
	lineId: varchar("line_id", { length: 50 }),
	isCustomerOnline: boolean("is_customer_online"),
	cityId: integer("city_id"),
	districtId: integer("district_id"),
	subDistrictId: integer("sub_district_id"),
}, (table) => [
	uniqueIndex("ix_customer_code").using("btree", table.customerCode.asc().nullsLast().op("text_ops")),
]);

export const mtSubDistrict = pgTable("mt_sub_district", {
	cityId: integer("city_id").notNull(),
	districtId: integer("district_id").notNull(),
	subDistrictId: integer("sub_district_id").primaryKey().notNull(),
	nameEn: varchar("name_en", { length: 50 }).notNull(),
	nameTh: varchar("name_th", { length: 50 }).notNull(),
	postalCode: varchar("postal_code", { length: 10 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [mtCity.cityId],
			name: "fk_mt_sub_district_mt_city"
		}),
	foreignKey({
			columns: [table.districtId],
			foreignColumns: [mtDistrict.districtId],
			name: "fk_mt_sub_district_mt_district"
		}),
]);

export const appBackUpDbLog = pgTable("app_back_up_db_log", {
	id: integer().primaryKey().generatedByDefaultAsIdentity(),
	backUpDate: timestamp("back_up_date", { mode: 'string' }),
	backUpBy: integer("back_up_by"),
	backUpFileName: varchar("back_up_file_name", { length: 100 }),
});

export const appConfig = pgTable("app_config", {
	configId: integer("config_id").primaryKey().generatedByDefaultAsIdentity(),
	userType: varchar("user_type", { length: 50 }),
	moduleName: varchar("module_name", { length: 50 }),
	canInsert: boolean("can_insert"),
	canEdit: boolean("can_edit"),
	canDelete: boolean("can_delete"),
	canView: boolean("can_view"),
}, (table) => [
	uniqueIndex("ix_user_type_and_module_name").using("btree", table.userType.asc().nullsLast().op("text_ops"), table.moduleName.asc().nullsLast().op("text_ops")),
]);

export const approveStatus = pgTable("approve_status", {
	approveStatusId: integer("approve_status_id").primaryKey().notNull(),
	approveNameTh: varchar("approve_name_th", { length: 50 }),
	approveNameEn: varchar("approve_name_en", { length: 50 }),
	approveDescription: varchar("approve_description", { length: 100 }),
	isCanEdit: boolean("is_can_edit"),
	isCanRevise: boolean("is_can_revise"),
});

export const category = pgTable("category", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	categoryId: integer("category_id").primaryKey().generatedByDefaultAsIdentity(),
	categoryName: varchar("category_name", { length: 50 }),
	categoryDescription: varchar("category_description", { length: 50 }),
	shotCode: varchar("shot_code", { length: 50 }),
	isActive: boolean("is_active"),
}, (table) => [
	uniqueIndex("ix_category_name").using("btree", table.categoryName.asc().nullsLast().op("text_ops")),
]);

export const color = pgTable("color", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	id: integer().primaryKey().generatedByDefaultAsIdentity(),
	colorName: varchar("color_name", { length: 50 }),
	description: varchar({ length: 100 }),
	isActive: boolean("is_active"),
});

export const condition = pgTable("condition", {
	conditionId: integer("condition_id").primaryKey().generatedByDefaultAsIdentity(),
	conditionName: varchar("condition_name", { length: 50 }),
	conditionDescription: varchar("condition_description", { length: 100 }),
	isActive: boolean("is_active"),
});

export const documentAttach = pgTable("document_attach", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	documentAttachId: integer("document_attach_id").primaryKey().generatedByDefaultAsIdentity(),
	referenceTopic: varchar("reference_topic", { length: 50 }),
	referenceItemCode: varchar("reference_item_code", { length: 50 }),
	originalFileName: varchar("original_file_name", { length: 50 }),
	systemFileName: varchar("system_file_name", { length: 50 }),
	remark: varchar({ length: 100 }),
	isActive: boolean("is_active"),
});

export const inventoryDt = pgTable("inventory_dt", {
	inventoryDtId: integer("inventory_dt_id").primaryKey().generatedByDefaultAsIdentity(),
	inventoryNo: varchar("inventory_no", { length: 50 }),
	itemCode: varchar("item_code", { length: 50 }),
	itemQuantity: numeric("item_quantity", { precision: 18, scale:  4 }),
	itemUnit: varchar("item_unit", { length: 50 }),
	storeLocationId: integer("store_location_id"),
	stockTypeId: integer("stock_type_id"),
	receiveInventoryNo: varchar("receive_inventory_no", { length: 20 }),
});

export const job = pgTable("job", {
	// --- issuing profile added by this app (drizzle/0007_document_profile.sql); NULL = SHD ---
	documentProfileId: integer("document_profile_id"),
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	jobNo: varchar("job_no", { length: 50 }).primaryKey().notNull(),
	companyId: integer("company_id"),
	branchId: integer("branch_id"),
	customerId: integer("customer_id"),
	customerDetail: varchar("customer_detail", { length: 200 }),
	customerDueDate: timestamp("customer_due_date", { mode: 'string' }),
	jobCreateDate: timestamp("job_create_date", { mode: 'string' }),
	jobCreateBy: integer("job_create_by"),
	jobTypeId: integer("job_type_id"),
	jobTypeDetail: varchar("job_type_detail", { length: 50 }),
	jobStatusId: integer("job_status_id"),
	jobRepairedDate: timestamp("job_repaired_date", { mode: 'string' }),
	jobRepairedBy: integer("job_repaired_by"),
	jobClosedDate: timestamp("job_closed_date", { mode: 'string' }),
	jobClosedBy: integer("job_closed_by"),
	productImeiNo: varchar("product_imei_no", { length: 50 }),
	productSerial: varchar("product_serial", { length: 50 }),
	productTypeId: integer("product_type_id"),
	productBrandId: integer("product_brand_id"),
	productModelId: integer("product_model_id"),
	productModelName: varchar("product_model_name", { length: 50 }),
	productModelDetail: varchar("product_model_detail", { length: 200 }),
	productColor: varchar("product_color", { length: 50 }),
	productSymptomId: integer("product_symptom_id"),
	productSymptomOther: varchar("product_symptom_other", { length: 200 }),
	productEquipment: varchar("product_equipment", { length: 100 }),
	productFault: varchar("product_fault", { length: 100 }),
	estimateCost: numeric("estimate_cost", { precision: 18, scale:  2 }),
	depositCost: numeric("deposit_cost", { precision: 18, scale:  2 }),
	sparePartTotalCost: numeric("spare_part_total_cost", { precision: 18, scale:  2 }),
	serviceCost: numeric("service_cost", { precision: 18, scale:  2 }),
	serviceToolCost: numeric("service_tool_cost", { precision: 18, scale:  2 }),
	deliveryCost: numeric("delivery_cost", { precision: 18, scale:  2 }),
	cartonBoxCost: numeric("carton_box_cost", { precision: 18, scale:  2 }),
	jobTotalCost: numeric("job_total_cost", { precision: 18, scale:  2 }),
	jobReferenceNo: varchar("job_reference_no", { length: 50 }),
	jobReferenceNoGspn: varchar("job_reference_no_gspn", { length: 50 }),
	jobGspnCreateDate: timestamp("job_gspn_create_date", { mode: 'string' }),
	jobRemark: text("job_remark"),
	engineerId: integer("engineer_id"),
	engineerSymptomId: integer("engineer_symptom_id"),
	engineerRepairDetail: varchar("engineer_repair_detail", { length: 200 }),
	engineerRemark: varchar("engineer_remark", { length: 200 }),
	jobPaymentType: varchar("job_payment_type", { length: 50 }),
	jobPaymentNo: varchar("job_payment_no", { length: 50 }),
	jobPaymentAmount: numeric("job_payment_amount", { precision: 18, scale:  2 }),
	jobPaymentDetail: varchar("job_payment_detail", { length: 100 }),
	jobReturnDate: timestamp("job_return_date", { mode: 'string' }),
	returnCustomerType: varchar("return_customer_type", { length: 50 }),
	returnCustomerTrackingNo: varchar("return_customer_tracking_no", { length: 50 }),
	returnCustomerDetail: varchar("return_customer_detail", { length: 100 }),
	jobReturnBy: integer("job_return_by"),
	sparePartReplace: varchar("spare_part_replace", { length: 300 }),
	productWarranty: varchar("product_warranty", { length: 50 }),
	quotationNoApproved: varchar("quotation_no_approved", { length: 50 }),
	productSaleOutChannel: varchar("product_sale_out_channel", { length: 50 }),
	productSaleOrderDate: date("product_sale_order_date"),
	productWarrantyMonth: integer("product_warranty_month"),
	productExpireDate: date("product_expire_date"),
	jobReceptionType: varchar("job_reception_type", { length: 50 }),
	jobReceptionDate: date("job_reception_date"),
	jobReceptionTrackingNo: varchar("job_reception_tracking_no", { length: 50 }),
	jobReceptionShipper: varchar("job_reception_shipper", { length: 50 }),
	swapRefundDetail: text("swap_refund_detail"),
	jobPaymentSlipFileName: varchar("job_payment_slip_file_name", { length: 100 }),
	swapRefundDocumentNo: varchar("swap_refund_document_no", { length: 100 }),
	isJobBounce: boolean("is_job_bounce"),
	// public customer tracking link (drizzle/0012) — /t/<track_token>
	trackToken: varchar("track_token", { length: 43 }),
	trackTokenAt: timestamp("track_token_at", { mode: "string" }),
	productSaleOutShopName: varchar("product_sale_out_shop_name", { length: 100 }),
});

export const jobCallLog = pgTable("job_call_log", {
	jobCallLogId: integer("job_call_log_id").primaryKey().generatedByDefaultAsIdentity(),
	jobNo: varchar("job_no", { length: 50 }),
	callLogDescription: varchar("call_log_description", { length: 200 }),
	callLogDate: timestamp("call_log_date", { mode: 'string' }),
	callLogBy: integer("call_log_by"),
});

export const jobCloseTemp = pgTable("job_close_temp", {
	id: integer().primaryKey().generatedByDefaultAsIdentity(),
	serialNo: varchar("serial_no", { length: 50 }),
	isCanCloseJob: boolean("is_can_close_job"),
	refJobNo: varchar("ref_job_no", { length: 50 }),
	nextStatusId: integer("next_status_id"),
	remark: varchar({ length: 50 }),
});

export const jobCreateTemp = pgTable("job_create_temp", {
	id: integer().primaryKey().generatedByDefaultAsIdentity(),
	productImeiNo: varchar("product_imei_no", { length: 50 }),
	lotNo: varchar("lot_no", { length: 50 }),
	modelCode: varchar("model_code", { length: 50 }),
	warranty: varchar({ length: 50 }),
	isCanGenerateJob: boolean("is_can_generate_job"),
	remark: varchar({ length: 200 }),
	productSerial: varchar("product_serial", { length: 50 }),
	productModelDetail: varchar("product_model_detail", { length: 50 }),
	jobReferenceNoGspn: varchar("job_reference_no_gspn", { length: 50 }),
});

export const jobLog = pgTable("job_log", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	jobLogId: bigint("job_log_id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
	jobNo: varchar("job_no", { length: 50 }),
	jobStatusId: integer("job_status_id"),
	jobLogDate: timestamp("job_log_date", { mode: 'string' }),
	jobActionBy: integer("job_action_by"),
});

export const jobOrderSparePartLog = pgTable("job_order_spare_part_log", {
	jobOrderLogId: integer("job_order_log_id").primaryKey().generatedByDefaultAsIdentity(),
	jobNo: varchar("job_no", { length: 50 }),
	sparePartCode: varchar("spare_part_code", { length: 50 }),
	sparePartUnitPrice: numeric("spare_part_unit_price", { precision: 18, scale:  2 }),
	sparePartSerialNo: varchar("spare_part_serial_no", { length: 50 }),
	stockId: integer("stock_id"),
	isQuotation: boolean("is_quotation"),
	isSpecial: boolean("is_special"),
	requestQty: integer("request_qty"),
	sparePartTotalPrice: numeric("spare_part_total_price", { precision: 18, scale:  2 }),
	isQuotationB: boolean("is_quotation_b"),
	isSpecialB: boolean("is_special_b"),
	requestQtyB: integer("request_qty_b"),
	sparePartTotalPriceB: numeric("spare_part_total_price_b", { precision: 18, scale:  2 }),
	orderStatusId: integer("order_status_id"),
	requestDate: timestamp("request_date", { mode: 'string' }),
	requestBy: integer("request_by"),
	grantQty: integer("grant_qty"),
	grantDate: timestamp("grant_date", { mode: 'string' }),
	grantBy: integer("grant_by"),
	returnQty: integer("return_qty"),
	returnDate: timestamp("return_date", { mode: 'string' }),
	returnBy: integer("return_by"),
	returnStockId: integer("return_stock_id"),
}, (table) => [
	index("ix_job_no").using("btree", table.jobNo.asc().nullsLast().op("text_ops")),
]);

export const jobOrderSparePartStatus = pgTable("job_order_spare_part_status", {
	orderStatusId: integer("order_status_id").primaryKey().notNull(),
	orderStatusName: varchar("order_status_name", { length: 50 }),
	orderStatusDescription: varchar("order_status_description", { length: 50 }),
});

export const jobReturnDt = pgTable("job_return_dt", {
	jobReturnDtId: integer("job_return_dt_id").primaryKey().generatedByDefaultAsIdentity(),
	returnNo: varchar("return_no", { length: 50 }),
	itemNo: varchar("item_no", { length: 50 }),
	endUserName: varchar("end_user_name", { length: 100 }),
	referenceJobNo: varchar("reference_job_no", { length: 50 }),
	productModelName: varchar("product_model_name", { length: 50 }),
	productSerialNo: varchar("product_serial_no", { length: 50 }),
	equipmentReturn: varchar("equipment_return", { length: 100 }),
});

export const jobReturnHd = pgTable("job_return_hd", {
	jobReturnId: integer("job_return_id").primaryKey().generatedByDefaultAsIdentity(),
	returnDate: timestamp("return_date", { mode: 'string' }),
	returnCustomerName: varchar("return_customer_name", { length: 100 }),
	originalFileName: varchar("original_file_name", { length: 50 }),
	systemFileName: varchar("system_file_name", { length: 50 }),
	createDate: timestamp("create_date", { mode: 'string' }),
	createBy: integer("create_by"),
	returnCustomerCode: varchar("return_customer_code", { length: 50 }),
	returnNo: varchar("return_no", { length: 50 }),
	imageFileName: varchar("image_file_name", { length: 50 }),
});

export const jobSendForwardDt = pgTable("job_send_forward_dt", {
	id: integer().primaryKey().generatedByDefaultAsIdentity(),
	jobNo: varchar("job_no", { length: 50 }),
	sendToName: varchar("send_to_name", { length: 50 }),
	sendDetail: varchar("send_detail", { length: 100 }),
	sendDate: timestamp("send_date", { mode: 'string' }),
	sendBy: integer("send_by"),
	receiveDate: timestamp("receive_date", { mode: 'string' }),
	receiveBy: integer("receive_by"),
	receiveDetail: varchar("receive_detail", { length: 100 }),
	sendStatus: varchar("send_status", { length: 50 }),
});

export const jobServiceCode = pgTable("job_service_code", {
	serviceCode: varchar("service_code", { length: 50 }).primaryKey().notNull(),
	serviceName: varchar("service_name", { length: 50 }),
	serviceDescription: varchar("service_description", { length: 50 }),
});

export const jobStatus = pgTable("job_status", {
	jobStatusId: integer("job_status_id").primaryKey().notNull(),
	jobStatusName: varchar("job_status_name", { length: 100 }),
	displayOrder: integer("display_order"),
	jobStatusGroup: varchar("job_status_group", { length: 50 }),
	isActive: boolean("is_active"),
});

export const jobType = pgTable("job_type", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	jobTypeId: integer("job_type_id").primaryKey().generatedByDefaultAsIdentity(),
	jobTypeName: varchar("job_type_name", { length: 50 }),
	jobTypeDescription: varchar("job_type_description", { length: 100 }),
	isActive: boolean("is_active"),
}, (table) => [
	uniqueIndex("ix_job_type_name").using("btree", table.jobTypeName.asc().nullsLast().op("text_ops")),
]);

export const manufacturer = pgTable("manufacturer", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	manufacturerId: integer("manufacturer_id").primaryKey().generatedByDefaultAsIdentity(),
	manufacturerName: varchar("manufacturer_name", { length: 50 }),
	logoName: varchar("logo_name", { length: 50 }),
	isActive: boolean("is_active"),
}, (table) => [
	uniqueIndex("ix_manufacturer_name").using("btree", table.manufacturerName.asc().nullsLast().op("text_ops")),
]);

export const model = pgTable("model", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	modelId: integer("model_id").primaryKey().generatedByDefaultAsIdentity(),
	modelCode: varchar("model_code", { length: 50 }),
	modelName: varchar("model_name", { length: 50 }),
	marketPrice: numeric("market_price", { precision: 18, scale:  2 }),
	manufacturerId: integer("manufacturer_id"),
	isActive: boolean("is_active"),
	tierId: integer("tier_id"),
	lastUpdate: timestamp("last_update", { mode: 'string' }),
}, (table) => [
	uniqueIndex("ix_unique_model").using("btree", table.modelName.asc().nullsLast().op("int4_ops"), table.manufacturerId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
]);

export const modelColor = pgTable("model_color", {
	itemId: integer("item_id").primaryKey().generatedByDefaultAsIdentity(),
	modelName: varchar("model_name", { length: 50 }),
	colorName: varchar("color_name", { length: 100 }),
	defaultColor: varchar("default_color", { length: 50 }),
	extenFileName: varchar("exten_file_name", { length: 50 }),
	isActive: boolean("is_active"),
});

export const modelPart = pgTable("model_part", {
	itemPriceId: integer("item_price_id").primaryKey().generatedByDefaultAsIdentity(),
	modelItemId: integer("model_item_id"),
	color: varchar({ length: 50 }),
	partName: varchar("part_name", { length: 50 }),
	price: numeric({ precision: 18, scale:  2 }),
	service: numeric({ precision: 18, scale:  2 }),
	remark: varchar({ length: 50 }),
});

export const productModel = pgTable("product_model", {
	productModelId: integer("product_model_id").primaryKey().generatedByDefaultAsIdentity(),
	productId: integer("product_id"),
	modelCode: varchar("model_code", { length: 50 }),
});

export const productType = pgTable("product_type", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	productTypeId: integer("product_type_id").primaryKey().generatedByDefaultAsIdentity(),
	productTypeName: varchar("product_type_name", { length: 50 }),
	// added by this app (drizzle/0005_product_type_description.sql)
	productTypeDescription: varchar("product_type_description", { length: 100 }).notNull().default(""),
	isActive: boolean("is_active"),
}, (table) => [
	uniqueIndex("ix_product_type_name").using("btree", table.productTypeName.asc().nullsLast().op("text_ops")),
]);

export const quotationDt = pgTable("quotation_dt", {
	quotationDtId: integer("quotation_dt_id").primaryKey().generatedByDefaultAsIdentity(),
	quotationNo: varchar("quotation_no", { length: 50 }),
	lineNumber: integer("line_number"),
	itemType: varchar("item_type", { length: 50 }),
	itemCode: varchar("item_code", { length: 50 }),
	itemDetail: varchar("item_detail", { length: 100 }),
	quantity: varchar({ length: 10 }),
	unit: varchar({ length: 10 }),
	unitPrice: varchar("unit_price", { length: 20 }),
	unitPriceDiscount: varchar("unit_price_discount", { length: 20 }),
	totalPrice: varchar("total_price", { length: 20 }),
	unitPriceDiscountPercent: varchar("unit_price_discount_percent", { length: 20 }),
}, (table) => [
	index("ix_quotation_dt_quotation_no").using("btree", table.quotationNo.asc().nullsLast().op("text_ops")),
]);

export const quotationHd = pgTable("quotation_hd", {
	// --- issuing profile added by this app (drizzle/0007_document_profile.sql); NULL = SHD ---
	documentProfileId: integer("document_profile_id"),
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	quotationHdId: integer("quotation_hd_id").primaryKey().generatedByDefaultAsIdentity(),
	quotationNo: varchar("quotation_no", { length: 50 }),
	customerCode: varchar("customer_code", { length: 50 }),
	customerContactName: varchar("customer_contact_name", { length: 100 }),
	createDate: timestamp("create_date", { mode: 'string' }),
	createBy: integer("create_by"),
	sparePartAmount: numeric("spare_part_amount", { precision: 19, scale:  4 }),
	serviceAmount: numeric("service_amount", { precision: 19, scale:  4 }),
	sumExcludeAmount: numeric("sum_exclude_amount", { precision: 19, scale:  4 }),
	discountType: varchar("discount_type", { length: 50 }),
	discountFormula: varchar("discount_formula", { length: 100 }),
	discountAmount: numeric("discount_amount", { precision: 19, scale:  4 }),
	afterDiscountAmount: numeric("after_discount_amount", { precision: 19, scale:  4 }),
	totalBaseAmount: numeric("total_base_amount", { precision: 19, scale:  4 }),
	vatRate: doublePrecision("vat_rate"),
	vatAmount: numeric("vat_amount", { precision: 19, scale:  4 }),
	totalAmount: numeric("total_amount", { precision: 19, scale:  4 }),
	roundingAmount: numeric("rounding_amount", { precision: 19, scale:  4 }),
	netAmount: numeric("net_amount", { precision: 19, scale:  4 }),
	remark: text(),
	referenceJobNo: varchar("reference_job_no", { length: 50 }),
	quotationStatusId: integer("quotation_status_id"),
	customerApproveDate: timestamp("customer_approve_date", { mode: 'string' }),
	customerApproveRemark: varchar("customer_approve_remark", { length: 100 }),
	isActive: boolean("is_active"),
	quotationType: varchar("quotation_type", { length: 50 }),
}, (table) => [
	index("ix_quotation_hd_create_date").using("btree", table.createDate.asc().nullsLast().op("timestamp_ops")),
	index("ix_quotation_hd_customer_code").using("btree", table.customerCode.asc().nullsLast().op("text_ops")),
	index("ix_quotation_hd_reference_job_no").using("btree", table.referenceJobNo.asc().nullsLast().op("text_ops")),
]);

export const quotationStatus = pgTable("quotation_status", {
	quotationStatusId: integer("quotation_status_id").primaryKey().notNull(),
	quotationStatusName: varchar("quotation_status_name", { length: 50 }).notNull(),
});

export const quotationTemp = pgTable("quotation_temp", {
	quotationNo: varchar("quotation_no", { length: 50 }).primaryKey().notNull(),
	isCanEdit: boolean("is_can_edit"),
});

export const runningNo = pgTable("running_no", {
	runningId: integer("running_id").primaryKey().generatedByDefaultAsIdentity(),
	runningType: varchar("running_type", { length: 50 }).notNull(),
	companyId: integer("company_id").notNull(),
	branchId: integer("branch_id").notNull(),
	prefix: varchar({ length: 10 }).notNull(),
	pyear: integer().notNull(),
	pmonth: integer().notNull(),
	pday: integer().notNull(),
	number: integer().notNull(),
	lengthYear: integer("length_year").notNull(),
	lengthMonth: integer("length_month").notNull(),
	lengthNumber: integer("length_number").notNull(),
});

export const saleInDt = pgTable("sale_in_dt", {
	saleInDtId: integer("sale_in_dt_id").primaryKey().generatedByDefaultAsIdentity(),
	saleInHdNo: varchar("sale_in_hd_no", { length: 50 }),
	listNo: integer("list_no"),
	productId: integer("product_id"),
	storeLocationId: integer("store_location_id"),
	conditionId: integer("condition_id"),
	serialNo: varchar("serial_no", { length: 50 }),
	quantityAtCurrent: integer("quantity_at_current"),
	quantityIncome: integer("quantity_income"),
	capitalPrice: numeric("capital_price", { precision: 18, scale:  2 }),
	wholesalePrice: numeric("wholesale_price", { precision: 18, scale:  2 }),
	retailPrice: numeric("retail_price", { precision: 18, scale:  2 }),
	remark: varchar({ length: 100 }),
});

export const saleInHd = pgTable("sale_in_hd", {
	saleInHdId: integer("sale_in_hd_id").primaryKey().generatedByDefaultAsIdentity(),
	saleInHdNo: varchar("sale_in_hd_no", { length: 50 }),
	saleInType: varchar("sale_in_type", { length: 50 }),
	saleInDate: timestamp("sale_in_date", { mode: 'string' }),
	saleInBy: integer("sale_in_by"),
});

export const saleOutHd = pgTable("sale_out_hd", {
	// --- issuing profile added by this app (drizzle/0007_document_profile.sql); NULL = SHD ---
	documentProfileId: integer("document_profile_id"),
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	saleOutHdId: integer("sale_out_hd_id").primaryKey().generatedByDefaultAsIdentity(),
	saleOutHdNo: varchar("sale_out_hd_no", { length: 50 }),
	documentType: varchar("document_type", { length: 50 }),
	documentCreateDate: timestamp("document_create_date", { mode: 'string' }),
	documentCreateBy: integer("document_create_by"),
	documentStatus: boolean("document_status"),
	documentCreditNoteNo: varchar("document_credit_note_no", { length: 100 }),
	documentCancelDate: timestamp("document_cancel_date", { mode: 'string' }),
	documentCancelBy: integer("document_cancel_by"),
	documentCancelRemark: varchar("document_cancel_remark", { length: 100 }),
	customerId: integer("customer_id"),
	customerCode: varchar("customer_code", { length: 50 }),
	customerCardId: varchar("customer_card_id", { length: 50 }),
	customerName: varchar("customer_name", { length: 200 }),
	customerAddress: varchar("customer_address", { length: 500 }),
	customerPhoneNumber: varchar("customer_phone_number", { length: 50 }),
	customerFaxNumber: varchar("customer_fax_number", { length: 50 }),
	totalBaseAmount: numeric("total_base_amount", { precision: 18, scale:  2 }),
	vatRat: numeric("vat_rat", { precision: 18, scale:  2 }),
	vatAmount: numeric("vat_amount", { precision: 18, scale:  2 }),
	totalAmount: numeric("total_amount", { precision: 18, scale:  2 }),
	roundingAmount: numeric("rounding_amount", { precision: 18, scale:  2 }),
	feeAmount: numeric("fee_amount", { precision: 18, scale:  2 }),
	netAmount: numeric("net_amount", { precision: 18, scale:  2 }),
	remarkHd: varchar("remark_hd", { length: 100 }),
	isSaleOut: boolean("is_sale_out"),
	saleOutDate: timestamp("sale_out_date", { mode: 'string' }),
	saleOutBy: integer("sale_out_by"),
	referenceNo: varchar("reference_no", { length: 50 }),
	paymentType: varchar("payment_type", { length: 50 }),
	paymentAmount: numeric("payment_amount", { precision: 11, scale:  2 }),
	slipFileName: varchar("slip_file_name", { length: 100 }),
	approveStatusId: integer("approve_status_id"),
	approveDate: timestamp("approve_date", { mode: 'string' }),
	approveBy: integer("approve_by"),
	approveRemark: varchar("approve_remark", { length: 100 }),
	deliveryTrackingNo: varchar("delivery_tracking_no", { length: 50 }),
	deliveryDate: timestamp("delivery_date", { mode: 'string' }),
});

export const serviceCost = pgTable("service_cost", {
	serviceCode: varchar("service_code", { length: 50 }).primaryKey().notNull(),
	serviceDescription: varchar("service_description", { length: 100 }),
	serviceCost: numeric("service_cost", { precision: 18, scale:  2 }),
});

export const storeLocation = pgTable("store_location", {
	storeLocationId: integer("store_location_id").primaryKey().generatedByDefaultAsIdentity(),
	storeLocationName: varchar("store_location_name", { length: 50 }),
	storeLocationDescription: varchar("store_location_description", { length: 50 }),
	storeLocationGroup: varchar("store_location_group", { length: 50 }),
	isActive: boolean("is_active"),
}, (table) => [
	uniqueIndex("ix_store_location_name").using("btree", table.storeLocationName.asc().nullsLast().op("text_ops")),
]);

export const symptom = pgTable("symptom", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	symptomId: integer("symptom_id").primaryKey().generatedByDefaultAsIdentity(),
	symptomName: varchar("symptom_name", { length: 50 }),
	symptomDescription: varchar("symptom_description", { length: 100 }),
	symptomGroupName: varchar("symptom_group_name", { length: 50 }),
	isActive: boolean("is_active"),
});

export const tempModel = pgTable("temp_model", {
	id: integer(),
	modelName: varchar("model_name", { length: 50 }),
	modelCode: varchar("model_code", { length: 50 }),
	marketPrice: numeric("market_price", { precision: 18, scale:  2 }),
});

export const tempSparePart = pgTable("temp_spare_part", {
	itemId: integer("item_id"),
	productVenderCode: varchar("product_vender_code", { length: 50 }),
	sparePartNameTh: varchar("spare_part_name_th", { length: 100 }),
	sparePartNameEn: varchar("spare_part_name_en", { length: 100 }),
	sparePartNameCn: varchar("spare_part_name_cn", { length: 100 }),
	sparePartDescription: varchar("spare_part_description", { length: 200 }),
	manufacturerName: varchar("manufacturer_name", { length: 50 }),
	quantityRemain: integer("quantity_remain"),
	capitalPrice: numeric("capital_price", { precision: 18, scale:  2 }),
	retailPrice: numeric("retail_price", { precision: 18, scale:  2 }),
});

export const appUser = pgTable("app_user", {
	// --- soft-delete status added by this app (drizzle/0003_record_status.sql) ---
	recordStatus: varchar("record_status", { length: 10 }).notNull().default("ACTIVE"),
	statusChangedAt: timestamp("status_changed_at", { mode: "string" }),
	statusChangedBy: integer("status_changed_by"),
	userId: integer("user_id").primaryKey().generatedByDefaultAsIdentity(),
	username: varchar({ length: 50 }),
	password: varchar({ length: 50 }),
	firstName: varchar("first_name", { length: 50 }),
	lastName: varchar("last_name", { length: 50 }),
	userType: varchar("user_type", { length: 50 }),
	isActive: boolean("is_active"),
	phoneNo: varchar("phone_no", { length: 50 }),
	emailAddress: varchar("email_address", { length: 100 }),
	ascCode: varchar("asc_code", { length: 50 }),
	ascName: varchar("asc_name", { length: 50 }),
	// --- columns added by this app (drizzle/0001_app.sql) — SSO profile ---
	larkId: varchar("lark_id", { length: 50 }),
	department: varchar({ length: 100 }),
	title: varchar({ length: 100 }),
	avatar: text(),
	lastLogin: timestamp("last_login", { mode: "string" }),
	deleted: boolean().notNull().default(false),
}, (table) => [
	uniqueIndex("ix_username_and_password").using("btree", table.username.asc().nullsLast().op("text_ops"), table.password.asc().nullsLast().op("text_ops")),
]);
export const viewCustomer = pgView("view_customer", {	customerId: integer("customer_id"),
	customerCode: varchar("customer_code", { length: 50 }),
	customerCardId: varchar("customer_card_id", { length: 20 }),
	customerName: varchar("customer_name", { length: 200 }),
	customerAddress: varchar("customer_address", { length: 200 }),
	customerAddress1: varchar("customer_address1", { length: 100 }),
	customerAddress2: varchar("customer_address2", { length: 100 }),
	postalCode: varchar("postal_code", { length: 5 }),
	phoneNumber: varchar("phone_number", { length: 50 }),
	faxNumber: varchar("fax_number", { length: 50 }),
	email: varchar({ length: 50 }),
	customerType: varchar("customer_type", { length: 50 }),
	createdDate: timestamp("created_date", { mode: 'string' }),
	createBy: integer("create_by"),
	isActive: boolean("is_active"),
	usePriceGroup: varchar("use_price_group", { length: 50 }),
	lineId: varchar("line_id", { length: 50 }),
	isCustomerOnline: boolean("is_customer_online"),
	cityId: integer("city_id"),
	districtId: integer("district_id"),
	subDistrictId: integer("sub_district_id"),
	provinceName: text("province_name"),
	ampherName: text("ampher_name"),
	tambonName: text("tambon_name"),
}).as(sql`SELECT c.customer_id, c.customer_code, c.customer_card_id, c.customer_name, c.customer_address, c.customer_address1, c.customer_address2, c.postal_code, c.phone_number, c.fax_number, c.email, c.customer_type, c.created_date, c.create_by, c.is_active, c.use_price_group, c.line_id, c.is_customer_online, c.city_id, c.district_id, c.sub_district_id, CASE WHEN c.city_id = 10 THEN p.name_th::text ELSE 'จ.'::text || p.name_th::text END AS province_name, CASE WHEN c.city_id = 10 THEN d.name_th::text ELSE 'อ.'::text || d.name_th::text END AS ampher_name, CASE WHEN c.city_id = 10 THEN sd.name_th::text ELSE 'ต.'::text || sd.name_th::text END AS tambon_name FROM customer c LEFT JOIN mt_city p ON p.city_id = c.city_id LEFT JOIN mt_district d ON d.city_id = c.city_id AND d.district_id = c.district_id LEFT JOIN mt_sub_district sd ON sd.city_id = c.city_id AND sd.district_id = c.district_id AND sd.sub_district_id = c.sub_district_id`);
// --- tables added by this app (see drizzle/0002_job_symptom.sql) ---
export const jobSymptom = pgTable("job_symptom", {
	jobNo: varchar("job_no", { length: 50 }).notNull(),
	symptomId: integer("symptom_id").notNull(),
}, (table) => [
	primaryKey({ columns: [table.jobNo, table.symptomId] }),
	index("ix_job_symptom_symptom").using("btree", table.symptomId.asc().nullsLast().op("int4_ops")),
]);

export const recordStatus = pgTable("record_status", {
	code: varchar({ length: 10 }).primaryKey().notNull(),
	nameTh: varchar("name_th", { length: 50 }).notNull(),
	nameEn: varchar("name_en", { length: 50 }).notNull(),
	sortOrder: integer("sort_order").notNull(),
});

/** Application audit trail (drizzle/0006_audit_log.sql) — append-only, one row per write. */
export const auditLog = pgTable("audit_log", {
	id: bigserial("id", { mode: "number" }).primaryKey().notNull(),
	at: timestamp("at", { mode: "string" }).notNull(),
	userId: integer("user_id").notNull().default(0),
	userName: varchar("user_name", { length: 100 }).notNull().default(""),
	action: varchar("action", { length: 20 }).notNull(),
	module: varchar("module", { length: 50 }).notNull().default(""),
	entity: varchar("entity", { length: 50 }).notNull(),
	entityKey: varchar("entity_key", { length: 100 }).notNull().default(""),
	summary: varchar("summary", { length: 200 }).notNull().default(""),
	changes: jsonb("changes"),
	meta: jsonb("meta"),
}, (table) => [
	index("ix_audit_log_entity").using("btree", table.entity.asc(), table.entityKey.asc(), table.at.desc()),
	index("ix_audit_log_user").using("btree", table.userId.asc(), table.at.desc()),
	index("ix_audit_log_at").using("btree", table.at.desc()),
	index("ix_audit_log_module").using("btree", table.module.asc(), table.at.desc()),
]);

// --- document_profile (drizzle/0007_document_profile.sql) — "ออกเอกสารในนาม" ---
export const documentProfile = pgTable("document_profile", {
	id: serial("id").primaryKey().notNull(),
	code: varchar("code", { length: 20 }).notNull(),
	nameTh: varchar("name_th", { length: 200 }).notNull(),
	nameEn: varchar("name_en", { length: 200 }).notNull().default(""),
	addressLine1: varchar("address_line1", { length: 200 }).notNull().default(""),
	addressLine2: varchar("address_line2", { length: 200 }).notNull().default(""),
	phone: varchar("phone", { length: 50 }).notNull().default(""),
	email: varchar("email", { length: 100 }).notNull().default(""),
	taxId: varchar("tax_id", { length: 20 }).notNull().default(""),
	bankName: varchar("bank_name", { length: 100 }).notNull().default(""),
	bankAccountType: varchar("bank_account_type", { length: 50 }).notNull().default(""),
	bankAccountNo: varchar("bank_account_no", { length: 50 }).notNull().default(""),
	bankAccountName: varchar("bank_account_name", { length: 200 }).notNull().default(""),
	logoPath: varchar("logo_path", { length: 200 }).notNull().default(""),
	stampPath: varchar("stamp_path", { length: 200 }).notNull().default(""),
	prefixJob: varchar("prefix_job", { length: 10 }).notNull(),
	prefixQuotation: varchar("prefix_quotation", { length: 10 }).notNull(),
	prefixSaleOrder: varchar("prefix_sale_order", { length: 10 }).notNull(),
	isDefault: boolean("is_default").notNull().default(false),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
	// soft delete (drizzle/0009): hidden from lists/dropdowns, still printable for old documents
	deletedAt: timestamp("deleted_at", { mode: "string" }),
	deletedBy: integer("deleted_by"),
});
