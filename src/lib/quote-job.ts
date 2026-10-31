import { JS, QS } from '@/lib/status-ids';

/**
 * A quotation saved as sent / agreed moves its job forward, never back. The one copy of the
 * rule: followQuotation (src/server/services/jobs.ts) applies it, the quotation page says when it won't.
 */
/** [quotation_status id, its name, the job_status id it moves the job to]; any other status leaves the job alone
 *  (declined / cancelled / expired / waiting) */
const MOVES: [number, string, number][] = [
  [QS.SENT, 'เสนอราคาแล้ว', JS.QUOTED],
  [QS.AGREED, 'ลูกค้าตกลงซ่อม', JS.CUSTOMER_AGREED],
  [QS.AGREED_WAIT_PAY, 'ลูกค้าตกลงซ่อม รอชำระเงิน', JS.CUSTOMER_AGREED],
  [QS.AGREED_WAIT_PARTS, 'ลูกค้าตกลงซ่อม รออะไหล่', JS.WAIT_PARTS],
];
/** quotation status name → job_status id (the page has the name) */
export const QUOTE_MOVES: Partial<Record<string, number>> = Object.fromEntries(MOVES.map(([, name, to]) => [name, to]));
/** quotation_status id → job_status id (the server has the id) */
export const QUOTE_MOVES_BY_ID: Partial<Record<number, number>> = Object.fromEntries(
  MOVES.map(([id, , to]) => [id, to]),
);
/** job_status id → how far it is in the quotation part of the flow (new / in progress 0, waiting for a quote /
 *  quote expired 1, quoted 2, customer agreed 3, waiting for parts 4); only a job at a smaller step moves. Any
 *  other status (repair under way, parts, out-source, repaired, closed, cancelled) is never moved by a quotation. */
export const QUOTE_STEP: Partial<Record<number, number>> = {
  [JS.NEW]: 0,
  [JS.IN_PROGRESS]: 0,
  [JS.WAIT_QUOTE]: 1,
  [JS.QUOTE_EXPIRED]: 1,
  [JS.QUOTED]: 2,
  [JS.CUSTOMER_AGREED]: 3,
  [JS.WAIT_PARTS]: 4,
};

/** "the job stays where it is" note for a quotation saved as `status`; '' when it moves (or is already there) */
export function quoteJobNote(status: string, job: { no: string; statusId: number; status: string } | null) {
  const target = QUOTE_MOVES[status.trim()];
  if (!job || target === undefined || job.statusId === target) return '';
  const from = QUOTE_STEP[job.statusId];
  if (from !== undefined && from < QUOTE_STEP[target]!) return '';
  return `สถานะงาน ${job.no} ไม่เปลี่ยน — งานอยู่ที่ "${job.status.trim()}" แล้ว (ไม่ถอยสถานะกลับ)`;
}
