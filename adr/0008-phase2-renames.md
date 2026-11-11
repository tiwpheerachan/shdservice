# ADR 0008 phase 2 — drizzle property renames (S2)

The codemod source for S3–S8. `src/db/schema/**` after drizzle/0006: every table's first property is `pk`
(bigint identity ALWAYS, TS `number`, never sent to the API), second is `id` (uuid). Every `*Pk` property is a
`bigint` (TS `number`) relation to `<table>.pk`; nullable unless marked **NN**. Export (table) names are unchanged
except `viewCustomer` (removed) and `legacyOrphanRef` (new).

Rules of thumb:
- a former int key keeps its value: `appUser.userId` 105 → `appUser.pk` 105; int relations to it keep their values.
- a former **text** relation (`jobNo`, `quotationNo`, `customerCode`, `saleOutHdNo`, `inventoryNo`, `itemCode`, …) is
  now the parent's `pk` — join `parent.pk = child.parentPk`, and look the pk up by the business number when the
  caller only has the number (`job.jobNo`, `quotationHd.quotationNo` … stay on their own table, UNIQUE).
- `job.pk` is **not** the job number (decision 8). Keep using `job.jobNo` for anything shown or typed.
- code tables (decision 5) keep their code column as the FK target, unchanged: `jobStatusId`, `quotationStatusId`,
  `approveStatusId`, `orderStatusId`, `inventoryTypeId`, `storeLocationId`, `conditionId`, `recordStatus`
  (also `jobOrderSparePartLog.stockId` / `returnStockId`, `jobCloseTemp.nextStatusId`); those tables gained `pk`.
- writes of a placeholder (`0`, `-1`, `''`) into a `*Pk` → `null` (FK).
- `pk` is `GENERATED ALWAYS`: drizzle inserts can't set it; raw SQL that must uses `OVERRIDING SYSTEM VALUE`.

