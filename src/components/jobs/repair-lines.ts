import type { Tone } from '@/components/ui/badge';
import { baht } from '@/lib/utils';
import { partCharge, partsNotIssuedMsg, partsWaitingMsg } from '@/lib/validation/job';

/** ซ่อมเสร็จ / ซ่อมเสร็จ (ชำระเงินแล้ว) — refused while a part requested from stock is not issued (setStatus) */
const REPAIRED = ['ซ่อมเสร็จ', 'ซ่อมเสร็จ (ชำระเงินแล้ว)'];
/** ลูกค้าไม่ซ่อม / ไม่พบอาการเสีย — refused the same way, the part line has to be cancelled first (setStatus) */
const NO_REPAIR = ['ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)', 'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)'];
/** a line not ticked เบิก: priced in the quotation only, stock is not asked for it */
const QUOTE_ONLY = 'เสนอ (ยังไม่เบิก)';

export type Line = {
  id: number;
  logId?: string;
  code: string;
  name: string;
  price: number;
  aPick: boolean;
  aQuote: boolean;
  aQty: number;
  bPick: boolean;
  bQuote: boolean;
  bQty: number;
  status: string;
  total?: number; // the stored line total (what the job is charged for it)
  locked?: boolean; // already issued / returned — read-only
  /** read-only but may still be removed (= cancelled): a legacy line nothing was issued from (its qty / price are System Admin's) */
  cancellable?: boolean;
  /** partly issued (เบิกบางส่วน): only แบบ A's qty, down to `granted` at least (saveRepair cancels the rest) */
  issued?: { granted: number; requested: number };
  waiting?: boolean; // requested from stock (เบิก) and not all issued yet
};

export const chargeOf = (l: Line) => partCharge({ pick: l.aPick, quote: l.aQuote, qty: l.aQty }, l.price);

export const planOf = (l: Line, k: 'a' | 'b') =>
  k === 'a' ? { pick: l.aPick, quote: l.aQuote, qty: l.aQty } : { pick: l.bPick, quote: l.bQuote, qty: l.bQty };

/** ticking เบิก / เสนอ of a plan with no Qty starts it at 1 (as a new line's แบบ A) — ticked at 0 it would save nothing */
export function tickPlan(l: Line, k: 'a' | 'b', f: 'pick' | 'quote'): Partial<Line> {
  const p = planOf(l, k);
  const n = { ...p, [f]: !p[f] };
  if (n[f] && !(n.qty > 0)) n.qty = 1;
  return k === 'a' ? { aPick: n.pick, aQuote: n.quote, aQty: n.qty } : { bPick: n.pick, bQuote: n.quote, bQty: n.qty };
}

/** the quotation (ยอดเสนอราคา) of แบบ A / B — not the bill: a เสนอ-only line is quoted, not charged */
export const quoteTotal = (lines: Line[], k: 'a' | 'b') =>
  lines.reduce((s, l) => {
    const { quote, qty } = planOf(l, k);
    return s + (quote ? l.price * qty : 0);
  }, 0);

/** what saveRepair stores for edited lines: issued / returned lines keep their stored amount, the others เบิก + เสนอ only */
export const chargedTotal = (lines: Line[]) => lines.reduce((s, l) => s + (l.locked ? (l.total ?? 0) : chargeOf(l)), 0);

/**
 * A legacy job's parts cost after this save, as saveRepair computes it: the recorded cost is never recomputed (it may
 * have no lines behind it); it moves by what the lines added / changed / removed here sum to (chargeOf). Only lines
 * ticked เบิก count (stock.ts partsTotalOf): a quote-only line's total was never in it.
 */
export function legacyPartsTotal(lines: Line[], loaded: Line[], stored: number) {
  const same = (a: Line, b: Line) =>
    a.aPick === b.aPick &&
    a.aQuote === b.aQuote &&
    a.aQty === b.aQty &&
    a.bPick === b.bPick &&
    a.bQuote === b.bQuote &&
    a.bQty === b.bQty;
  const before = (l: Line) => (l.aPick ? (l.total ?? 0) : 0);
  const after = (l: Line) => (l.aPick ? chargeOf(l) : 0);
  let delta = 0;
  for (const was of loaded) if (was.logId && !lines.some((l) => l.logId === was.logId)) delta -= before(was);
  for (const l of lines) {
    const was = l.logId ? loaded.find((x) => x.logId === l.logId) : undefined;
    if (!was) delta += after(l);
    else if (!l.locked && !same(l, was)) delta += after(l) - before(was);
  }
  return stored + delta;
}

/** the server refuses the change to ซ่อมเสร็จ / ไม่ซ่อม while parts are not issued — the message, else undefined */
export function partsBlockOf(lines: Line[], status: string, jobStatus: string | undefined) {
  const notIssued = lines.filter((l) =>
    l.issued ? l.aQty > l.issued.granted : l.locked ? l.waiting : l.aPick && l.aQty > 0,
  );
  const statusChange = status !== jobStatus && notIssued.length > 0;
  return statusChange && REPAIRED.includes(status)
    ? partsNotIssuedMsg(notIssued)
    : statusChange && NO_REPAIR.includes(status) && !NO_REPAIR.includes(jobStatus ?? '')
      ? partsWaitingMsg(notIssued, status)
      : undefined;
}

/** column เป็นเงิน of แบบ A: the line's charge — a quoted line not ticked เบิก is not charged */
export const amountA = (l: Line) =>
  l.aQuote && !l.aPick && l.aQty > 0 ? 'ไม่คิดเงิน' : baht(l.locked ? (l.total ?? 0) : chargeOf(l));

export const statusOf = (l: Line) => (!l.locked && !l.aPick ? QUOTE_ONLY : l.status);

export const partTone = (st: string): Tone =>
  st === QUOTE_ONLY
    ? 'neutral'
    : /พร้อม|จ่ายแล้ว|คืนแล้ว/.test(st)
      ? 'success'
      : /รออะไหล่/.test(st)
        ? 'danger'
        : 'warning';
