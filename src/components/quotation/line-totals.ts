import { lineAmount } from '@/lib/validation/quotation';

/** a row of the quotation's รายการอะไหล่และบริการ */
export type QuotationLine = {
  id: number;
  /** a stored line's uuid (sent back with the save: that line is kept / updated); none = a new line */
  uid?: string;
  code: string;
  name: string;
  qty: number;
  price: number;
  /** ส่วนลด (บาท) as typed — ignored while discountPercent is set */
  discount: number;
  /** ส่วนลด (%) 0–100 — set, it decides the บาท discount (lineAmount) */
  discountPercent: number;
  itemType: 'SparePart' | 'Service' | 'Delivery';
};

/** the row's ส่วนลด (บาท) and เป็นเงิน — the server's rule (lineAmount) */
export const lineOf = (l: QuotationLine) =>
  lineAmount({ qty: l.qty, unitPrice: l.price, discount: l.discount, discountPercent: l.discountPercent });

/** รวมค่าอะไหล่ (every line but the delivery charge) and ค่าขนส่ง (the delivery lines), after each line's discount */
export function lineTotals(lines: QuotationLine[]) {
  return {
    parts: lines.filter((l) => l.itemType !== 'Delivery').reduce((s, l) => s + lineOf(l).total, 0),
    delivery: lines.filter((l) => l.itemType === 'Delivery').reduce((s, l) => s + lineOf(l).total, 0),
  };
}