| table (export) | old property | new property | note |
|---|---|---|---|
| appUser | userId | pk | |
| appUser, category, color, customer, documentAttach, job, jobType, manufacturer, model, product, productType, quotationHd, saleOutHd, symptom | statusChangedBy | statusChangedByAppUserPk | |
| appBackUpDbLog | backUpBy | backedUpByAppUserPk | |
| appConfig | configId | pk | |
| appUserTour | userId | appUserPk | NN UNIQUE (upsert target); `pk` is new |
| auditLog | userId | appUserPk | nullable, no default: system = `null` (was 0) |
| category | categoryId | pk | |
| customer | customerId | pk | |
| customer | createBy | createdByAppUserPk | |
| customer | cityId | mtCityPk | -1 → null |
| customer | districtId | mtDistrictPk | -1 → null |
| customer | subDistrictId | mtSubDistrictPk | -1 → null |
| documentAttach | documentAttachId | pk | |
| documentAttach | referenceItemCode | jobPk | NN; was the job_no |
| documentAttach | referenceTopic | — | dropped |
| documentProfile, shippingProfile | deletedBy | deletedByAppUserPk | |
| inventoryDt | inventoryDtId | pk | |
| inventoryDt | inventoryNo | inventoryHdPk | NN |
| inventoryDt | itemCode | productPk | |
| inventoryDt | receiveInventoryNo | receiveInventoryHdPk | `''` → null |
| inventoryHd | inventoryHdId | pk | |
| inventoryHd | referenceDocumentNo | jobPk + saleOutHdPk | decision 11 |
| inventoryHd | — | poNo | new: the receive form's PO no. (free text, NOT NULL default '') |
| inventoryHd | createBy | createdByAppUserPk | |
| job | — | pk | new; NOT the job number |
| job | customerId | customerPk | |
| job | jobCreateBy | createdByAppUserPk | |
| job | jobTypeId | jobTypePk | |
| job | jobRepairedBy | repairedByAppUserPk | |
| job | jobClosedBy | closedByAppUserPk | |
| job | productTypeId | productTypePk | |
| job | productBrandId | brandManufacturerPk | |
| job | productModelId | modelPk | |
| job | productSymptomId | reportedSymptomPk | |
| job | engineerId | engineerAppUserPk | |
| job | engineerSymptomId | engineerSymptomPk | |
| job | jobReturnBy | returnedByAppUserPk | |
| job | quotationNoApproved | approvedQuotationHdPk | |
| job | documentProfileId | documentProfilePk | |
| job | returnShipperId | returnShippingProfilePk | |
| jobCallLog | jobCallLogId | pk | |
| jobCallLog | jobNo | jobPk | NN |
| jobCallLog | callLogBy | calledByAppUserPk | |
| jobCloseTemp | refJobNo | refJobPk | unused table |
| jobCreateTemp | modelCode | modelPk | unused table |
| jobLog | jobLogId | pk | |
| jobLog | jobNo | jobPk | NN |
| jobLog | jobActionBy | actionByAppUserPk | |
| jobOrderSparePartLog | jobOrderLogId | pk | |
| jobOrderSparePartLog | jobNo | jobPk | NN |
| jobOrderSparePartLog | sparePartCode | productPk | |
| jobOrderSparePartLog | requestBy | requestedByAppUserPk | |
| jobOrderSparePartLog | grantBy | grantedByAppUserPk | |
| jobOrderSparePartLog | returnBy | returnedByAppUserPk | |
| jobReturnDt | jobReturnDtId | pk | unused table |
| jobReturnDt | returnNo | jobReturnHdPk | |
| jobReturnDt | referenceJobNo | jobPk | |
| jobReturnHd | jobReturnId | pk | unused table; `returnNo` stays (UNIQUE) |
| jobReturnHd | createBy | createdByAppUserPk | |
| jobReturnHd | returnCustomerCode | returnCustomerPk | |
| jobSendForwardDt | jobNo | jobPk | NN |
| jobSendForwardDt | sendBy | sentByAppUserPk | |
| jobSendForwardDt | receiveBy | receivedByAppUserPk | |
| jobSymptom | jobNo | jobPk | NN; UNIQUE (jobPk, symptomPk); `pk` is new |
| jobSymptom | symptomId | symptomPk | NN |
| jobType | jobTypeId | pk | |
| manufacturer | manufacturerId | pk | |
| model | modelId | pk | |
| model | manufacturerId | manufacturerPk | |
| model | tierId | modelTierPk | 0 → null |
| modelColor | itemId | pk | unused table |
| modelPart | itemPriceId | pk | unused table; `modelItemId` kept as is |
| modelTier | tierId | pk | |
| mtCity | cityId | pk | |
| mtDistrict | districtId | pk | |
| mtDistrict, mtSubDistrict | cityId | mtCityPk | |
| mtSubDistrict | subDistrictId | pk | |
| mtSubDistrict | districtId | mtDistrictPk | |
| product | productId | pk | |
| product | categoryId | categoryPk | |
| product | manufacturerId | manufacturerPk | |
| product, productSerial | createBy | createdByAppUserPk | |
| product, productSerial | cancelBy | cancelledByAppUserPk | |
| productModel | productModelId | pk | |
| productModel | productId | productPk | |
| productModel | modelCode | modelPk | |
| productNoneSerial, productSerial | itemId | pk | |
| productNoneSerial, productSerial | productId | productPk | |
| productSerial | saleOutHdNo | saleOutHdPk | unused table |
| productType | productTypeId | pk | |
| quotationDt | quotationDtId | pk | |
| quotationDt | quotationNo | quotationHdPk | NN |
| quotationDt | — | productPk | new, beside `itemCode` (kept — printed code) |
| quotationHd | quotationHdId | pk | |
| quotationHd | customerCode | customerPk | |
| quotationHd | createBy | createdByAppUserPk | |
| quotationHd | referenceJobNo | jobPk | |
| quotationHd | documentProfileId | documentProfilePk | |
| quotationTemp | quotationNo | quotationHdPk | unused table |
| runningNo | runningId | pk | |
| saleInDt | saleInDtId | pk | unused table |
| saleInDt | saleInHdNo | saleInHdPk | |
| saleInDt | productId | productPk | |
| saleInHd | saleInHdId | pk | unused table; `saleInHdNo` stays (UNIQUE) |
| saleInHd | saleInBy | saleInByAppUserPk | |
| saleOutDt | saleOutDtId | pk | |
| saleOutDt | saleOutHdNo | saleOutHdPk | NN |
| saleOutDt | productId | productPk | `productCode` kept (printed code) |
| saleOutDt | onhandItemId | productNoneSerialPk | |
| saleOutDt | pickInventoryNo | pickInventoryHdPk | |
| saleOutDt | returnInventoryNo | returnInventoryHdPk | |
| saleOutHd | saleOutHdId | pk | |
| saleOutHd | documentCreateBy | createdByAppUserPk | |
| saleOutHd | documentCancelBy | cancelledByAppUserPk | |
| saleOutHd | customerId | customerPk | |
| saleOutHd | customerCode | — | dropped (use customer.customerCode via customerPk) |
| saleOutHd | saleOutBy | saleOutByAppUserPk | |
| saleOutHd | approveBy | approvedByAppUserPk | |
| saleOutHd | documentProfileId | documentProfilePk | |
| symptom | symptomId | pk | |
| trackTicket | jobNo | jobPk | NN |
| trackDocTicket | jobNo | jobPk | NN |
| trackDocTicket | ref | quotationHdPk / saleOutHdPk | kind 'quotation' → quotationHdPk; 'job' / 'return' = the job (both null) |
| trackOtp, trackSession | customerIds | customerPks | `number[]` (bigint[]) |
| viewCustomer | (export) | — | removed |
| legacyOrphanRef | — | (export) | new: pk, id, tableName, rowPk, columnName, legacyValue |

