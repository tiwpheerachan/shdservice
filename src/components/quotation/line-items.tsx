'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { ProductPicker, type ExtraItem } from '@/components/shared/product-picker';
import { Input, NumberInput } from '@/components/ui/input';
import { TableScroll } from '@/components/ui/data-table';
import type { FieldErrors } from '@/lib/validation';
import { baht } from '@/lib/utils';
import type { QuotationLine } from './line-totals';

/** non-stock line the quotation may carry (legacy SVD0001 = delivery charge, kept out of spare_part_amount) */
const DELIVERY_EXTRA: ExtraItem[] = [{ code: 'SVD0001', name: 'ค่าขนส่ง' }];

/** the quotation's line table: a part / ค่าขนส่ง per row, its detail, qty and unit price */
export function QuotationLineTable({
  lines,
  setLines,
  errors,
  clear,
  showZero,
}: {
  lines: QuotationLine[];
  setLines: React.Dispatch<React.SetStateAction<QuotationLine[]>>;
  errors: FieldErrors;
  clear: (key: string) => void;
  /** a loaded quotation shows its 0 prices as 0 */
  showZero: boolean;
}) {
  const upd = (id: number, patch: Partial<QuotationLine>) =>
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <TableScroll label="รายการในใบเสนอราคา" className="rounded-none">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
            <th className="w-10 px-3 py-2 text-left">#</th>
            <th className="w-72 px-3 py-2 text-left">รหัสอะไหล่ / ชื่อ</th>
            <th className="px-3 py-2 text-left">รายละเอียด</th>
            <th className="w-20 px-3 py-2 text-right">จำนวน</th>
            <th className="w-28 px-3 py-2 text-right">ราคา/หน่วย</th>
            <th className="w-28 px-3 py-2 text-right">เป็นเงิน</th>
            <th className="w-16 px-3 py-2 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                ยังไม่มีรายการ
              </td>
            </tr>
          ) : (
            lines.map((l, i) => (
              <tr key={l.id} className="border-b border-border/70 last:border-0">
                <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2">
                  <ProductPicker
                    value={l.code}
                    fallbackName={l.name}
                    extras={DELIVERY_EXTRA}
                    size="sm"
                    onPick={(p) =>
                      upd(l.id, {
                        code: p?.code ?? '',
                        name: p ? p.name : l.name,
                        price: p && p.price !== undefined ? p.price : l.price,
                        itemType: p?.code === 'SVD0001' ? 'Delivery' : 'SparePart',
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    aria-invalid={!!errors[`lines.${i}.detail`] || undefined}
                    maxLength={100}
                    value={l.name}
                    onChange={(e) => {
                      upd(l.id, { name: e.target.value });
                      clear(`lines.${i}.detail`);
                    }}
                    className="h-8"
                    placeholder="รายละเอียดรายการ"
                  />
                </td>
                <td className="px-3 py-2">
                  <NumberInput
                    aria-label={`จำนวน แถว ${i + 1}`}
                    aria-invalid={!!errors[`lines.${i}.qty`] || undefined}
                    min={1}
                    max={9999}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    value={l.qty}
                    onChange={(n) => {
                      upd(l.id, { qty: n });
                      clear(`lines.${i}.qty`);
                    }}
                    className="h-8"
                  />
                </td>
                <td className="px-3 py-2">
                  <NumberInput
                    aria-label={`ราคา/หน่วย แถว ${i + 1}`}
                    aria-invalid={!!errors[`lines.${i}.unitPrice`] || undefined}
                    step="0.01"
                    showZero={showZero}
                    value={l.price}
                    onChange={(n) => {
                      upd(l.id, { price: n });
                      clear(`lines.${i}.unitPrice`);
                    }}
                    className="h-8"
                  />
                </td>
                <td className="num px-3 py-2 text-right font-medium">{baht(l.qty * l.price)}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    aria-label="ลบ"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableScroll>
  );
}
