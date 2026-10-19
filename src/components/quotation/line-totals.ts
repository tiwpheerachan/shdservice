/** a row of the quotation's รายการอะไหล่และบริการ */
export type QuotationLine = {
  id: number;
  code: string;
  name: string;
  qty: number;
  price: number;
  itemType: 'SparePart' | 'Service' | 'Delivery';
};

/** รวมค่าอะไหล่ (every line but the delivery charge) and ค่าขนส่ง (the delivery lines) */
export function lineTotals(lines: QuotationLine[]) {
  return {
    parts: lines.filter((l) => l.itemType !== 'Delivery').reduce((s, l) => s + l.qty * l.price, 0),
    delivery: lines.filter((l) => l.itemType === 'Delivery').reduce((s, l) => s + l.qty * l.price, 0),
  };
}