Tables that only gained `pk` (+ kept every property): approveStatus, color (its `pk` was already there), condition,
documentProfile, shippingProfile, inventoryType, jobOrderSparePartStatus, jobStatus, jobServiceCode, quotationStatus,
recordStatus, serviceCost, storeLocation, tempModel, tempSparePart, trackRate, trackBlock, trackEvent, trackOtp,
trackSession, auditLog, appBackUpDbLog, jobCloseTemp, jobCreateTemp, jobSendForwardDt (their own `pk` → identity).
Former natural keys are UNIQUE now, not the primary key: `trackTicket` / `trackSession` / `trackDocTicket.tokenHash`,
`trackOtp.requestHash`, `trackBlock.key`, `trackRate (bucket, key, windowStart)`, `job.jobNo`, `serviceCost.serviceCode`,
`jobServiceCode.serviceCode`, `recordStatus.code`.

Not in drizzle (raw SQL in `src/server/idempotency.ts`): `idempotency_key.user_id` → `app_user_pk` NN, UNIQUE (app_user_pk, key).

## Final names after drizzle/0006 (2026-10-30: no redundant data + table naming)

Supersedes the table above where they differ. *before* = the name in the drizzle schema S2 wrote (what the services
use today); *after* = the database / drizzle name now. Generated from `scripts/gen-0006.mts` (`GEN_MAP`). Money and
quantity columns are never dropped or changed (owner rule) — only renamed where the name was a typo or a `_hd` / `_dt`
leftover. The 16 unused legacy tables keep their names (dropped after cutover). `legacy_orphan_ref` keeps the LEGACY
table / column names; `audit_log.entity` values of renamed tables are rewritten to the new name, `changes` / `meta` keys stay.

### Tables

