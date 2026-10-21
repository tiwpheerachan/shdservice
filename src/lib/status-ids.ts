/**
 * Row ids of the legacy status / type tables — one source for server, client and lib code.
 * Pure constants (no imports), so any module can use them without the import cycles the service
 * modules would cause (stock.ts ↔ sale-orders.ts, lib ↔ server-only). Verified against the dump.
 */

/** job_status.job_status_id */
export const JS = {
  CANCELLED: 0,
  NEW: 1,
  IN_PROGRESS: 2,
  WAIT_PARTS: 3,
  QUOTED: 4,
  REPAIRED: 5,
  REPAIR_CANCELLED: 6,
  CLOSED_WAIT_TRACKING: 7,
  CLOSED_TRACKED: 8,
  REPAIRED_PAID: 9,
  PARTS_ISSUED: 10,
  PARTS_REQUESTED: 11,
  CUSTOMER_AGREED: 12,
  WAIT_QUOTE: 13,
  OUTSOURCE_SENT: 14,
  OUTSOURCE_RECEIVED: 15,
  QUOTE_EXPIRED: 16,
  RETURNED_TO_STOCK: 17,
  SWAP_ISSUED: 18,
  REFUND_PAID: 19,
  COMPLETE: 20,
  CLOSED_REFUND: 21,
  REPAIRED_NO_FAULT: 22,
  CLOSED_OUTSOURCE: 23,
  CLOSED_WAIT_PICKUP: 24,
} as const;

/** job_status.job_status_group values */
export const JOB_GROUP = { PENDING: 'Pending', REPAIRED: 'Repaired', FINISHED: 'Finished', CANCEL: 'Cancel' } as const;

/** quotation_status.quotation_status_id */
export const QS = {
  WAIT: 1,
  SENT: 2,
  AGREED: 3,
  DECLINED: 4,
  CANCELLED: 5,
  AGREED_WAIT_PAY: 6,
  EXPIRED: 8,
  AGREED_WAIT_PARTS: 9,
} as const;

/** sale_out_hd.approve_status_id */
export const AS = { DRAFT: 1, WAIT: 2, REJECT: 3, APPROVED: 4, DENIED: 5 } as const;

/** inventory_type ids */
export const INV = {
  RECEIVE: 1, // รับเข้า
  RETURN_FROM_JOB: 2, // รับคืนจากการเบิก
  OUT_JOB: 3, // จ่ายออกตามงานซ่อม
  OUT_SALE: 4, // จ่ายออกตามใบสั่งขาย
  OUT_OTHER: 5, // จ่ายออกอื่นๆ
} as const;

/** job_order_spare_part_log.order_status_id */
export const PART = { REQUESTED: 1, RETURN_REQUESTED: 2, GRANTED: 3, CANCELLED: 4, RETURNED: 5 } as const;

/** the one store / condition / unit every stock row uses (store_location 1 คลังสินค้าดี, condition 1 สินค้าใหม่) */
export const STORE_LOCATION_ID = 1;
export const STORE_LOCATION_NAME = 'คลังสินค้าดี';
export const CONDITION_ID = 1;
export const ITEM_UNIT = 'Pcs.';
