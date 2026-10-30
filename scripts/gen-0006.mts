/**
 * One-off generator for drizzle/0006_bigint_pk.sql (ADR 0008 phase 2, slice S1):
 *   npx tsx scripts/gen-0006.mts
 * Reads MAPPING below + the catalog of the LOCAL dev database at 0005 (columns, types, defaults, NOT NULL, indexes,
 * checks, triggers, comments) — read-only (default_transaction_read_only) — and writes the migration as plain SQL.
 * The SQL is what is reviewed and committed; this script is only how it was written. Every column of every table
 * must be in MAPPING (the script refuses otherwise), so a dump that changed is caught here and again by the
 * migration itself (section 1).
 *   GEN_DATABASE_URL — a local database at 0005: a fresh legacy load migrated to 0005 in a scratch DB (the dev DB of
 *   docker-compose.yml, the default, is converted once 0006 ran there — the script refuses a converted catalog)
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';

const URL = process.env.GEN_DATABASE_URL ?? 'postgresql://root:dev_pass@127.0.0.1:55435/shd_oneservice_dev_db';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(URL)) throw new Error('local databases only');
const OUT = 'drizzle/0006_bigint_pk.sql';

// ---------------------------------------------------------------------------------------------------------------
// Mapping (ADR 0008 "Phase 2 design" table + adr/0008-phase2-renames.md). Every column except `id` (always second).
//   'k'      kept as is
//   'pk'     the old int key: its value becomes `pk`, the column goes
//   'code'   code table key (decision 5): kept NOT NULL + UNIQUE, the FK target; `pk` = the same value
//   rel()    renamed to a `*_pk` bigint → <ref>.pk; `via` = the parent's business number for a text relation
//   fk()     kept, FK to a code table's code column
//   multi()  one text column → several `*_pk` (decision 11)
//   also()   kept + a `*_pk` beside it (decision 7)
//   gone()   removed (no redundant data, owner 2026-10-30): `same` = SQL over the old row `o` (`$` = the column) that
//            holds for EVERY row — constant, or equal to what it duplicates — section 6 aborts otherwise; `log` = rows
//            whose value pointed at no row, kept in legacy_orphan_ref like any orphan (decision 4)
// ---------------------------------------------------------------------------------------------------------------
type Rel = { ref: string; to: string; via?: string; nn?: boolean };
type Spec =
  | 'k'
  | 'pk'
  | 'code'
  | { rel: Rel }
  | { fk: string }
  | { multi: Rel[]; when?: string }
  | { also: Rel }
  | { drop: true; same: string; log?: string }
  | { cast: string; type: string }
  | { value: string }; // kept, filled with this expression over o
type Table = {
  cols: Record<string, Spec>;
  rn?: string; // pk = row_number() over this order (text / composite / no key)
  job?: true; // pk = digits of job_no (decision 8)
  where?: (a: string) => string; // rows not copied (decision 6)
  unique?: string[]; // business numbers (decision 2) made UNIQUE
  replaced?: Record<string, string>; // old index → what replaces it
  add?: Record<string, AddCol[]>; // new columns after this old one
  legacy?: Record<string, string>; // column (new name) → what to read instead: kept for legacy rows, new rows NULL
};
/** a new column: `expr` fills it from the old row (default: `def` / NULL); `fk` → <table>.pk; `check` (over o, n)
 *  must hold for every row (section 6) */
type AddCol = { name: string; type: string; nn?: boolean; def?: string; expr?: string; fk?: string; check?: string };

const rel = (ref: string, to = `${ref}_pk`, o: { via?: string; nn?: boolean } = {}): { rel: Rel } => ({
  rel: { ref, to, ...o },
});
const txt = (ref: string, via: string, to = `${ref}_pk`, nn = false) => rel(ref, to, { via, nn });
const user = (role?: string, nn = false) => rel('app_user', role ? `${role}_app_user_pk` : 'app_user_pk', { nn });
const fk = (table: string): Spec => ({ fk: table });
const jobNo = (to = 'job_pk', nn = true) => txt('job', 'job_no', to, nn);
const status = {
  record_status: fk('record_status'),
  status_changed_at: 'k',
  status_changed_by: user('status_changed_by'),
} as const;
const gone = (same: string, log?: string): Spec => ({ drop: true, same, log });
const blank = gone(`coalesce($::text, '') = ''`);
const only = (v: string) => gone(`coalesce($, ${v}) = ${v}`); // constant where set
const mirrorsStatus = gone(`$ IS NOT DISTINCT FROM (o.record_status = 'ACTIVE')`); // is_active ⇔ record_status
const keep = (...names: string[]) => Object.fromEntries(names.map((n) => [n, 'k' as const]));
const noMinusOne = (key: string) => (a: string) => `${a}.${key} <> -1`;