| table before | table after | TS export before | TS export after |
|---|---|---|---|
| app_config | **role_permission** | `appConfig` | **`rolePermission`** |
| document_attach | **job_attachment** | `documentAttach` | **`jobAttachment`** |
| inventory_dt | **stock_move_line** | `inventoryDt` | **`stockMoveLine`** |
| inventory_hd | **stock_move** | `inventoryHd` | **`stockMove`** |
| inventory_type | **stock_move_type** | `inventoryType` | **`stockMoveType`** |
| job_log | **job_status_log** | `jobLog` | **`jobStatusLog`** |
| job_order_spare_part_log | **job_part** | `jobOrderSparePartLog` | **`jobPart`** |
| job_order_spare_part_status | **job_part_status** | `jobOrderSparePartStatus` | **`jobPartStatus`** |
| job_send_forward_dt | **job_outsource** | `jobSendForwardDt` | **`jobOutsource`** |
| manufacturer | **brand** | `manufacturer` | **`brand`** |
| mt_city | **province** | `mtCity` | **`province`** |
| mt_district | **district** | `mtDistrict` | **`district`** |
| mt_sub_district | **sub_district** | `mtSubDistrict` | **`subDistrict`** |
| product_model | **product_compatible_model** | `productModel` | **`productCompatibleModel`** |
| product_none_serial | **product_stock** | `productNoneSerial` | **`productStock`** |
| quotation_dt | **quotation_line** | `quotationDt` | **`quotationLine`** |
| quotation_hd | **quotation** | `quotationHd` | **`quotation`** |
| sale_out_dt | **sale_order_line** | `saleOutDt` | **`saleOrderLine`** |
| sale_out_hd | **sale_order** | `saleOutHd` | **`saleOrder`** |
| — | **legacy_boundary** (new) | — | **`legacyBoundary`** |
| — | **security_log** (new: pk, id, at, event, result, actor_pk, actor_name, actor_email, actor_role, actor_department, ip, user_agent, session_id, request_id, module, permission, entity, entity_id, entity_no, detail, row_hash) | — | **`securityLog`** |

### Columns (by the new table name)

