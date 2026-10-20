'use client';

import * as React from 'react';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { ProductPicker, type PickedItem } from '@/components/shared/product-picker';
import { Button } from '@/components/ui/button';
import { TableScroll } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input, NumberInput } from '@/components/ui/input';
import { useProductSearch } from '@/data/db';
import { baht } from '@/lib/utils';
import type { FieldErrors } from '@/lib/validation';

/** a row of the sale order */
export type SaleOrderLine = {
  id: number;
  code: string;
  name: string;
  qty: number;
  price: number;
  type: 'SparePart' | 'Service';
};

/** stock on hand now for a line's part (the approval takes it out) — a warning only, the approval refuses for real */
function StockNote({ code, qty }: { code: string; qty: number }) {
  const onhand = useProductSearch(code).data?.find((p) => p.sysCode === code)?.onhand;
  if (onhand === undefined) return null;
  const short = qty > onhand;
  return (
    <span className={short ? 'block text-xs font-medium text-warning' : 'block text-xs text-muted-foreground'}>
      คงเหลือ {onhand}
      {short && ' — ไม่พออนุมัติ: รับเข้าอะไหล่ที่ เมนูรับเข้า ก่อน'}
    </span>
  );
}

/** รายการสินค้า — pick a part + qty to add a row; each row's qty / price, its stock and the total */
export function SaleOrderLines({
  lines,
  setLines,
  total,
  readOnly,
  errors,
  clear,
  showZero,
}: {
  lines: SaleOrderLine[];
  setLines: React.Dispatch<React.SetStateAction<SaleOrderLine[]>>;
  total: number;
  readOnly: boolean;
  errors: FieldErrors;
  clear: (key: string) => void;
  /** a loaded order shows its 0 prices as 0 */
  showZero: boolean;
}) {
  const [item, setItem] = React.useState<PickedItem | null>(null); // the part chosen, not added yet
  const [qty, setQty] = React.useState(1);
  // new rows' ids follow the rows the order opened with (the edit page remounts the form for every order)
  const idRef = React.useRef(lines.length);

  const add = () => {
    const p = item?.product;
    if (!p) return;
    setLines((s) => [
      ...s,
      { id: ++idRef.current, code: p.sysCode, name: p.name, qty, price: p.price, type: 'SparePart' },
    ]);
    setItem(null);
    setQty(1);
  };

  return (
    <Section title="รายการสินค้า" icon={ShoppingCart} bodyClassName="p-0">
      {!readOnly && (
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-end">
          <Field label="รหัสสินค้า หรือ ชื่อสินค้า" className="flex-1" error={errors.lines}>
            <ProductPicker
              id="so-product"
              value={item?.code ?? ''}
              clearable
              onPick={setItem}
              placeholder="ค้นหา ชื่อสินค้า / รหัส / เลข part / ยี่ห้อ…"
            />
          </Field>
          <Field label="จำนวน" className="sm:w-28">
            <NumberInput min={1} max={1000} step={1} placeholder="1" value={qty} onChange={(n) => setQty(n)} />
          </Field>
          <Field label="หน่วยนับ" className="sm:w-28">
            <Input readOnly value="Pcs." />
          </Field>
          <Button size="md" onClick={add} disabled={!item?.product}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มรายการ
          </Button>
        </div>
      )}

      <TableScroll label="รายการสินค้า" className="rounded-none">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2 text-left">#</th>
              <th className="w-28 px-3 py-2 text-left">รหัสสินค้า</th>
              <th className="px-3 py-2 text-left">รายละเอียดสินค้า</th>
              <th className="w-20 px-3 py-2 text-right">จำนวน</th>
              <th className="w-28 px-3 py-2 text-right">ราคาขาย/หน่วย</th>
              <th className="w-28 px-3 py-2 text-right">เป็นเงิน</th>
              {!readOnly && <th className="w-16 px-3 py-2 text-center">ลบ</th>}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  ยังไม่มีรายการสินค้า
                </td>
              </tr>
            ) : (
              lines.map((l, i) => {
                return (
                  <tr key={l.id} className="border-b border-border/70 last:border-0">
                    <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="num px-3 py-2 font-medium">{l.code}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2 max-w-[320px]">{l.name}</span>
                      {!readOnly && l.type === 'SparePart' && <StockNote code={l.code} qty={l.qty} />}
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        aria-label={`จำนวน ${l.code}`}
                        aria-invalid={!!errors[`lines.${i}.qty`] || undefined}
                        min={1}
                        max={1000}
                        step={1}
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(n) =>
                          setLines((s) => s.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, n) } : x)))
                        }
                        className="ml-auto h-8 w-16 text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        aria-label={`ราคา ${l.code}`}
                        aria-invalid={!!errors[`lines.${i}.price`] || undefined}
                        step="0.01"
                        showZero={showZero}
                        value={l.price}
                        onChange={(n) => {
                          setLines((s) => s.map((x) => (x.id === l.id ? { ...x, price: n } : x)));
                          clear(`lines.${i}.price`);
                        }}
                        className="ml-auto h-8 w-24 text-right"
                      />
                    </td>
                    <td className="num px-3 py-2 text-right font-medium">{baht(l.qty * l.price)}</td>
                    {!readOnly && (
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                          aria-label="ลบ"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-muted/50 font-semibold">
              <td colSpan={5} className="px-3 py-2 text-right">
                รวมเป็นเงินทั้งสิ้น
              </td>
              <td className="num px-3 py-2 text-right text-primary">{baht(total)}</td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </TableScroll>
    </Section>
  );
}