const MAPPING: Record<string, Table> = {
  app_back_up_db_log: {
    cols: { pk: 'pk', ...keep('back_up_date', 'back_up_file_name'), back_up_by: user('backed_up_by') },
  },
  app_config: {
    cols: { config_id: 'pk', ...keep('user_type', 'module_name', 'can_insert', 'can_edit', 'can_delete', 'can_view') },
  },
  app_user: {
    cols: {
      user_id: 'pk',
      ...keep(
        'username',
        'password',
        'first_name',
        'last_name',
        'user_type',
        'is_active',
        'phone_no',
        'email_address',
        'asc_code',
        'asc_name',
        'lark_id',
        'department',
        'title',
        'avatar',
        'last_login',
        'deleted',
        'session_version',
      ),
      ...status,
    },
  },
  app_user_tour: { rn: 'user_id', cols: { user_id: user(undefined, true), ...keep('seen', 'off', 'updated_at') } },
  approve_status: {
    cols: {
      approve_status_id: 'code',
      ...keep('approve_name_th', 'approve_name_en', 'approve_description', 'is_can_edit', 'is_can_revise'),
    },
  },
  audit_log: {
    cols: {
      pk: 'pk',
      user_id: user(),
      ...keep('at', 'user_name', 'action', 'module', 'entity', 'entity_key', 'summary', 'changes', 'meta'),
    },
  },
  category: {
    cols: { category_id: 'pk', ...keep('category_name', 'category_description', 'shot_code', 'is_active'), ...status },
  },
  color: { cols: { pk: 'pk', ...keep('color_name', 'description', 'is_active'), ...status } },
  condition: { cols: { condition_id: 'code', ...keep('condition_name', 'condition_description', 'is_active') } },
  customer: {
    cols: {
      customer_id: 'pk',
      ...keep(
        'customer_code',
        'customer_card_id',
        'customer_name',
        'customer_address',
        'customer_address1',
        'customer_address2',
        'postal_code',
        'phone_number',
        'fax_number',
        'email',
        'customer_type',
        'created_date',
        'is_active',
        'use_price_group',
        'line_id',
        'is_customer_online',
        'row_version',
      ),
      create_by: user('created_by'),
      city_id: rel('mt_city'),
      district_id: rel('mt_district'),
      sub_district_id: rel('mt_sub_district'),
      ...status,
    },
  },
  document_attach: {
    cols: {
      document_attach_id: 'pk',
      reference_topic: gone(`$ = 'Jobs'`), // every row is a job's attachment
      reference_item_code: jobNo(),
      ...keep('original_file_name', 'system_file_name', 'remark', 'is_active'),
      ...status,
    },
    replaced: { ix_document_attach_ref: 'ix_document_attach_job_pk' },
  },
  document_profile: {
    cols: {
      pk: 'pk',
      ...keep(
        'code',
        'name_th',
        'name_en',
        'address_line1',
        'address_line2',
        'phone',
        'email',
        'tax_id',
        'bank_name',
        'bank_account_type',
        'bank_account_no',
        'bank_account_name',
        'logo_path',
        'stamp_path',
        'prefix_job',
        'prefix_quotation',
        'prefix_sale_order',
        'is_default',
        'is_active',
        'sort_order',
        'created_at',
        'updated_at',
        'deleted_at',
        'purpose',
      ),
      deleted_by: user('deleted_by'),
    },
  },
  idempotency_key: {
    rn: 'user_id, key',
    cols: { user_id: user(undefined, true), ...keep('key', 'route', 'status', 'response', 'created_at') },
  },
  inventory_dt: {
    cols: {
      inventory_dt_id: 'pk',
      inventory_no: txt('inventory_hd', 'inventory_no', 'inventory_hd_pk', true),
      item_code: txt('product', 'product_code'),
      receive_inventory_no: txt('inventory_hd', 'inventory_no', 'receive_inventory_hd_pk'),
      store_location_id: fk('store_location'),
      ...keep('item_quantity', 'item_unit', 'stock_type_id'),
    },
  },
  inventory_hd: {
    cols: {
      inventory_hd_id: 'pk',
      inventory_type_id: fk('inventory_type'),
      reference_document_no: {
        multi: [
          { ref: 'job', to: 'job_pk', via: 'job_no' },
          { ref: 'sale_out_hd', to: 'sale_out_hd_pk', via: 'sale_out_hd_no' },
        ],
      },
      create_by: user('created_by'),
      ...keep(
        'inventory_no',
        'item_type',
        'reference_out_to',
        'inventory_remark',
        'create_date',
        'is_active',
        'company_id',
        'branch_id',
      ),
    },
    // the receive form's PO no. (free text — reference_document_no now only points at a job / sale order); legacy ''
    add: {
      reference_document_no: [{ name: 'po_no', type: 'character varying(50)', nn: true, def: "''::character varying" }],
    },
    replaced: {
      ix_inventory_hd_ref: 'ix_inventory_hd_job_pk + ix_inventory_hd_sale_out_hd_pk',
      gin_inventory_hd_ref: 'ix_inventory_hd_job_pk + ix_inventory_hd_sale_out_hd_pk',
      ix_inventory_hd_no: 'ux_inventory_hd_no', // the same column, twice
    },
  },
  inventory_type: {
    cols: {
      inventory_type_id: 'code',
      ...keep(
        'inventory_type_name',
        'movement_action_type',
        'movement_action',
        'effect_material',
        'effect_package',
        'effect_product',
        'remark',
        'is_active',
      ),
    },
  },
  job: {
    // track_token: emptied by 0033 and never read (the link is looked up by track_token_hash) — no index
    replaced: { ux_job_track_token: 'nothing' },
    job: true,
    cols: {
      ...keep(
        'job_no',
        'company_id',
        'branch_id',
        'customer_detail',
        'customer_due_date',
        'job_create_date',
        'job_type_detail',
        'job_repaired_date',
        'job_closed_date',
        'product_imei_no',
        'product_serial',
        'product_model_name',
        'product_model_detail',
        'product_color',
        'product_symptom_other',
        'product_equipment',
        'product_fault',
        'estimate_cost',
        'deposit_cost',
        'spare_part_total_cost',
        'service_cost',
        'service_tool_cost',
        'delivery_cost',
        'carton_box_cost',
        'job_total_cost',
        'job_reference_no',
        'job_reference_no_gspn',
        'job_gspn_create_date',
        'job_remark',
        'engineer_repair_detail',
        'engineer_remark',
        'job_payment_type',
        'job_payment_no',
        'job_payment_amount',
        'job_payment_detail',
        'job_return_date',
        'return_customer_type',
        'return_customer_tracking_no',
        'return_customer_detail',
        'spare_part_replace',
        'product_warranty',
        'product_sale_out_channel',
        'product_sale_order_date',
        'product_warranty_month',
        'product_expire_date',
        'job_reception_type',
        'job_reception_date',
        'job_reception_tracking_no',
        'job_reception_shipper',
        'swap_refund_detail',
        'job_payment_slip_file_name',
        'swap_refund_document_no',
        'is_job_bounce',
        'product_sale_out_shop_name',
        'track_token',
        'track_token_at',
        'track_opened_at',
        'track_link_expires_at',
        'due_date_set_by_user',
        'track_token_hash',
        'row_version',
      ),
      customer_id: rel('customer'),
      job_create_by: user('created_by'),
      job_type_id: rel('job_type'),
      job_status_id: fk('job_status'),
      job_repaired_by: user('repaired_by'),
      job_closed_by: user('closed_by'),
      product_type_id: rel('product_type'),
      product_brand_id: rel('manufacturer', 'brand_manufacturer_pk'),
      product_model_id: rel('model'),
      product_symptom_id: rel('symptom', 'reported_symptom_pk'),
      engineer_id: user('engineer'),
      engineer_symptom_id: rel('symptom', 'engineer_symptom_pk'),
      job_return_by: user('returned_by'),
      quotation_no_approved: txt('quotation_hd', 'quotation_no', 'approved_quotation_hd_pk'),
      document_profile_id: rel('document_profile'),
      return_shipper_id: rel('shipping_profile', 'return_shipping_profile_pk'),
      ...status,
    },
  },
  job_call_log: {
    cols: {
      job_call_log_id: 'pk',
      job_no: jobNo(),
      call_log_by: user('called_by'),
      ...keep('call_log_description', 'call_log_date'),
    },
  },
  job_close_temp: {
    cols: {
      pk: 'pk',
      ref_job_no: jobNo('ref_job_pk', false),
      next_status_id: fk('job_status'),
      ...keep('serial_no', 'is_can_close_job', 'remark'),
    },
  },
  job_create_temp: {
    cols: {
      pk: 'pk',
      model_code: txt('model', 'model_code'),
      ...keep(
        'product_imei_no',
        'lot_no',
        'warranty',
        'is_can_generate_job',
        'remark',
        'product_serial',
        'product_model_detail',
        'job_reference_no_gspn',
      ),
    },
  },
  job_log: {
    cols: {
      job_log_id: 'pk',
      job_no: jobNo(),
      job_status_id: fk('job_status'),
      job_log_date: 'k',
      job_action_by: user('action_by'),
    },
  },
  job_order_spare_part_log: {
    cols: {
      job_order_log_id: 'pk',
      job_no: jobNo(),
      spare_part_code: txt('product', 'product_code'),
      stock_id: fk('store_location'),
      return_stock_id: fk('store_location'),
      order_status_id: fk('job_order_spare_part_status'),
      request_by: user('requested_by'),
      grant_by: user('granted_by'),
      return_by: user('returned_by'),
      ...keep(
        'spare_part_unit_price',
        'spare_part_serial_no',
        'is_quotation',
        'is_special',
        'request_qty',
        'spare_part_total_price',
        'is_quotation_b',
        'is_special_b',
        'request_qty_b',
        'spare_part_total_price_b',
        'request_date',
        'grant_qty',
        'grant_date',
        'return_qty',
        'return_date',
      ),
    },
  },
  job_order_spare_part_status: {
    cols: { order_status_id: 'code', ...keep('order_status_name', 'order_status_description') },
  },
  job_return_dt: {
    cols: {
      job_return_dt_id: 'pk',
      return_no: txt('job_return_hd', 'return_no'),
      reference_job_no: jobNo('job_pk', false),
      ...keep('item_no', 'end_user_name', 'product_model_name', 'product_serial_no', 'equipment_return'),
    },
  },
  job_return_hd: {
    unique: ['return_no'],
    cols: {
      job_return_id: 'pk',
      create_by: user('created_by'),
      return_customer_code: txt('customer', 'customer_code', 'return_customer_pk'),
      ...keep(
        'return_date',
        'return_customer_name',
        'original_file_name',
        'system_file_name',
        'create_date',
        'return_no',
        'image_file_name',
      ),
    },
  },
  job_send_forward_dt: {
    cols: {
      pk: 'pk',
      job_no: jobNo(),
      send_by: user('sent_by'),
      receive_by: user('received_by'),
      ...keep('send_to_name', 'send_detail', 'send_date', 'receive_date', 'receive_detail', 'send_status'),
    },
  },
  job_service_code: { rn: 'service_code', cols: keep('service_code', 'service_name', 'service_description') },
  job_status: {
    cols: { job_status_id: 'code', ...keep('job_status_name', 'display_order', 'job_status_group', 'is_active') },
  },
  job_symptom: {
    rn: 'job_no, symptom_id',
    cols: { job_no: jobNo(), symptom_id: rel('symptom', 'symptom_pk', { nn: true }) },
  },
  job_type: {
    cols: {
      job_type_id: 'pk',
      ...keep('job_type_name', 'job_type_description', 'is_active', 'default_due_days'),
      ...status,
    },
  },
  manufacturer: { cols: { manufacturer_id: 'pk', ...keep('manufacturer_name', 'logo_name', 'is_active'), ...status } },
  model: {
    unique: ['model_code'],
    cols: {
      model_id: 'pk',
      manufacturer_id: rel('manufacturer'),
      tier_id: rel('model_tier'),
      ...keep('model_code', 'model_name', 'market_price', 'is_active', 'last_update'),
      ...status,
    },
  },
  model_color: {
    cols: { item_id: 'pk', ...keep('model_name', 'color_name', 'default_color', 'exten_file_name', 'is_active') },
  },
  model_part: {
    cols: { item_price_id: 'pk', ...keep('model_item_id', 'color', 'part_name', 'price', 'service', 'remark') },
  },
  model_tier: { cols: { tier_id: 'pk', ...keep('tier_no', 'min_price', 'max_price', 'rrp_percent') } },
  mt_city: { where: noMinusOne('city_id'), cols: { city_id: 'pk', ...keep('name_en', 'name_th', 'region') } },
  mt_district: {
    where: noMinusOne('district_id'),
    cols: { district_id: 'pk', city_id: rel('mt_city'), ...keep('name_en', 'name_th', 'postal_code') },
  },
  mt_sub_district: {
    where: noMinusOne('sub_district_id'),
    cols: {
      sub_district_id: 'pk',
      city_id: rel('mt_city'),
      district_id: rel('mt_district'),
      ...keep('name_en', 'name_th', 'postal_code'),
    },
  },
  product: {
    unique: ['product_code'],
    cols: {
      product_id: 'pk',
      category_id: rel('category'),
      manufacturer_id: rel('manufacturer'),
      create_by: user('created_by'),
      cancel_by: user('cancelled_by'),
      ...keep(
        'product_code',
        'product_vender_code',
        'product_name',
        'product_name_en',
        'product_name_cn',
        'product_description',
        'is_serial_control',
        'pictrue_file_name',
        'is_active',
        'create_date',
        'cancel_remark',
        'cancel_date',
        'is_ub_repair_only',
        'for_model_color',
      ),
      ...status,
    },
  },
  product_model: {
    cols: { product_model_id: 'pk', product_id: rel('product'), model_code: txt('model', 'model_code') },
  },
  product_none_serial: {
    cols: {
      item_id: 'pk',
      product_id: rel('product'),
      store_location_id: fk('store_location'),
      condition_id: fk('condition'),
      ...keep(
        'capital_price',
        'wholesale_price',
        'retail_price',
        'remark',
        'is_publish',
        'quantity_inspection',
        'quantity_not_available',
        'quantity_available',
        'quantity_used',
        'quantity_booking',
        'quantity_loss',
        'quantity_remain',
      ),
    },
  },
  product_serial: {
    cols: {
      item_id: 'pk',
      product_id: rel('product'),
      store_location_id: fk('store_location'),
      condition_id: fk('condition'),
      sale_out_hd_no: txt('sale_out_hd', 'sale_out_hd_no'),
      create_by: user('created_by'),
      cancel_by: user('cancelled_by'),
      ...keep(
        'serial_no',
        'quantity',
        'quantity_booking',
        'capital_price',
        'wholesale_price',
        'retail_price',
        'remark',
        'picture_file_name',
        'is_publish',
        'is_saled',
        'is_active',
        'create_date',
        'cancel_remark',
        'cancel_date',
      ),
    },
  },
  product_type: {
    cols: { product_type_id: 'pk', ...keep('product_type_name', 'is_active', 'product_type_description'), ...status },
  },
  quotation_dt: {
    cols: {
      quotation_dt_id: 'pk',
      quotation_no: txt('quotation_hd', 'quotation_no', 'quotation_hd_pk', true),
      item_code: { also: { ref: 'product', to: 'product_pk', via: 'product_code' } },
      ...keep(
        'line_number',
        'item_type',
        'item_detail',
        'quantity',
        'unit',
        'unit_price',
        'unit_price_discount',
        'total_price',
        'unit_price_discount_percent',
      ),
    },
  },
  quotation_hd: {
    replaced: { ix_quotation_hd_no: 'ux_quotation_hd_no' }, // the same column, twice
    cols: {
      quotation_hd_id: 'pk',
      customer_code: txt('customer', 'customer_code'),
      create_by: user('created_by'),
      reference_job_no: jobNo('job_pk', false),
      quotation_status_id: fk('quotation_status'),
      document_profile_id: rel('document_profile'),
      ...keep(
        'quotation_no',
        'customer_contact_name',
        'create_date',
        'spare_part_amount',
        'service_amount',
        'sum_exclude_amount',
        'discount_type',
        'discount_formula',
        'discount_amount',
        'after_discount_amount',
        'total_base_amount',
        'vat_rate',
        'vat_amount',
        'total_amount',
        'rounding_amount',
        'net_amount',
        'remark',
        'customer_approve_date',
        'customer_approve_remark',
        'is_active',
        'quotation_type',
        'row_version',
      ),
      ...status,
    },
  },
  quotation_status: { cols: { quotation_status_id: 'code', quotation_status_name: 'k' } },
  quotation_temp: { rn: 'quotation_no', cols: { quotation_no: txt('quotation_hd', 'quotation_no'), is_can_edit: 'k' } },
  record_status: { rn: 'sort_order', cols: { code: 'code', ...keep('name_th', 'name_en', 'sort_order') } },
  running_no: {
    cols: {
      running_id: 'pk',
      ...keep(
        'running_type',
        'company_id',
        'branch_id',
        'prefix',
        'pyear',
        'pmonth',
        'pday',
        'number',
        'length_year',
        'length_month',
        'length_number',
      ),
    },
  },
  sale_in_dt: {
    cols: {
      sale_in_dt_id: 'pk',
      sale_in_hd_no: txt('sale_in_hd', 'sale_in_hd_no'),
      product_id: rel('product'),
      store_location_id: fk('store_location'),
      condition_id: fk('condition'),
      ...keep(
        'list_no',
        'serial_no',
        'quantity_at_current',
        'quantity_income',
        'capital_price',
        'wholesale_price',
        'retail_price',
        'remark',
      ),
    },
  },
  sale_in_hd: {
    unique: ['sale_in_hd_no'],
    cols: {
      sale_in_hd_id: 'pk',
      sale_in_by: user('sale_in_by'),
      ...keep('sale_in_hd_no', 'sale_in_type', 'sale_in_date'),
    },
  },
  sale_out_dt: {
    cols: {
      sale_out_dt_id: 'pk',
      sale_out_hd_no: txt('sale_out_hd', 'sale_out_hd_no', 'sale_out_hd_pk', true),
      product_id: rel('product'),
      store_location_id: fk('store_location'),
      condition_id: fk('condition'),
      onhand_item_id: rel('product_none_serial'),
      pick_inventory_no: txt('inventory_hd', 'inventory_no', 'pick_inventory_hd_pk'),
      return_inventory_no: txt('inventory_hd', 'inventory_no', 'return_inventory_hd_pk'),
      ...keep(
        'list_no',
        'serial_no',
        'capital_price',
        'wholesale_price',
        'retail_price',
        'sale_out_price',
        'sale_out_quantity',
        'amount_dt',
        'remark_dt',
        'product_type',
        'document_credit_note_no',
        'product_code',
      ),
    },
  },
  sale_out_hd: {
    replaced: { ix_sale_out_hd_no: 'ux_sale_out_hd_no' }, // the same column, twice
    cols: {
      sale_out_hd_id: 'pk',
      document_create_by: user('created_by'),
      document_cancel_by: user('cancelled_by'),
      customer_id: rel('customer'),
      // the customer's code, copied — kept only through customer_pk; a code that is not that customer's is logged
      customer_code: {
        drop: true,
        same: `$ IS NOT DISTINCT FROM (SELECT c.customer_code FROM customer c WHERE c.customer_id = o.customer_id)`,
      },
      sale_out_by: user('sale_out_by'),
      approve_status_id: fk('approve_status'),
      approve_by: user('approved_by'),
      document_profile_id: rel('document_profile'),
      ...keep(
        'sale_out_hd_no',
        'document_type',
        'document_create_date',
        'document_status',
        'document_credit_note_no',
        'document_cancel_date',
        'document_cancel_remark',
        'customer_card_id',
        'customer_name',
        'customer_address',
        'customer_phone_number',
        'customer_fax_number',
        'total_base_amount',
        'vat_rat',
        'vat_amount',
        'total_amount',
        'rounding_amount',
        'fee_amount',
        'net_amount',
        'remark_hd',
        'is_sale_out',
        'sale_out_date',
        'reference_no',
        'payment_type',
        'payment_amount',
        'slip_file_name',
        'approve_date',
        'approve_remark',
        'delivery_tracking_no',
        'delivery_date',
        'row_version',
      ),
      ...status,
    },
  },
  service_cost: { rn: 'service_code', cols: keep('service_code', 'service_description', 'service_cost') },
  shipping_profile: {
    cols: {
      pk: 'pk',
      deleted_by: user('deleted_by'),
      ...keep(
        'code',
        'name_th',
        'name_en',
        'logo_path',
        'track_url',
        'is_active',
        'sort_order',
        'created_at',
        'updated_at',
        'deleted_at',
        'aliases',
      ),
    },
  },
  store_location: {
    cols: {
      store_location_id: 'code',
      ...keep('store_location_name', 'store_location_description', 'store_location_group', 'is_active'),
    },
  },
  symptom: {
    cols: {
      symptom_id: 'pk',
      ...keep('symptom_name', 'symptom_description', 'symptom_group_name', 'is_active'),
      ...status,
    },
  },
  temp_model: { cols: { pk: 'pk', ...keep('model_name', 'model_code', 'market_price') } },
  temp_spare_part: {
    rn: 'id', // no key (0005: its stable id is made from the row itself)
    cols: keep(
      'item_id',
      'product_vender_code',
      'spare_part_name_th',
      'spare_part_name_en',
      'spare_part_name_cn',
      'spare_part_description',
      'manufacturer_name',
      'quantity_remain',
      'capital_price',
      'retail_price',
    ),
  },
  track_block: { rn: 'key', cols: keep('key', 'blocked_until') },
  track_doc_ticket: {
    rn: 'token_hash',
    cols: {
      job_no: jobNo(),
      // kind 'job' / 'return': ref is the job itself (both NULL, not an orphan)
      ref: {
        multi: [
          { ref: 'quotation_hd', to: 'quotation_hd_pk', via: 'quotation_no' },
          { ref: 'sale_out_hd', to: 'sale_out_hd_pk', via: 'sale_out_hd_no' },
        ],
        when: 'o.ref IS DISTINCT FROM o.job_no',
      },
      ...keep('token_hash', 'kind', 'issued_ip', 'ua_hash', 'created_at', 'expires_at'),
    },
  },
  track_event: { cols: { pk: 'pk', ...keep('at', 'event', 'result', 'ip_hash', 'link_hash', 'job_no', 'request_id') } },
  track_otp: {
    rn: 'request_hash',
    cols: {
      customer_ids: { cast: 'customer_pks', type: 'bigint[]' },
      ...keep(
        'request_hash',
        'phone_hash',
        'code_hash',
        'attempts',
        'issued_ip',
        'created_at',
        'expires_at',
        'consumed_at',
        'provider_token',
      ),
    },
  },
  track_rate: { rn: 'bucket, key, window_start', cols: keep('bucket', 'key', 'window_start', 'hits') },
  track_session: {
    rn: 'token_hash',
    cols: {
      customer_ids: { cast: 'customer_pks', type: 'bigint[]' },
      ...keep('token_hash', 'phone_hash', 'issued_ip', 'ua_hash', 'created_at', 'expires_at', 'max_expires_at'),
    },
  },
  track_ticket: {
    rn: 'token_hash',
    cols: { job_no: jobNo(), ...keep('token_hash', 'issued_ip', 'ua_hash', 'created_at', 'expires_at') },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Table naming (owner 2026-10-30, ADR 0008 "Phase 2 — table naming"): names say what the table holds; legacy typos
// fixed. Everything above speaks the OLD names (the old tables, <old>__new while copying, section 6); section 7 renames
// the tables and columns, sections 8–9 speak the new names. The 16 unused legacy tables keep theirs (dropped after
// cutover); legacy_orphan_ref keeps the LEGACY table / column names (it documents the legacy source).
// ---------------------------------------------------------------------------------------------------------------
const TABLE_RENAME: Record<string, string> = {
  product_none_serial: 'product_stock',
  job_order_spare_part_log: 'job_part',
  job_order_spare_part_status: 'job_part_status',
  job_send_forward_dt: 'job_outsource',
  document_attach: 'job_attachment',
  app_config: 'role_permission',
  product_model: 'product_compatible_model',
  mt_city: 'province',
  mt_district: 'district',
  mt_sub_district: 'sub_district',
  manufacturer: 'brand',
  job_log: 'job_status_log',
  sale_out_hd: 'sale_order',
  sale_out_dt: 'sale_order_line',
  quotation_hd: 'quotation',
  quotation_dt: 'quotation_line',
  inventory_hd: 'stock_move',
  inventory_dt: 'stock_move_line',
  inventory_type: 'stock_move_type',
};
/** old table → column (its name after the mapping above) → final name. On top: every `*<old table>_pk` follows its
 *  table (sale_out_hd_pk → sale_order_pk, pick_inventory_hd_pk → pick_stock_move_pk, mt_city_pk → province_pk …) */
const COL_RENAME: Record<string, Record<string, string>> = {
  inventory_type: { inventory_type_id: 'stock_move_type_id', inventory_type_name: 'stock_move_type_name' },
  inventory_hd: { inventory_no: 'stock_move_no', inventory_type_id: 'stock_move_type_id', inventory_remark: 'remark' },
  job_order_spare_part_status: {
    order_status_id: 'job_part_status_id',
    order_status_name: 'job_part_status_name',
    order_status_description: 'job_part_status_description',
  },
  job_order_spare_part_log: { order_status_id: 'job_part_status_id' },
  manufacturer: { manufacturer_name: 'brand_name' },
  sale_out_hd: { sale_out_hd_no: 'sale_order_no', remark_hd: 'remark', vat_rat: 'vat_rate' },
  sale_out_dt: { remark_dt: 'remark', amount_dt: 'amount' },
  job_log: { job_log_date: 'log_date' },
  audit_log: { app_user_pk: 'actor_pk', user_name: 'actor_name' },
  // typos
  product: { pictrue_file_name: 'picture_file_name', product_vender_code: 'product_vendor_code' },
  category: { shot_code: 'short_code' },
};
const RENAMED = Object.keys(TABLE_RENAME)
  .sort((a, b) => b.length - a.length)
  .join('|');
const tn = (t: string) => TABLE_RENAME[t] ?? t;
const fin = (t: string, c: string) =>
  COL_RENAME[t]?.[c] ?? c.replace(new RegExp(`(^|_)(${RENAMED})_pk$`), (_, p, x) => `${p}${TABLE_RENAME[x]}_pk`);
/** old index names whose new name is not just the table token swapped */
const FINAL_IDX: Record<string, string> = {
  ix_job_send_forward_job: 'ix_job_outsource_job_pk',
  ix_mt_district_city: 'ix_district_province_pk',
  ix_mt_sub_district_city: 'ix_sub_district_province_pk',
  ix_mt_sub_district_district: 'ix_sub_district_district_pk',
  ix_spare_part_log_pending: 'ix_job_part_pending',
  ix_product_none_serial_p: 'ix_product_stock_product_pk',
  ix_product_model_product: 'ix_product_compatible_model_product_pk',
  ix_sale_out_dt_hd: 'ix_sale_order_line_sale_order_pk',
  ix_inventory_hd_type: 'ix_stock_move_stock_move_type_id',
  ix_audit_log_user: 'ix_audit_log_actor',
};
/** an index / constraint / trigger name in the new names: `<prefix>_<old table>…` → `<prefix>_<new table>…`,
 *  `…_<old table>_pk` → `…_<new table>_pk` */
const fx = (n: string) =>
  FINAL_IDX[n] ??
  n
    .replace(new RegExp(`^(ix|ux|gin|ck|tr)_(${RENAMED})(?=_|$)`), (_, p, x) => `${p}_${TABLE_RENAME[x]}`)
    .replace(new RegExp(`_(${RENAMED})_pk$`), (_, x) => `_${TABLE_RENAME[x]}_pk`);

// ---------------------------------------------------------------------------------------------------------------
// No redundant data (owner 2026-10-30, ADR 0008 "Phase 2 — no redundant data"): a column whose every value is a
// constant or a copy of what a relation already says goes; its `same` is checked on every row in section 6 (prod
// backup + fresh load verified 2026-10-30). Legacy snapshot text that new rows stop writing stays (`legacy`).
// ---------------------------------------------------------------------------------------------------------------
const NO_REDUNDANT: Record<string, Pick<Table, 'add' | 'legacy' | 'replaced'> & { cols?: Record<string, Spec> }> = {
  job: {
    cols: {
      company_id: only('1'),
      branch_id: only('1'),
      product_color: blank,
      job_reference_no_gspn: blank,
      job_gspn_create_date: only(`'1900-01-01'::timestamp`),
      track_token: gone('$ IS NULL'), // emptied by 0033; /track reads track_token_hash
      // = model_pk → model.manufacturer_pk
      product_brand_id: gone(
        '$ IS NOT DISTINCT FROM (SELECT m.manufacturer_id FROM model m WHERE m.model_id = o.product_model_id)',
      ),
      product_model_id: rel('model', 'model_pk', { nn: true }),
    },
    replaced: { ix_job_brand: 'ix_job_product_model' },
    add: {
      product_serial: [{ name: 'new_serial_no', type: 'character varying(50)' }], // the S/N given back on a swap / close
      job_reception_shipper: [
        {
          name: 'reception_shipping_profile_pk',
          type: 'bigint',
          fk: 'shipping_profile',
          // the typed courier name when it IS one live profile's name, exactly; the text stays as it was
          expr: `(SELECT min(s.pk) FROM shipping_profile s WHERE s.deleted_at IS NULL AND s.name_th = btrim(o.job_reception_shipper) HAVING count(*) = 1)`,
          check: `n.reception_shipping_profile_pk IS NULL OR (SELECT s.name_th FROM shipping_profile s WHERE s.pk = n.reception_shipping_profile_pk) = btrim(o.job_reception_shipper)`,
        },
      ],
    },
    legacy: {
      customer_detail: 'customer_pk',
      product_model_name: 'model_pk',
      job_reception_shipper: 'reception_shipping_profile_pk',
      return_customer_detail: 'customer_pk',
      spare_part_replace: 'job_part',
      swap_refund_detail: 'new_serial_no',
      reported_symptom_pk: 'job_symptom',
      // 49 legacy jobs name a quotation later declined / cancelled: not derivable, so the column stays
      approved_quotation_hd_pk: 'quotation (job_pk, the agreed one: ux_quotation_agreed_job)',
    },
  },
  sale_out_hd: {
    cols: {
      document_type: only(`'SaleOrder'`),
      document_status: gone('$ IS NOT FALSE'),
      is_sale_out: gone('$ IS NOT FALSE'),
      sale_out_date: gone('$ IS NOT DISTINCT FROM o.document_create_date'),
      document_credit_note_no: blank,
      // = the pick movement's inventory_no (inventory_hd.sale_out_hd_pk, type 4)
      reference_no: gone(
        `coalesce($, '') = coalesce((SELECT string_agg(h.inventory_no, ',') FROM inventory_hd h WHERE h.reference_document_no = o.sale_out_hd_no AND h.inventory_type_id = 4), '')`,
      ),
    },
  },
  sale_out_dt: {
    cols: {
      // = product_pk's stock row; a service line's value pointed at nothing (kept in legacy_orphan_ref)
      onhand_item_id: gone(
        `$ IS NOT DISTINCT FROM (SELECT n.item_id FROM product_none_serial n WHERE n.product_id = o.product_id) OR NOT EXISTS (SELECT 1 FROM product_none_serial n WHERE n.item_id = $)`,
        `NOT EXISTS (SELECT 1 FROM product_none_serial n WHERE n.item_id = $)`,
      ),
      store_location_id: only('1'),
      condition_id: only('1'),
      serial_no: blank,
      document_credit_note_no: blank,
      // Service ⇔ product_pk NULL
      product_type: gone(
        `$ IN ('Service', 'SparePart') AND ($ = 'Service') = NOT EXISTS (SELECT 1 FROM product p WHERE p.product_id = o.product_id)`,
      ),
    },
    legacy: { product_code: 'product_pk (product lines; a service line keeps its code as text)' },
  },
  inventory_hd: {
    cols: {
      item_type: only(`'SparePart'`),
      is_active: gone('$ IS NOT FALSE'),
      company_id: only('1'),
      branch_id: only('1'),
    },
    legacy: { reference_out_to: 'job_pk / sale_order_pk' },
  },
  inventory_dt: {
    cols: {
      item_unit: only(`'Pcs.'`),
      store_location_id: only('1'),
      stock_type_id: only('1'),
      receive_inventory_no: blank,
    },
  },
  job_order_spare_part_log: { cols: { stock_id: only('1'), spare_part_serial_no: blank } },
  job_send_forward_dt: {
    cols: {
      // received ⇔ receive_date set (not the 1900 placeholder of a sent row)
      send_status: gone(
        `$ IN ('ส่งเครื่องซ่อมแล้ว', 'รับเครื่องซ่อมแล้ว') AND ($ = 'รับเครื่องซ่อมแล้ว') = (o.receive_date IS NOT NULL AND o.receive_date <> '1900-01-01')`,
      ),
    },
  },
  product_none_serial: {
    cols: {
      is_publish: gone('$ IS NOT FALSE'),
      store_location_id: only('1'),
      condition_id: only('1'),
    },
  },
  // cancel_date / cancel_by / cancel_remark stay: 70 legacy cancels are not in status_changed_*
  product: { cols: { is_serial_control: gone('$ IS NOT TRUE') } },
  model: {
    cols: {
      tier_id: gone('NOT EXISTS (SELECT 1 FROM model_tier x WHERE x.tier_id = $)', 'true'), // 0 / -1: never a tier
    },
  },
  app_user: {
    cols: {
      password: gone('$ IS NULL'),
      asc_code: blank,
      asc_name: blank,
      deleted: gone(`$ = (o.record_status = 'DELETED')`),
    },
    // UNIQUE (username, password) never held anything: password was NULL on every row (0002); usernames repeat
    replaced: { ix_username_and_password: 'nothing' },
  },
  quotation_hd: {
    cols: { customer_contact_name: blank },
    add: {
      // the customer as they were when they agreed (written then; legacy rows NULL)
      customer_code: [
        { name: 'customer_name', type: 'character varying(200)' },
        { name: 'customer_address', type: 'character varying(500)' },
        { name: 'customer_tax_id', type: 'character varying(20)' },
        { name: 'customer_phone', type: 'character varying(50)' },
      ],
    },
  },
  quotation_dt: { cols: { unit: only(`'หน่วย'`) }, legacy: { item_code: 'product_pk' } },
  customer: {
    legacy: { customer_address: 'customer_address1 / customer_address2 + province_pk / district_pk / sub_district_pk' },
  },
};
// audit_log.entity names a table: the new name (changes / meta keep their keys)
// The audit trail names the actor fully, as at the time of the action (owner 2026-10-30, round 3). Old rows keep what
// they had; what they never recorded stays NULL — never guessed — except entity_id / entity_no, looked up from
// entity_key where it names a row (job_no, customer_code, a legacy int key or the uuid).
/** business number shown for a row of these tables (old table → column) */
const ENTITY_NO: Record<string, string> = {
  job: 'job_no',
  customer: 'customer_code',
  quotation_hd: 'quotation_no',
  sale_out_hd: 'sale_out_hd_no',
  inventory_hd: 'inventory_no',
  product: 'product_code',
  model: 'model_code',
  document_profile: 'code',
  shipping_profile: 'code',
};
/** the row an old audit row's entity_key names: its key, its uuid or its business number */
const entityLookup = (out: (t: string) => string) =>
  `CASE o.entity ${Object.keys(MAPPING)
    .map((t) => {
      const key = Object.entries(MAPPING[t].cols).find(([, s]) => s === 'pk' || s === 'code')?.[0];
      if (!key && !ENTITY_NO[t]) return '';
      const no = ENTITY_NO[t];
      const match = [
        key && `x.${key}::text = o.entity_key`,
        `x.id::text = o.entity_key`,
        no && `x.${no} = o.entity_key`,
      ]
        .filter(Boolean)
        .join(' OR ');
      return `WHEN '${t}' THEN (SELECT ${out(t)} FROM ${t} x WHERE ${match} ORDER BY x.id::text = o.entity_key DESC LIMIT 1) `;
    })
    .join('')}END`;
NO_REDUNDANT.audit_log = {
  cols: {
    entity: {
      value: `CASE o.entity ${Object.entries(TABLE_RENAME)
        .map(([o, n]) => `WHEN '${o}' THEN '${n}' `)
        .join('')}ELSE o.entity END`,
    },
  },
  add: {
    user_name: [
      { name: 'actor_email', type: 'character varying(100)' },
      { name: 'actor_role', type: 'character varying(50)' }, // app_user.user_type at the time
      { name: 'actor_department', type: 'character varying(100)' },
    ],
    module: [{ name: 'permission', type: 'text' }], // the module / right + action the actor used
    entity_key: [
      { name: 'entity_id', type: 'uuid', expr: entityLookup(() => 'x.id') },
      {
        name: 'entity_no',
        type: 'text',
        expr: entityLookup((t) => (ENTITY_NO[t] ? `x.${ENTITY_NO[t]}::text` : 'NULL::text')),
      },
    ],
    summary: [{ name: 'reason', type: 'text' }],
    meta: [
      { name: 'ip', type: 'inet' },
      { name: 'user_agent', type: 'text' },
      { name: 'session_id', type: 'text' }, // the session's identifier, never the cookie
      { name: 'request_id', type: 'text' },
      { name: 'row_hash', type: 'bytea' }, // sha256 of the row (section 9)
    ],
  },
};
// is_active mirrors record_status on these 12 tables (0 rows differ): the status is record_status
for (const t of [
  'category',
  'color',
  'customer',
  'document_attach',
  'job_type',
  'manufacturer',
  'model',
  'product',
  'product_type',
  'quotation_hd',
  'symptom',
  'app_user',
])
  NO_REDUNDANT[t] = { ...NO_REDUNDANT[t], cols: { ...NO_REDUNDANT[t]?.cols, is_active: mirrorsStatus } };
for (const [t, o] of Object.entries(NO_REDUNDANT)) {
  const m = MAPPING[t];
  for (const c of Object.keys(o.cols ?? {})) if (!(c in m.cols)) throw new Error(`NO_REDUNDANT: ${t}.${c} unknown`);
  Object.assign(m.cols, o.cols);
  m.add = { ...m.add, ...o.add };
  m.legacy = { ...m.legacy, ...o.legacy };
  m.replaced = { ...m.replaced, ...o.replaced };
}

/** old index → its name now: a unique-upgraded business number is ux_<table>_<col>; an index named after a text
 *  column 0006 replaced is named after the *_pk it reads now */
const RENAME_IDX: Record<string, string> = {
  ix_customer_code: 'ux_customer_customer_code',
  ix_product_code: 'ux_product_product_code',
  ix_model_code: 'ux_model_model_code',
  ix_job_no: 'ix_job_order_spare_part_log_job_pk',
  ix_job_log_job_no: 'ix_job_log_job_pk',
  ix_quotation_hd_customer_code: 'ix_quotation_hd_customer_pk',
  ix_quotation_hd_reference_job_no: 'ix_quotation_hd_job_pk',
  ix_quotation_dt_quotation_no: 'ix_quotation_dt_quotation_hd_pk',
  ix_inventory_dt_no: 'ix_inventory_dt_inventory_hd_pk',
  ix_inventory_dt_item: 'ix_inventory_dt_product_pk',
  ix_product_model_code: 'ix_product_model_model_pk',
  ix_job_call_log_job_no: 'ix_job_call_log_job_pk',
};
/** triggers that served a dropped column → the function that goes with them (+ why) */
const DROPPED_TRIGGERS: Record<string, string> = {
  trg_job_track_token_hash:
    'job_track_token_hash_sync() — job.track_token (raw link token) is gone: the app writes track_token_hash itself',
};
/** old index → a different definition (same name) */
const REDEFINE_IDX: Record<string, string> = {
  // (name, brand, is_active): is_active is record_status = 'ACTIVE' now — the same rule
  ix_unique_model: `CREATE UNIQUE INDEX ix_unique_model ON model USING btree (model_name, brand_pk, ((record_status)::text = 'ACTIVE'::text));`,
  // what the purge reads (services/track-otp: max_expires_at < now()), not expires_at
  ix_track_session_expires: 'CREATE INDEX ix_track_session_expires ON track_session USING btree (max_expires_at);',
};
/** indexes the app's queries need that the legacy DB never had (index audit 2026-10-30) */
const NEW_IDX: [table: string, lead: string, sql: string][] = [
  // customers.ts search (5+ digits) and the duplicate tax-id check: the same expression as cardDigits
  [
    'customer',
    'customer_card_id',
    `CREATE INDEX gin_customer_card_id_digits ON customer USING gin (regexp_replace(coalesce(customer_card_id, ''), '\\D', '', 'g') gin_trgm_ops);`,
  ],
  // customers.ts duplicate e-mail check: lower(trim(coalesce(email,''))) = …
  ['customer', 'email', `CREATE INDEX ix_customer_email_norm ON customer (lower(trim(coalesce(email, ''))));`],
  // reports.ts spare-part requests by date, newest first
  ['job_order_spare_part_log', 'request_date', `CREATE INDEX ix_job_part_request_date ON job_part (request_date, pk);`],
  // stock.ts movement search: po_no ilike '%…%'
  ['inventory_hd', 'po_no', `CREATE INDEX gin_stock_move_po_no ON stock_move USING gin (po_no gin_trgm_ops);`],
  // one agreed quotation per job (QS.AGREED / AGREED_WAIT_PAY / AGREED_WAIT_PARTS): job.approved_quotation_hd_pk is
  // no longer written — the agreed quotation IS the approved one (legacy: 0 jobs with two)
  [
    'quotation_hd',
    '',
    `CREATE UNIQUE INDEX ux_quotation_agreed_job ON quotation (job_pk) WHERE quotation_status_id IN (3, 6, 9);`,
  ],
  // a row's history by its uuid (new rows) / business number
  ['audit_log', '', `CREATE INDEX ix_audit_log_entity_id ON audit_log (entity, entity_id, at DESC);`],
  ['audit_log', '', `CREATE INDEX ix_audit_log_entity_no ON audit_log (entity_no);`],
];

// ---------------------------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------------------------
const pool = new Pool({ connectionString: URL, max: 1, options: '-c default_transaction_read_only=on' });
const q = async <T,>(sql: string) => (await pool.query(sql)).rows as T[];
type Col = { t: string; name: string; type: string; nn: boolean; def: string | null };
const cols = await q<Col>(`
  SELECT c.relname AS t, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn,
         CASE WHEN a.attidentity = '' THEN pg_get_expr(d.adbin, d.adrelid) END AS def
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY c.relname, a.attnum`);
const idx = await q<{ t: string; name: string; def: string; primary: boolean }>(`
  SELECT c.relname AS t, i.indexrelid::regclass::text AS name, pg_get_indexdef(i.indexrelid) AS def, i.indisprimary AS primary
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1, 2`);
const cons = await q<{ t: string; name: string; type: string; def: string }>(`
  SELECT conrelid::regclass::text AS t, conname AS name, contype AS type, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('c', 'f', 'u', 'x') ORDER BY 1, 2`);
const trigs = await q<{ t: string; name: string; def: string }>(`
  SELECT tgrelid::regclass::text AS t, tgname AS name, pg_get_triggerdef(oid) AS def
    FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`);
const comments = await q<{ t: string; col: string | null; text: string }>(`
  SELECT c.relname AS t, a.attname AS col, d.description AS text
    FROM pg_description d JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1, 2`);
const fn = async (name: string) =>
  (await q<{ def: string }>(`SELECT pg_get_functiondef('public.${name}()'::regprocedure) AS def`))[0].def;
const bumpDef = await fn('bump_row_version');
const mergeDef = await fn('merge_legacy_users');
await pool.end();

// ---------------------------------------------------------------------------------------------------------------
// Checks of the mapping against the catalog
// ---------------------------------------------------------------------------------------------------------------
const fail = (m: string): never => {
  throw new Error(m);
};
if (cols.some((c) => c.t === 'job' && c.name === 'pk'))
  fail('this catalog is converted already (job.pk): use a DB at 0005');
const TABLES = Object.keys(MAPPING).sort();
const catTables = [...new Set(cols.map((c) => c.t))].sort();
if (TABLES.length !== 66) fail(`mapping has ${TABLES.length} tables, expected 66`);
if (catTables.join() !== TABLES.join())
  fail(
    `catalog tables ≠ mapping: ${catTables.filter((t) => !MAPPING[t])} / ${TABLES.filter((t) => !catTables.includes(t))}`,
  );
const colsOf = (t: string) => cols.filter((c) => c.t === t);
for (const t of TABLES) {
  const have = colsOf(t)
    .map((c) => c.name)
    .filter((n) => n !== 'id');
  const want = Object.keys(MAPPING[t].cols);
  const miss = have.filter((n) => !want.includes(n));
  const extra = want.filter((n) => !have.includes(n));
  if (miss.length || extra.length) fail(`${t}: not mapped ${miss} · not in catalog ${extra}`);
  if (!colsOf(t).some((c) => c.name === 'id' && c.type === 'uuid')) fail(`${t}: no id uuid (0005 not applied?)`);
}
if (trigs.length !== 7) fail(`expected 7 triggers, found ${trigs.length}`);
const name63 = (n: string) => (n.length > 63 ? fail(`identifier too long: ${n}`) : n);

// per table: key column (old value = pk), code column, renames, new columns
type NewCol = { name: string; type: string; nn: boolean; def: string | null; expr: string };
const info: Record<
  string,
  {
    key?: string;
    code?: string;
    computed: boolean;
    rename: Map<string, string>;
    dropped: Set<string>;
    newCols: NewCol[];
  }
> = {};
for (const t of TABLES) {
  const m = MAPPING[t];
  const entries = Object.entries(m.cols);
  const key = entries.find(([, s]) => s === 'pk' || s === 'code')?.[0];
  const code = entries.find(([, s]) => s === 'code')?.[0];
  const computed = !!(m.rn || m.job);
  if (!computed && !key) fail(`${t}: no pk source`);
  info[t] = { key: computed ? undefined : key, code, computed, rename: new Map(), dropped: new Set(), newCols: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------------------------------------------
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const BP = '\n--> statement-breakpoint\n';
const out: string[] = [];
const emit = (s: string) => out.push(s.trim() + BP);
const section = (s: string) => out.push(`\n-- === ${s} ${'='.repeat(Math.max(3, 104 - s.length))}\n`);
const isText = (type: string) => /^(character varying|text|character)/.test(type);
const ORPHAN_TS = `timestamptz '2023-01-01 00:00:00+07'`;

/** rename identifiers outside quotes (and, with quoted, exact quoted names as well) */
function renameSql(sql: string, map: Map<string, string>, quoted = false): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => {
      if (i % 2) return quoted && map.has(part.slice(1, -1)) ? lit(map.get(part.slice(1, -1))!) : part;
      return part.replace(/\b[a-z_][a-z0-9_]*\b/g, (w) => map.get(w) ?? w);
    })
    .join('');
}
const identsOutsideQuotes = (sql: string) =>
  sql.split(/'(?:[^']|'')*'/).flatMap((p) => p.match(/\b[a-z_][a-z0-9_]*\b/g) ?? []);

// join plan per table: SELECT list + joins, orphan / check descriptors
type Ref = { col: string; outs: string[]; nonEmpty: string; table: string };
const refs: Ref[] = [];
const drops: { t: string; col: string; nonEmpty: string; same: string; log?: string }[] = [];
const addChecks: { t: string; name: string; check: string }[] = [];
const fks: { t: string; col: string; ref: string; refCol: string }[] = [];
/** section 6: the new value names the same row as the old one (via = compared through the parent's business number) */
const valueChecks: { t: string; col: string; to: string; ref: string; via?: string }[] = [];
/** section 1: NOT NULL relations whose old value points at no row (would fail the copy) */
const nnRels: { t: string; col: string; missing: string }[] = [];
const inserts: string[] = [];
const creates: string[] = [];
const emitted = new Set<string>();
const pkExprOf: Record<string, string> = {};
const moneyCols: string[] = [];
const order = ['job', ...TABLES.filter((t) => t !== 'job')]; // job first: text relations to it read job__new (pk computed)

for (const t of order) {
  const m = MAPPING[t];
  const I = info[t];
  const where = m.where ? m.where('o') : null;
  const joins: string[] = [];
  let n = 0;
  const join = (r: Rel, oCol: string, extra?: string): string => {
    const a = `r${++n}`;
    const T = info[r.ref] ?? fail(`${t}.${oCol}: unknown table ${r.ref}`);
    const tw = MAPPING[r.ref].where?.(a);
    const cond = [r.via ? `${a}.${r.via} = o.${oCol}` : `${a}.${T.key} = o.${oCol}`, tw, extra]
      .filter(Boolean)
      .join(' AND ');
    valueChecks.push({ t, col: oCol, to: r.to, ref: r.ref, via: r.via });
    if (r.nn) {
      const p = MAPPING[r.ref].where?.('p');
      const on = `p.${r.via ?? T.key} = o.${oCol}${p ? ` AND ${p}` : ''}`;
      nnRels.push({
        t,
        col: oCol,
        missing: `NOT EXISTS (SELECT 1 FROM ${r.ref} p WHERE ${on})${where ? ` AND ${where}` : ''}`,
      });
    }
    if (T.computed) {
      if (!r.via) fail(`${t}.${oCol}: int relation to computed-pk table ${r.ref}`);
      if (!emitted.has(r.ref)) fail(`${t}: ${r.ref}__new is filled later`);
      joins.push(`LEFT JOIN ${r.ref}__new ${a} ON ${cond}`);
      return `${a}.pk`;
    }
    joins.push(`LEFT JOIN ${r.ref} ${a} ON ${cond}`);
    return `${a}.${T.key}`;
  };
  const pkExpr = m.job
    ? `CASE WHEN o.job_no ~ '^J[0-9]{7}$' THEN substr(o.job_no, 2)::bigint
            ELSE (SELECT coalesce(max(substr(job_no, 2)::bigint), 0) FROM job WHERE job_no ~ '^J[0-9]{7}$')
                 + row_number() OVER (PARTITION BY o.job_no ~ '^J[0-9]{7}$' ORDER BY o.job_create_date, o.job_no) END`
    : m.rn
      ? `row_number() OVER (ORDER BY ${m.rn
          .split(',')
          .map((c) => `o.${c.trim()}`)
          .join(', ')})`
      : `o.${I.key}`;
  pkExprOf[t] = pkExpr;
  const relCol = (r: Rel, expr: string, src: string): NewCol => {
    fks.push({ t, col: r.to, ref: r.ref, refCol: 'pk' });
    return { name: r.to, type: 'bigint', nn: !!r.nn, def: null, expr: `${expr} /* ${src} */` };
  };
  for (const c of colsOf(t)) {
    if (c.name === 'id') continue;
    const s = m.cols[c.name];
    const nonEmpty = `o.${c.name} IS NOT NULL${isText(c.type) ? ` AND o.${c.name} <> ''` : ''}`;
    const kept = (): NewCol => ({
      name: c.name,
      type: c.type,
      nn: c.nn || s === 'code',
      def: c.def,
      expr: `o.${c.name}`,
    });
    if (s === 'k' || s === 'code') I.newCols.push(kept());
    else if (typeof s === 'object' && 'value' in s) I.newCols.push({ ...kept(), expr: s.value });
    else if (s === 'pk') I.rename.set(c.name, 'pk');
    else if ('fk' in s) {
      const T = info[s.fk];
      if (!T.code) fail(`${t}.${c.name}: ${s.fk} is not a code table`);
      const a = `r${++n}`;
      joins.push(`LEFT JOIN ${s.fk} ${a} ON ${a}.${T.code} = o.${c.name}`);
      I.newCols.push({ ...kept(), expr: `${a}.${T.code}` });
      fks.push({ t, col: c.name, ref: s.fk, refCol: T.code });
      valueChecks.push({ t, col: c.name, to: c.name, ref: s.fk });
      refs.push({ table: t, col: c.name, outs: [c.name], nonEmpty });
    } else if ('rel' in s) {
      I.newCols.push(relCol(s.rel, join(s.rel, c.name), c.name));
      I.rename.set(c.name, s.rel.to);
      refs.push({ table: t, col: c.name, outs: [s.rel.to], nonEmpty });
    } else if ('also' in s) {
      I.newCols.push(kept(), relCol(s.also, join(s.also, c.name), c.name));
      refs.push({ table: t, col: c.name, outs: [s.also.to], nonEmpty });
    } else if ('multi' in s) {
      for (const r of s.multi) {
        const e = join(r, c.name);
        I.newCols.push(relCol(r, s.when ? `CASE WHEN ${s.when} THEN ${e} END` : e, c.name));
      }
      I.dropped.add(c.name);
      refs.push({
        table: t,
        col: c.name,
        outs: s.multi.map((r) => r.to),
        nonEmpty: s.when ? `${nonEmpty} AND ${s.when}` : nonEmpty,
      });
    } else if ('cast' in s) {
      I.newCols.push({ name: s.cast, type: s.type, nn: c.nn, def: null, expr: `o.${c.name}::${s.type}` });
      I.rename.set(c.name, s.cast);
    } else if ('drop' in s) {
      I.dropped.add(c.name);
      const own = (x: string) => x.replace(/\$/g, `o.${c.name}`);
      drops.push({ t, col: c.name, nonEmpty, same: own(s.same), log: s.log && own(s.log) });
    }
    for (const a of m.add?.[c.name] ?? []) {
      I.newCols.push({ name: a.name, type: a.type, nn: !!a.nn, def: a.def ?? null, expr: a.expr ?? a.def ?? 'NULL' });
      if (a.fk) fks.push({ t, col: a.name, ref: a.fk, refCol: 'pk' });
      if (a.check) addChecks.push({ t, name: a.name, check: a.check });
    }
  }
  const all = I.newCols;
  creates.push(
    `CREATE TABLE ${t}__new (\n  pk bigint GENERATED ALWAYS AS IDENTITY,\n  id uuid NOT NULL DEFAULT uuid_generate_v7(),\n` +
      all.map((c) => `  ${c.name} ${c.type}${c.nn ? ' NOT NULL' : ''}${c.def ? ` DEFAULT ${c.def}` : ''}`).join(',\n') +
      '\n);',
  );
  inserts.push(
    `INSERT INTO ${t}__new (pk, id${all.map((c) => `, ${c.name}`).join('')})\nOVERRIDING SYSTEM VALUE\n` +
      `SELECT ${pkExpr},\n       o.id${all.map((c) => `,\n       ${c.expr}`).join('')}\n  FROM ${t} o` +
      joins.map((j) => `\n  ${j}`).join('') +
      (where ? `\n WHERE ${where}` : '') +
      ';',
  );
  emitted.add(t);
}

// ---- header + 0 ----
out.push(`-- 0006_bigint_pk — ADR 0008 phase 2: every table gets \`pk bigint GENERATED ALWAYS AS IDENTITY\` as its first column
-- (the primary key, joins and foreign keys only — never leaves the backend) and \`id uuid\` second (0005's stable ids,
-- the only id the API speaks). Relations that joined on text (job_no, quotation_no, customer_code, …) or on legacy int
-- ids become \`<role>_<table>_pk\` foreign keys ON DELETE RESTRICT; business numbers stay UNIQUE on their own table.
-- Decisions 1–13 and the column mapping: adr/0008-bigint-pk-uuid7-id.md "Phase 2 design" + adr/0008-phase2-renames.md.
--
-- GENERATED by scripts/gen-0006.mts from its mapping + the dev catalog at 0005 — edit the generator, not this file.
-- The 66 tables are REBUILT (like OneLink drizzle/0027) beside the old ones, filled, checked, and swapped in; the whole
-- file is one transaction (the migrator's): it all lands or nothing does. Every table is locked meanwhile.
--
--   pk ← the old int key (user 105 = pk 105, int relations keep their values) · job: the digits of job_no
--        (decision 8; not the job number) · text / composite / no key: row_number() over the old key
--   values pointing at no row (0 / -1 placeholders included) → NULL, the old value kept row by row in
--   legacy_orphan_ref ('' → NULL, not kept) · the -1 rows of mt_city / mt_district / mt_sub_district are not copied
--   (decision 6) · code tables keep their code column as the FK target (decision 5)
--
-- Sections: 0 guard · 1 refuse what this file does not know · 2 legacy_orphan_ref · 3 the new tables · 4 the rows ·
-- 5 orphans · 6 nothing lost · 7 swap · 8 keys, indexes, foreign keys, checks · 9 triggers, functions, RLS, comments.
-- After this file the database cannot be migrated again from a legacy reload in place: wipe + migrate
-- (scripts/migrate.ts refuses --reset once job.pk exists).
`);
section('0. Guard');
emit(`SET LOCAL statement_timeout = 0;`);
emit(`DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'job' AND column_name = 'pk') THEN
    RAISE EXCEPTION 'already converted (drizzle/0006)';
  END IF;
END $$;`);

// ---- 1 ----
section('1. Refuse to drop what this file does not know about');
const tablesArr = `ARRAY[${TABLES.map(lit).join(', ')}]`;
const colLines = TABLES.map(
  (t) =>
    `      (${lit(t)}, ${lit(
      colsOf(t)
        .map((c) => c.name)
        .join(' '),
    )})`,
).join(',\n');
const oldIdx = idx.map((i) => i.name);
emit(`DO $$
DECLARE
  tables text[] := ${tablesArr};
  found text;
BEGIN
  SELECT string_agg(polname || ' on ' || polrelid::regclass::text, ', ') INTO found FROM pg_policy;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'row level security policies this migration would drop: %', found; END IF;

  SELECT string_agg(tgname || ' on ' || tgrelid::regclass::text, ', ') INTO found
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND (tgrelid::regclass::text, tgname) NOT IN (${trigs.map((g) => `(${lit(g.t)}, ${lit(g.name)})`).join(', ')});
  IF found IS NOT NULL THEN RAISE EXCEPTION 'triggers this migration does not know how to recreate: %', found; END IF;

  SELECT string_agg(DISTINCT v.oid::regclass::text, ', ') INTO found
    FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
   WHERE d.refobjid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY (tables))
     AND v.oid <> d.refobjid AND v.oid <> 'public.view_customer'::regclass;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'views on the tables being rebuilt: %', found; END IF;

  SELECT string_agg(pr.prrelid::regclass::text, ', ') INTO found FROM pg_publication_rel pr;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'tables in a publication: %', found; END IF;

  WITH want AS (
    SELECT t AS table_name, regexp_split_to_table(c, ' ') AS column_name FROM (VALUES
${colLines}
    ) v(t, c)
  ), have AS (
    SELECT table_name::text, column_name::text FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY (tables)
  )
  SELECT string_agg(x, ', ') INTO found FROM (
    SELECT 'unknown ' || table_name || '.' || column_name AS x FROM (SELECT * FROM have EXCEPT SELECT * FROM want) a
    UNION ALL
    SELECT 'missing ' || table_name || '.' || column_name FROM (SELECT * FROM want EXCEPT SELECT * FROM have) b
  ) d;
  IF found IS NOT NULL THEN RAISE EXCEPTION 'columns not in the mapping of drizzle/0006: %', found; END IF;

  SELECT string_agg(i.indexrelid::regclass::text, ', ') INTO found
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY (tables)
     AND i.indexrelid::regclass::text <> ALL (ARRAY[${oldIdx.map(lit).join(', ')}]);
  IF found IS NOT NULL THEN RAISE EXCEPTION 'indexes this migration does not know how to recreate: %', found; END IF;
END $$;`);

const nnSql = nnRels.map(
  (r) => `  SELECT count(*) INTO c FROM ${r.t} o WHERE ${r.missing};
  IF c > 0 THEN
    SELECT string_agg(v, ', ') INTO s FROM (
      SELECT DISTINCT coalesce(o.${r.col}::text, 'NULL') AS v FROM ${r.t} o WHERE ${r.missing} ORDER BY 1 LIMIT 5) x;
    found := concat_ws('; ', found, format('%s: %s (%s)', '${r.t}.${r.col}', c, s));
  END IF;`,
);
emit(`-- relations that become NOT NULL *_pk: every old value must point at a row, or the copy below would stop on a bare
-- "null value in column …" — named here with their counts and up to 5 values
DO $$
DECLARE
  c bigint;
  s text;
  found text;
BEGIN
${nnSql.join('\n')}
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'NOT NULL relations that point at no row (fix the data or the mapping of drizzle/0006): %', found;
  END IF;
END $$;`);

// ---- 2 ----
section('2. legacy_orphan_ref');
emit(`CREATE TABLE legacy_orphan_ref (
  pk bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT uuid_generate_v7(),
  table_name varchar(63) NOT NULL,
  row_pk bigint NOT NULL,
  column_name varchar(63) NOT NULL,
  legacy_value text NOT NULL,
  CONSTRAINT legacy_orphan_ref_pkey PRIMARY KEY (pk)
);`);
emit(`CREATE UNIQUE INDEX ux_legacy_orphan_ref_id ON legacy_orphan_ref (id);`);
emit(`CREATE UNIQUE INDEX ux_legacy_orphan_ref_row ON legacy_orphan_ref (table_name, row_pk, column_name);`);
emit(`ALTER TABLE legacy_orphan_ref ENABLE ROW LEVEL SECURITY;`);
emit(
  `COMMENT ON TABLE legacy_orphan_ref IS 'drizzle/0006 (ADR 0008 decision 4): a legacy value that pointed at no row (0 / -1 placeholders included), one row per (table, row pk, old column). The new *_pk column holds NULL. No foreign keys: rows here are a record, not relations.';`,
);

// ---- 3 ----
section('3. The new tables, beside the old (no keys, indexes or references yet: their names are still taken)');
for (const c of creates) emit(c);

// ---- 4 ----
section('4. The rows (job first: text relations to a job read job__new, whose pk is computed)');
for (const s of inserts) emit(s);

// ---- 5 ----
section('5. Orphans: a value that points at no row → NULL above, kept here');
const orphanSql = (table: string, col: string, nonEmpty: string, missing: string) =>
  `  INSERT INTO legacy_orphan_ref (id, table_name, row_pk, column_name, legacy_value)
  SELECT uuid_v7_stable(${ORPHAN_TS}, ${lit(`${table}/${col}/`)} || n.pk), ${lit(table)}, n.pk, ${lit(col)}, o.${col}::text
    FROM ${table} o JOIN ${table}__new n ON n.id = o.id
   WHERE ${nonEmpty} AND ${missing}
   ORDER BY n.pk;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c > 0 THEN RAISE NOTICE '${table}.${col}: %', c; END IF;`;
emit(`DO $$
DECLARE
  c bigint;
BEGIN
${refs.map((r) => orphanSql(r.table, r.col, r.nonEmpty, r.outs.map((o) => `n.${o} IS NULL`).join(' AND '))).join('\n')}
${drops
  .filter((d) => d.log)
  .map((d) => orphanSql(d.t, d.col, d.nonEmpty, d.log!))
  .join('\n')}
END $$;`);

// ---- 6 ----
section('6. Nothing lost (any failure aborts the transaction and leaves the database as it was)');
const checks: string[] = [];
for (const t of TABLES) {
  const w = MAPPING[t].where?.('o');
  const src = `${t} o${w ? ` WHERE ${w}` : ''}`;
  checks.push(`  SELECT count(*) INTO a FROM ${src};
  SELECT count(*) INTO b FROM ${t}__new;
  IF a <> b THEN RAISE EXCEPTION '${t}: % rows before, % after', a, b; END IF;
  SELECT count(*) INTO a FROM ((SELECT o.id FROM ${src}) EXCEPT ALL (SELECT id FROM ${t}__new)) x;
  SELECT count(*) INTO b FROM ((SELECT id FROM ${t}__new) EXCEPT ALL (SELECT o.id FROM ${src})) x;
  IF a + b > 0 THEN RAISE EXCEPTION '${t}: id sets differ (% / %)', a, b; END IF;`);
}
for (const r of refs) {
  const w = MAPPING[r.table].where?.('o');
  checks.push(`  SELECT count(*) INTO a FROM ${r.table} o WHERE ${r.nonEmpty}${w ? ` AND ${w}` : ''};
  SELECT count(*) INTO b FROM ${r.table}__new WHERE ${r.outs.map((o) => `${o} IS NOT NULL`).join(' OR ')};
  SELECT count(*) INTO c FROM legacy_orphan_ref WHERE table_name = '${r.table}' AND column_name = '${r.col}';
  IF a <> b + c THEN RAISE EXCEPTION '${r.table}.${r.col}: % before, % after + % orphans', a, b, c; END IF;`);
}
// ids stay with their rows: the new row a legacy row became (its pk, computed as in section 4) has the old row's id —
// what keeps URLs / bookmarks stable across reloads (0005's stable ids)
for (const t of TABLES) {
  const w = MAPPING[t].where?.('o');
  checks.push(`  SELECT count(*) INTO a FROM (SELECT ${pkExprOf[t]} AS pk, o.id FROM ${t} o${w ? ` WHERE ${w}` : ''}) x
    JOIN ${t}__new n USING (pk) WHERE n.id IS DISTINCT FROM x.id;
  IF a > 0 THEN RAISE EXCEPTION '${t}: % rows changed id', a; END IF;`);
}
checks.push(`  SELECT count(*) INTO a FROM legacy_orphan_ref
   WHERE id IS DISTINCT FROM uuid_v7_stable(${ORPHAN_TS}, table_name || '/' || column_name || '/' || row_pk);
  IF a > 0 THEN RAISE EXCEPTION 'legacy_orphan_ref: % ids not uuid_v7_stable(2023-01-01, table/column/row_pk)', a; END IF;`);
// a dropped column held nothing another column / relation does not (no redundant data, owner 2026-10-30)
for (const d of drops) {
  const w = MAPPING[d.t].where?.('o');
  checks.push(`  SELECT count(*) INTO a FROM ${d.t} o WHERE NOT coalesce(${d.same}, false)${w ? ` AND ${w}` : ''};
  IF a > 0 THEN RAISE EXCEPTION '${d.t}.${d.col} is dropped, but % rows hold a value nothing else holds', a; END IF;`);
}
// what a new column was filled with
for (const a of addChecks) {
  checks.push(`  SELECT count(*) INTO a FROM ${a.t} o JOIN ${a.t}__new n ON n.id = o.id WHERE NOT coalesce(${a.check}, false);
  IF a > 0 THEN RAISE EXCEPTION '${a.t}.${a.name}: % rows filled wrong', a; END IF;`);
}
// money and quantities are never recomputed or changed (owner 2026-10-30): every numeric column, and every integer
// one named like a quantity / price / amount / cost, holds exactly the old value on every row
const MONEY = /(qty|quantity|price|amount|cost|discount|total|vat|rate)/;
for (const t of TABLES) {
  const money = colsOf(t).filter(
    (c) =>
      MAPPING[t].cols[c.name] === 'k' &&
      (/^(numeric|double precision|real|money)/.test(c.type) ||
        (/^(integer|smallint|bigint)$/.test(c.type) && MONEY.test(c.name))),
  );
  if (!money.length) continue;
  checks.push(`  SELECT count(*) INTO a FROM ${t} o JOIN ${t}__new n ON n.id = o.id
   WHERE ${money.map((c) => `n.${c.name} IS DISTINCT FROM o.${c.name}`).join('\n      OR ')};
  IF a > 0 THEN RAISE EXCEPTION '${t}: money / quantity changed on % rows', a; END IF;`);
  moneyCols.push(...money.map((c) => `${t}.${c.name}`));
}
{
  const kept = colsOf('audit_log').filter((c) => MAPPING.audit_log.cols[c.name] === 'k');
  checks.push(`  SELECT count(*) INTO a FROM audit_log o JOIN audit_log__new n ON n.id = o.id
   WHERE ${kept.map((c) => `n.${c.name} IS DISTINCT FROM o.${c.name}`).join(' OR ')}
      OR n.app_user_pk IS DISTINCT FROM o.user_id AND NOT EXISTS (SELECT 1 FROM legacy_orphan_ref r WHERE r.table_name = 'audit_log' AND r.row_pk = n.pk)
      OR n.entity IS DISTINCT FROM ${(MAPPING.audit_log.cols.entity as { value: string }).value};
  IF a > 0 THEN RAISE EXCEPTION 'audit_log: % rows not copied as they were', a; END IF;
  SELECT count(*) FILTER (WHERE entity_id IS NOT NULL), count(*) FILTER (WHERE entity_no IS NOT NULL), count(*) INTO a, b, c FROM audit_log__new;
  RAISE NOTICE 'audit_log: entity_id found for % rows, entity_no for %, of %', a, b, c;`);
}
checks.push(`  SELECT count(*) INTO a FROM audit_log o JOIN audit_log__new n ON n.id = o.id WHERE n.entity <> o.entity;
  IF a > 0 THEN RAISE NOTICE 'audit_log.entity: % rows name a renamed table, now by its new name', a; END IF;`);
// values, not only counts: a *_pk names the row the old value named
for (const v of valueChecks) {
  const differs = v.via
    ? `JOIN ${v.ref}__new p ON p.pk = n.${v.to} WHERE p.${v.via} IS DISTINCT FROM o.${v.col}`
    : `WHERE n.${v.to} IS NOT NULL AND n.${v.to} IS DISTINCT FROM o.${v.col}`;
  checks.push(`  SELECT count(*) INTO a FROM ${v.t} o JOIN ${v.t}__new n ON n.id = o.id ${differs};
  IF a > 0 THEN RAISE EXCEPTION '${v.t}.${v.col} → ${v.to}: % rows name another ${v.ref} than before', a; END IF;`);
}
emit(`DO $$
DECLARE
  a bigint;
  b bigint;
  c bigint;
BEGIN
${checks.join('\n')}
END $$;`);

// ---- 7 ----
section('7. The swap, and the new names');
emit(`-- CHECKs (verbatim: NOT VALID stays NOT VALID — ck_inventory_dt_qty), grants and FORCE RLS as the old table had
-- them: copied from the live table, so a database that differs from the migrations (0031 adds a check only where no row
-- breaks it) keeps exactly what it had
DO $$
DECLARE
  t text;
  g record;
BEGIN
  FOREACH t IN ARRAY ${tablesArr} LOOP
    FOR g IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = format('public.%I', t)::regclass AND contype = 'c' LOOP
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', t || '__new', g.conname, g.def);
    END LOOP;
    FOR g IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = t || '__new' AND grantee <> current_user LOOP
      EXECUTE format('REVOKE ALL ON %I FROM %s', t || '__new', CASE WHEN g.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee) END);
    END LOOP;
    FOR g IN SELECT grantee, privilege_type FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = t AND grantee <> current_user LOOP
      EXECUTE format('GRANT %s ON %I TO %s', g.privilege_type, t || '__new', CASE WHEN g.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee) END);
    END LOOP;
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t || '__new');
    END IF;
  END LOOP;
END $$;`);
emit(`DROP VIEW view_customer; -- unused (decision 10)`);
emit(`-- one statement: the foreign keys between the old tables go with them; triggers, indexes, owned sequences too
DROP TABLE ${TABLES.join(', ')};`);
const pairs = TABLES.map((t) => `(${lit(t)}, ${lit(tn(t))})`).join(',\n      ');
emit(`-- <old>__new → the table's name (new where it was renamed), its identity sequence → <table>_pk_seq, identity after
-- the highest pk, and CHECKs named after an old table (ck_<old>_…) → ck_<new>_…
DO $$
DECLARE
  r record;
  c record;
  next bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ${pairs}
    ) v(old, new) LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', r.old || '__new', r.new);
    EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', r.old || '__new_pk_seq', r.new || '_pk_seq');
    EXECUTE format('SELECT coalesce(max(pk), 0) + 1 FROM %I', r.new) INTO next;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN pk RESTART WITH %s', r.new, next);
    IF r.old <> r.new THEN
      FOR c IN SELECT conname FROM pg_constraint
                WHERE conrelid = format('public.%I', r.new)::regclass AND contype = 'c' AND conname LIKE 'ck\\_' || r.old || '\\_%' LOOP
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.new, c.conname, 'ck_' || r.new || substr(c.conname, length(r.old) + 4));
      END LOOP;
    END IF;
  END LOOP;
END $$;`);
const colRenames: string[] = [];
for (const t of TABLES) {
  const finals = info[t].newCols.map((c) => fin(t, c.name));
  if (new Set(finals).size !== finals.length) fail(`${tn(t)}: two columns end up with one name`);
  for (const c of info[t].newCols)
    if (fin(t, c.name) !== c.name)
      colRenames.push(`ALTER TABLE ${tn(t)} RENAME COLUMN ${c.name} TO ${fin(t, c.name)};`);
}
emit(`-- columns named after an old table, or misspelt
${colRenames.join('\n')}`);

// ---- 8 ----
section('8. Keys, indexes, references, checks');
const idxNames = new Set<string>();
const idxLeading = new Set<string>(); // "t.col" (old table, mapped column) of every index's first column
const add = (t: string, name: string, sql: string, lead?: string) => {
  if (idxNames.has(name)) fail(`index name twice: ${name}`);
  idxNames.add(name63(name));
  if (lead) idxLeading.add(`${t}.${lead}`);
  emit(sql);
};
/** old column → its final name (mapping, then naming) */
const finalMap = (t: string) => {
  const m = new Map<string, string>();
  for (const c of colsOf(t)) m.set(c.name, fin(t, info[t].rename.get(c.name) ?? c.name));
  for (const c of info[t].newCols) m.set(c.name, fin(t, c.name));
  return m;
};
const replacedAll: Record<string, string> = {};
for (const t of TABLES) {
  const I = info[t];
  const m = MAPPING[t];
  const T = tn(t);
  const F = finalMap(t);
  emit(`ALTER TABLE ${T} ADD CONSTRAINT ${T}_pkey PRIMARY KEY (pk);`);
  idxNames.add(`${T}_pkey`);
  idxLeading.add(`${t}.pk`);
  add(t, `ux_${T}_id`, `CREATE UNIQUE INDEX ux_${T}_id ON ${T} (id);`, 'id');
  for (const i of idx.filter((x) => x.t === t)) {
    if (i.name === `ux_${t}_id`) continue;
    if (i.primary) {
      // the old primary key: dropped with its column, or (code / text / composite key) UNIQUE now
      const colsList = i.def
        .match(/\(([^)]*)\)$/)![1]
        .split(',')
        .map((s) => s.trim());
      if (colsList.some((c) => I.rename.get(c) === 'pk')) continue;
      if (colsList.some((c) => I.dropped.has(c))) fail(`${t}: old primary key on a dropped column`);
      const nc = colsList.map((c) => I.rename.get(c) ?? c);
      const fc = colsList.map((c) => F.get(c)!);
      add(
        t,
        `ux_${T}_${fc.join('_')}`,
        `CREATE UNIQUE INDEX ux_${T}_${fc.join('_')} ON ${T} (${fc.join(', ')});`,
        nc[0],
      );
      continue;
    }
    if (m.replaced?.[i.name]) {
      replacedAll[i.name] = m.replaced[i.name];
      continue;
    }
    const body = i.def.replace(/^.* USING /, '');
    const lost = identsOutsideQuotes(body).filter((w) => I.dropped.has(w));
    if (lost.length && !REDEFINE_IDX[i.name]) fail(`${t}: index ${i.name} reads dropped ${lost} — add it to replaced`);
    const name = fx(RENAME_IDX[i.name] ?? i.name);
    let sql =
      REDEFINE_IDX[i.name] ??
      `${renameSql(i.def.replace(/^(CREATE (UNIQUE )?INDEX) \w+ ON public\.\w+ USING /, `$1 ${name} ON ${T} USING `), F)};`;
    const lead = I.rename.get(body.match(/^\w+ \(([a-z_]+)/)?.[1] ?? '') ?? body.match(/^\w+ \(([a-z_]+)/)?.[1];
    if (lead && m.unique?.includes(lead) && /^CREATE INDEX \w+ ON \w+ USING btree \(\w+\);$/.test(sql)) {
      sql = sql.replace('CREATE INDEX', 'CREATE UNIQUE INDEX'); // business number (decision 2)
    }
    add(t, name, sql, lead || undefined);
  }
  for (const u of m.unique ?? []) {
    const f = F.get(u)!;
    if (!idxLeading.has(`${t}.${u}`)) add(t, `ux_${T}_${f}`, `CREATE UNIQUE INDEX ux_${T}_${f} ON ${T} (${f});`, u);
  }
  for (const c of I.newCols.filter((c) => c.name.endsWith('_pk'))) {
    const f = fin(t, c.name);
    if (!idxLeading.has(`${t}.${c.name}`)) add(t, `ix_${T}_${f}`, `CREATE INDEX ix_${T}_${f} ON ${T} (${f});`, c.name);
  }
}
for (const [table, lead, sql] of NEW_IDX) add(table, sql.match(/INDEX (\w+) ON/)![1], sql, lead || undefined);
for (const [old, by] of Object.entries(replacedAll))
  for (const n of by.split(' + '))
    if (by !== 'nothing' && !idxNames.has(fx(n))) fail(`${old} replaced by ${fx(n)}, which is not created`);
for (const n of [...Object.keys(RENAME_IDX), ...Object.keys(REDEFINE_IDX), ...Object.keys(FINAL_IDX)])
  if (!idx.some((i) => i.name === n)) fail(`RENAME_IDX / REDEFINE_IDX / FINAL_IDX: no old index ${n}`);
out.push(`-- old indexes not recreated as such (the column they read is gone, or another index is the same):
${Object.entries(replacedAll)
  .map(([o, b]) => `--   ${o} → ${b === 'nothing' ? b : b.split(' + ').map(fx).join(' + ')}`)
  .join('\n')}
-- renamed: ${idx
  .filter((i) => !i.primary && !replacedAll[i.name] && fx(RENAME_IDX[i.name] ?? i.name) !== i.name)
  .map((i) => `${i.name} → ${fx(RENAME_IDX[i.name] ?? i.name)}`)
  .join(', ')}
-- redefined: ${Object.keys(REDEFINE_IDX).join(', ')}
`);
for (const f of fks) {
  const col = fin(f.t, f.col);
  const refCol = f.refCol === 'pk' ? 'pk' : fin(f.ref, f.refCol);
  emit(
    `ALTER TABLE ${tn(f.t)} ADD CONSTRAINT ${name63(`fk_${tn(f.t)}_${col}`)} FOREIGN KEY (${col}) REFERENCES ${tn(f.ref)} (${refCol}) ON DELETE RESTRICT;`,
  );
}
for (const c of cons.filter((x) => x.type === 'c')) {
  const F = finalMap(c.t);
  if (renameSql(c.def, F) !== c.def || identsOutsideQuotes(c.def).some((w) => info[c.t].dropped.has(w)))
    fail(`${c.t}.${c.name} reads a renamed column — section 7 copies checks verbatim`);
}
for (const c of cons.filter((x) => x.type === 'u' || x.type === 'x')) fail(`unhandled constraint ${c.t}.${c.name}`);

// ---- 9 ----
section('9. Triggers, functions, row level security, comments, the legacy boundary');
const bump = bumpDef.replace(`'status_changed_by']`, `'status_changed_by_app_user_pk']`);
if (bump === bumpDef) fail('bump_row_version: ignore list not found');
emit(`-- the columns every status change writes are ignored by name: status_changed_by is status_changed_by_app_user_pk now
${bump};`);
emit(`-- row_hash: sha256 of the row as written (every column but row_hash), set BEFORE INSERT — what a later change to a
-- row would contradict. Each row on its own, no chain: a chain (each hash over the previous) would serialize every
-- write of the system on one row lock.
CREATE FUNCTION log_row_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_hash := sha256(convert_to((to_jsonb(NEW) - 'row_hash')::text, 'UTF8'));
  RETURN NEW;
END $$;`);
emit(`CREATE FUNCTION log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;`);
emit(`-- the copied rows: hashed now (before the append-only trigger exists) — the hash proves "unchanged since drizzle/0006"
UPDATE audit_log SET row_hash = sha256(convert_to((to_jsonb(audit_log) - 'row_hash')::text, 'UTF8'));`);
emit(`CREATE TRIGGER trg_audit_log_row_hash BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION log_row_hash();`);
for (const g of trigs) {
  const dropped = info[g.t].dropped;
  // a dropped column in a row-version trigger's ignore list: just not listed any more
  const def = g.def.replace(/'(\w+)'(, )?/g, (all, col) => (dropped.has(col) ? '' : all)).replace(/, \)$/, ')');
  if (identsOutsideQuotes(def).some((w) => dropped.has(w))) {
    if (!DROPPED_TRIGGERS[g.name]) fail(`trigger ${g.name} reads a dropped column`);
    emit(`-- ${g.name} is gone with the column it served; ${DROPPED_TRIGGERS[g.name]}
DROP FUNCTION ${DROPPED_TRIGGERS[g.name].split(' ')[0]};`);
    continue;
  }
  emit(
    renameSql(
      def
        .replace(/^CREATE TRIGGER (\w+) /, (_, n) => `CREATE TRIGGER ${fx(n)} `)
        .replace(` ON public.${g.t} `, ` ON ${tn(g.t)} `),
      finalMap(g.t),
      true,
    ) + ';',
  );
}
const merge = mergeDef.replace(/\b(u|s)\.user_id\b/g, '$1.pk').replace(' is_active = false,', ''); // is_active is gone
if (merge === mergeDef || /\b(user_id|is_active)\b/.test(merge))
  fail('merge_legacy_users: user_id / is_active not rewritten');
emit(`-- legacy user_id = pk
${merge};`);
emit(`REVOKE EXECUTE ON FUNCTION merge_legacy_users() FROM PUBLIC;`);
const revokeSupabase = (what: string) => `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ${what} FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ${what} FROM authenticated';
  END IF;
END $$;`;
emit(revokeSupabase('FUNCTION merge_legacy_users()'));
for (const t of TABLES) emit(`ALTER TABLE ${tn(t)} ENABLE ROW LEVEL SECURITY;`);
for (const c of comments) {
  if (c.col && info[c.t].dropped.has(c.col)) continue;
  const target = c.col ? `COLUMN ${tn(c.t)}.${finalMap(c.t).get(c.col)}` : `TABLE ${tn(c.t)}`;
  emit(`COMMENT ON ${target} IS ${lit(c.text)};`);
}
for (const t of TABLES)
  for (const [col, via] of Object.entries(MAPPING[t].legacy ?? {})) {
    const c = info[t].newCols.find((x) => x.name === col) ?? fail(`legacy: ${t}.${col} is not a column`);
    if (c.nn) fail(`legacy: ${t}.${col} must be nullable`);
    emit(`COMMENT ON COLUMN ${tn(t)}.${fin(t, col)} IS ${lit(`legacy snapshot — new rows NULL, read via ${via}`)};`);
  }
emit(
  `COMMENT ON COLUMN job.pk IS 'Internal key (drizzle/0006: the digits of job_no for legacy jobs, the identity after). NOT the job number — that is job_no.';`,
);
const RETENTION =
  'retention: forever for now — owner to decide (suggested: audit forever, security_log 1 year under PDPA)';
emit(
  `COMMENT ON TABLE audit_log IS ${lit(`What staff changed: actor as at the time (actor_* — NULL on rows older than drizzle/0006 when they never recorded it), entity by uuid / business number, row_hash per row. Append-only. ${RETENTION}.`)};`,
);
emit(`-- sign-ins, refusals, role / permission / status changes, exports and prints (owner 2026-10-30, round 3)
CREATE TABLE security_log (
  pk bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT uuid_generate_v7(),
  at timestamp without time zone NOT NULL, -- as audit_log.at: Thai wall clock (ADR 0001), written by the app
  event varchar(20) NOT NULL,
  result varchar(10) NOT NULL,
  actor_pk bigint,
  actor_name varchar(100),
  actor_email varchar(100),
  actor_role varchar(50),
  actor_department varchar(100),
  ip inet,
  user_agent text,
  session_id text,
  request_id text,
  module varchar(50),
  permission text,
  entity varchar(50),
  entity_id uuid,
  entity_no text,
  detail jsonb,
  row_hash bytea,
  CONSTRAINT security_log_pkey PRIMARY KEY (pk),
  CONSTRAINT ck_security_log_event CHECK (event IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'DENIED', 'ROLE_CHANGE', 'PERMISSION_CHANGE', 'USER_STATUS', 'EXPORT', 'PRINT')),
  CONSTRAINT ck_security_log_result CHECK (result IN ('OK', 'DENIED', 'FAILED')),
  CONSTRAINT fk_security_log_actor_pk FOREIGN KEY (actor_pk) REFERENCES app_user (pk) ON DELETE RESTRICT
);`);
emit(`CREATE UNIQUE INDEX ux_security_log_id ON security_log (id);`);
emit(`CREATE INDEX ix_security_log_at ON security_log (at);`);
emit(`CREATE INDEX ix_security_log_actor ON security_log (actor_pk, at);`);
emit(`CREATE INDEX ix_security_log_event ON security_log (event, at);`);
emit(`ALTER TABLE security_log ENABLE ROW LEVEL SECURITY;`);
emit(revokeSupabase('TABLE security_log'));
emit(
  `CREATE TRIGGER trg_security_log_row_hash BEFORE INSERT ON security_log FOR EACH ROW EXECUTE FUNCTION log_row_hash();`,
);
emit(
  `CREATE TRIGGER trg_security_log_readonly BEFORE DELETE OR UPDATE ON security_log FOR EACH ROW EXECUTE FUNCTION log_append_only();`,
);
emit(
  `CREATE TRIGGER trg_security_log_no_truncate BEFORE TRUNCATE ON security_log FOR EACH STATEMENT EXECUTE FUNCTION log_append_only();`,
);
emit(
  `COMMENT ON TABLE security_log IS ${lit(`Security events: sign-in / failed sign-in / sign-out, refusals, role / permission / user status changes, exports, prints — actor as at the time. Append-only. LOGIN rows written before drizzle/0006 stay in audit_log. ${RETENTION}.`)};`,
);
emit(`-- rows with pk <= max_pk came from the legacy system: the app locks their money / quantity fields (owner 2026-10-30)
CREATE TABLE legacy_boundary (
  pk bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL DEFAULT uuid_generate_v7(),
  table_name varchar(63) NOT NULL,
  max_pk bigint NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_boundary_pkey PRIMARY KEY (pk)
);`);
emit(`CREATE UNIQUE INDEX ux_legacy_boundary_id ON legacy_boundary (id);`);
emit(`CREATE UNIQUE INDEX ux_legacy_boundary_table_name ON legacy_boundary (table_name);`);
emit(`ALTER TABLE legacy_boundary ENABLE ROW LEVEL SECURITY;`);
emit(revokeSupabase('TABLE legacy_boundary'));
// id: stable like legacy_orphan_ref's (the same table gets the same id on every reload)
emit(`INSERT INTO legacy_boundary (id, table_name, max_pk)
SELECT uuid_v7_stable(${ORPHAN_TS}, 'legacy_boundary/' || x.t), x.t, x.m FROM (
${TABLES.map((t) => `  SELECT ${lit(tn(t))} AS t, coalesce(max(pk), 0) AS m FROM ${tn(t)}`).join('\n  UNION ALL\n')}
) x
ORDER BY 2;`);
emit(`-- fixed once written: it decides which rows' money is locked — no insert, update, delete or truncate after this
CREATE FUNCTION legacy_boundary_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy_boundary is fixed by drizzle/0006';
END $$;`);
emit(
  `CREATE TRIGGER trg_legacy_boundary_readonly BEFORE INSERT OR UPDATE OR DELETE ON legacy_boundary FOR EACH ROW EXECUTE FUNCTION legacy_boundary_readonly();`,
);
emit(
  `CREATE TRIGGER trg_legacy_boundary_no_truncate BEFORE TRUNCATE ON legacy_boundary FOR EACH STATEMENT EXECUTE FUNCTION legacy_boundary_readonly();`,
);
// trigger functions run as the trigger's table owner whoever writes: nobody else needs EXECUTE (like merge_legacy_users)
for (const f of ['log_row_hash()', 'log_append_only()', 'legacy_boundary_readonly()']) {
  emit(`REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC;`);
  emit(revokeSupabase(`FUNCTION ${f}`));
}
emit(
  `COMMENT ON TABLE legacy_boundary IS 'drizzle/0006: the highest pk each table had when the legacy data was converted. A row with pk <= max_pk came from the legacy system — its money / quantity fields are locked (owner 2026-10-30).';`,
);
emit(`ANALYZE;`);

// GEN_MAP=<file>: the old → new name map as JSON (adr/0008-phase2-renames.md, the drizzle schema)
if (process.env.GEN_MAP)
  writeFileSync(
    process.env.GEN_MAP,
    JSON.stringify(
      TABLES.map((t) => ({
        old: t,
        new: tn(t),
        cols: colsOf(t).map((c) => {
          const mid = info[t].dropped.has(c.name) ? null : (info[t].rename.get(c.name) ?? c.name);
          return { legacy: c.name, mid, final: mid && mid !== 'pk' ? fin(t, mid) : mid };
        }),
        newCols: info[t].newCols.map((c) => ({ mid: c.name, final: fin(t, c.name), type: c.type, nn: c.nn })),
      })),
      null,
      1,
    ),
  );
writeFileSync(OUT, out.join('').replace(/\n--> statement-breakpoint\n$/, '\n'));
console.log(
  `${OUT}: ${TABLES.length} tables, ${refs.length} relations, ${fks.length} foreign keys, ${idxNames.size} indexes`,
);