| table | column before → after | property before → after |
|---|---|---|
| app_user | password → **dropped** | `password` → — |
| app_user | is_active → **dropped** | `isActive` → — |
| app_user | asc_code → **dropped** | `ascCode` → — |
| app_user | asc_name → **dropped** | `ascName` → — |
| app_user | deleted → **dropped** | `deleted` → — |
| audit_log | app_user_pk → **actor_pk** | `appUserPk` → **`actorPk`** |
| audit_log | user_name → **actor_name** | `userName` → **`actorName`** |
| audit_log | **actor_email** (new: character varying(100)) | — → **`actorEmail`** |
| audit_log | **actor_role** (new: character varying(50)) | — → **`actorRole`** |
| audit_log | **actor_department** (new: character varying(100)) | — → **`actorDepartment`** |
| audit_log | **permission** (new: text) | — → **`permission`** |
| audit_log | **entity_id** (new: uuid) | — → **`entityId`** |
| audit_log | **entity_no** (new: text) | — → **`entityNo`** |
| audit_log | **reason** (new: text) | — → **`reason`** |
| audit_log | **ip** (new: inet) | — → **`ip`** |
| audit_log | **user_agent** (new: text) | — → **`userAgent`** |
| audit_log | **session_id** (new: text) | — → **`sessionId`** |
| audit_log | **request_id** (new: text) | — → **`requestId`** |
| audit_log | **row_hash** (new: bytea) | — → **`rowHash`** |
| brand | manufacturer_name → **brand_name** | `manufacturerName` → **`brandName`** |
| brand | is_active → **dropped** | `isActive` → — |
| category | shot_code → **short_code** | `shotCode` → **`shortCode`** |
| category | is_active → **dropped** | `isActive` → — |
| color | is_active → **dropped** | `isActive` → — |
| customer | is_active → **dropped** | `isActive` → — |
| customer | mt_city_pk → **province_pk** | `mtCityPk` → **`provincePk`** |
| customer | mt_district_pk → **district_pk** | `mtDistrictPk` → **`districtPk`** |
| customer | mt_sub_district_pk → **sub_district_pk** | `mtSubDistrictPk` → **`subDistrictPk`** |
| district | mt_city_pk → **province_pk** | `mtCityPk` → **`provincePk`** |
| job | company_id → **dropped** | `companyId` → — |
| job | branch_id → **dropped** | `branchId` → — |
| job | brand_manufacturer_pk → **dropped** | `brandManufacturerPk` → — |
| job | product_color → **dropped** | `productColor` → — |
| job | job_reference_no_gspn → **dropped** | `jobReferenceNoGspn` → — |
| job | job_gspn_create_date → **dropped** | `jobGspnCreateDate` → — |
| job | approved_quotation_hd_pk → **approved_quotation_pk** | `approvedQuotationHdPk` → **`approvedQuotationPk`** |
| job | track_token → **dropped** | `trackToken` → — |
| job | **new_serial_no** (new: character varying(50)) | — → **`newSerialNo`** |
| job | **reception_shipping_profile_pk** (new: bigint) | — → **`receptionShippingProfilePk`** |
| job_attachment | is_active → **dropped** | `isActive` → — |
| job_outsource | send_status → **dropped** | `sendStatus` → — |
| job_part | spare_part_serial_no → **dropped** | `sparePartSerialNo` → — |
| job_part | stock_id → **dropped** | `stockId` → — |
| job_part | order_status_id → **job_part_status_id** | `orderStatusId` → **`jobPartStatusId`** |
| job_part_status | order_status_id → **job_part_status_id** | `orderStatusId` → **`jobPartStatusId`** |
| job_part_status | order_status_name → **job_part_status_name** | `orderStatusName` → **`jobPartStatusName`** |
| job_part_status | order_status_description → **job_part_status_description** | `orderStatusDescription` → **`jobPartStatusDescription`** |
| job_status_log | job_log_date → **log_date** | `jobLogDate` → **`logDate`** |
| job_type | is_active → **dropped** | `isActive` → — |
| model | manufacturer_pk → **brand_pk** | `manufacturerPk` → **`brandPk`** |
| model | is_active → **dropped** | `isActive` → — |
| model | model_tier_pk → **dropped** | `modelTierPk` → — |
| product | product_vender_code → **product_vendor_code** | `productVenderCode` → **`productVendorCode`** |
| product | manufacturer_pk → **brand_pk** | `manufacturerPk` → **`brandPk`** |
| product | is_serial_control → **dropped** | `isSerialControl` → — |
| product | pictrue_file_name → **picture_file_name** | `pictrueFileName` → **`pictureFileName`** |
| product | is_active → **dropped** | `isActive` → — |
| product_serial | sale_out_hd_pk → **sale_order_pk** | `saleOutHdPk` → **`saleOrderPk`** |
| product_stock | store_location_id → **dropped** | `storeLocationId` → — |
| product_stock | condition_id → **dropped** | `conditionId` → — |
| product_stock | is_publish → **dropped** | `isPublish` → — |
| product_type | is_active → **dropped** | `isActive` → — |
| quotation | customer_contact_name → **dropped** | `customerContactName` → — |
| quotation | is_active → **dropped** | `isActive` → — |
| quotation | **customer_name** (new: character varying(200)) | — → **`customerName`** |
| quotation | **customer_address** (new: character varying(500)) | — → **`customerAddress`** |
| quotation | **customer_tax_id** (new: character varying(20)) | — → **`customerTaxId`** |
| quotation | **customer_phone** (new: character varying(50)) | — → **`customerPhone`** |
| quotation_line | quotation_hd_pk → **quotation_pk** | `quotationHdPk` → **`quotationPk`** |
| quotation_line | unit → **dropped** | `unit` → — |
| quotation_temp | quotation_hd_pk → **quotation_pk** | `quotationHdPk` → **`quotationPk`** |
| sale_order | sale_out_hd_no → **sale_order_no** | `saleOutHdNo` → **`saleOrderNo`** |
| sale_order | document_type → **dropped** | `documentType` → — |
| sale_order | document_status → **dropped** | `documentStatus` → — |
| sale_order | document_credit_note_no → **dropped** | `documentCreditNoteNo` → — |
| sale_order | vat_rat → **vat_rate** | `vatRat` → **`vatRate`** |
| sale_order | remark_hd → **remark** | `remarkHd` → **`remark`** |
| sale_order | is_sale_out → **dropped** | `isSaleOut` → — |
| sale_order | sale_out_date → **dropped** | `saleOutDate` → — |
| sale_order | reference_no → **dropped** | `referenceNo` → — |
| sale_order_line | sale_out_hd_pk → **sale_order_pk** | `saleOutHdPk` → **`saleOrderPk`** |
| sale_order_line | store_location_id → **dropped** | `storeLocationId` → — |
| sale_order_line | condition_id → **dropped** | `conditionId` → — |
| sale_order_line | serial_no → **dropped** | `serialNo` → — |
| sale_order_line | amount_dt → **amount** | `amountDt` → **`amount`** |
| sale_order_line | remark_dt → **remark** | `remarkDt` → **`remark`** |
| sale_order_line | product_none_serial_pk → **dropped** | `productNoneSerialPk` → — |
| sale_order_line | product_type → **dropped** | `productType` → — |
| sale_order_line | document_credit_note_no → **dropped** | `documentCreditNoteNo` → — |
| sale_order_line | pick_inventory_hd_pk → **pick_stock_move_pk** | `pickInventoryHdPk` → **`pickStockMovePk`** |
| sale_order_line | return_inventory_hd_pk → **return_stock_move_pk** | `returnInventoryHdPk` → **`returnStockMovePk`** |
| stock_move | inventory_no → **stock_move_no** | `inventoryNo` → **`stockMoveNo`** |
| stock_move | inventory_type_id → **stock_move_type_id** | `inventoryTypeId` → **`stockMoveTypeId`** |
| stock_move | item_type → **dropped** | `itemType` → — |
| stock_move | sale_out_hd_pk → **sale_order_pk** | `saleOutHdPk` → **`saleOrderPk`** |
| stock_move | inventory_remark → **remark** | `inventoryRemark` → **`remark`** |
| stock_move | is_active → **dropped** | `isActive` → — |
| stock_move | company_id → **dropped** | `companyId` → — |
| stock_move | branch_id → **dropped** | `branchId` → — |
| stock_move_line | inventory_hd_pk → **stock_move_pk** | `inventoryHdPk` → **`stockMovePk`** |
| stock_move_line | item_unit → **dropped** | `itemUnit` → — |
| stock_move_line | store_location_id → **dropped** | `storeLocationId` → — |
| stock_move_line | stock_type_id → **dropped** | `stockTypeId` → — |
| stock_move_line | receive_inventory_hd_pk → **dropped** | `receiveInventoryHdPk` → — |
| stock_move_type | inventory_type_id → **stock_move_type_id** | `inventoryTypeId` → **`stockMoveTypeId`** |
| stock_move_type | inventory_type_name → **stock_move_type_name** | `inventoryTypeName` → **`stockMoveTypeName`** |
| sub_district | mt_city_pk → **province_pk** | `mtCityPk` → **`provincePk`** |
| sub_district | mt_district_pk → **district_pk** | `mtDistrictPk` → **`districtPk`** |
| symptom | is_active → **dropped** | `isActive` → — |
| track_doc_ticket | quotation_hd_pk → **quotation_pk** | `quotationHdPk` → **`quotationPk`** |
| track_doc_ticket | sale_out_hd_pk → **sale_order_pk** | `saleOutHdPk` → **`saleOrderPk`** |
| job | model_pk: now NOT NULL | `modelPk` |

40 columns renamed, 53 dropped, 18 added (+ job.model_pk NOT NULL, + legacy_boundary).
