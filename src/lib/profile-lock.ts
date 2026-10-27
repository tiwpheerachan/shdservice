import { AS, QS } from '@/lib/status-ids';

/** the documents that carry "ออกเอกสารในนาม" (document_profile_id) */
export type DocumentKind = 'job' | 'quotation' | 'sale_order';
export const DOC_MODULE: Record<DocumentKind, 'Job Management' | 'Quotation' | 'Sale Order'> = {
  job: 'Job Management',
  quotation: 'Quotation',
  sale_order: 'Sale Order',
};

/** quotation statuses the customer's answer (or a cancel) has closed: agreed (any kind), declined, cancelled.
 *  Waiting / sent / expired are still in play — a re-quote may go out under another letterhead. */
export const QUOTE_FINAL = new Set<number>([
  QS.AGREED,
  QS.AGREED_WAIT_PAY,
  QS.AGREED_WAIT_PARTS,
  QS.DECLINED,
  QS.CANCELLED,
]);

const FIXED = 'เปลี่ยนออกเอกสารในนามไม่ได้';

/**
 * Why "ออกเอกสารในนาม" of a saved document can no longer change ('' = it can): a sale order approved / denied /
 * cancelled, a quotation in a final status (QUOTE_FINAL) or deleted, a closed job (status group Finished) — what
 * the customer got stays as printed (owner 2026-10-27). POST /api/documents/profile refuses with this text (409);
 * the screens disable the choice with it.
 */
export function profileLock(
  kind: DocumentKind,
  s: { statusId?: number | null; cancelled?: boolean; closed?: boolean },
): string {
  if (kind === 'sale_order') {
    if (s.cancelled) return `ใบสั่งขายนี้ยกเลิกแล้ว — ${FIXED}`;
    if (s.statusId === AS.APPROVED) return `ใบสั่งขายนี้อนุมัติแล้ว — ${FIXED}`;
    if (s.statusId === AS.DENIED) return `ใบสั่งขายนี้ถูกปฏิเสธแล้ว — ${FIXED}`;
  } else if (kind === 'quotation') {
    if (s.cancelled) return `ใบเสนอราคานี้ถูกลบแล้ว — ${FIXED}`;
    if (QUOTE_FINAL.has(s.statusId ?? 0)) return `ใบเสนอราคานี้ปิดแล้ว (ลูกค้าตกลง / ไม่ตกลง / ยกเลิก) — ${FIXED}`;
  } else if (s.closed) return `งานนี้ปิดแล้ว — ${FIXED}`;
  return '';
}
