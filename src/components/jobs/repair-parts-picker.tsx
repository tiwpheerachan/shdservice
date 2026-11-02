'use client';

import * as React from 'react';
import { ListChecks, Search } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableScroll } from '@/components/ui/data-table';
import { Checkbox, Input, NumberInput } from '@/components/ui/input';
import { useProductsPage } from '@/data/db';
import { matchProducts, type PickableProduct } from '@/lib/product-match';
import { baht, cn } from '@/lib/utils';
import { type Line, amountA, planOf, quoteTotal, tickPlan } from './repair-lines';

/** เบิก / เสนอ / Qty of แบบ A and B — what a picked row sets on its new line */
export type PartPlan = Pick<Line, 'aPick' | 'aQuote' | 'aQty' | 'bPick' | 'bQuote' | 'bQty'>;
export type PickedPart = { product: PickableProduct; plan: PartPlan };

/** the pages' cap (parsePageQuery) — one model's parts are a few dozen */
const MAX = 500;

const blank = (p: PickableProduct): Line => ({
  id: 0,
  code: p.sysCode,
  name: p.name,
  price: p.price,
  aPick: false,
  aQuote: false,
  aQty: 0,
  bPick: false,
  bQuote: false,
  bQty: 0,
  status: '',
});

/** a Qty alone asks for nothing (the table's tickPlan: a tick starts the Qty, a Qty never ticks) */
const asked = (l: Line) => l.aPick || l.aQuote || l.bPick || l.bQuote;

/** The legacy เบิกอะไหล่ popup: every ACTIVE part bound to the job's model (product_compatible_model), several at once. */
export function ModelPartsPicker({
  model,
  name,
  added,
  onConfirm,
}: {
  /** model_code — the products filter's key */
  model: string;
  name: string;
  /** codes with an open line in the table — a second line of them is not offered */
  added: Set<string>;
  onConfirm: (picked: PickedPart[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="shrink-0">
        <ListChecks className="h-3.5 w-3.5" />
        เลือกจากรายการอะไหล่ของรุ่นนี้
      </Button>
      {/* mounted while open: the list is read when asked for, not with every repair page */}
      {open && !model && (
        <Modal open onClose={() => setOpen(false)} title="อะไหล่ของรุ่นนี้">
          <p className="text-sm text-muted-foreground">งานนี้ยังไม่ได้ระบุรุ่น — ค้นหาอะไหล่จากช่องค้นหาแทน</p>
        </Modal>
      )}
      {open && model && (
        <PickerDialog
          model={model}
          name={name}
          added={added}
          onClose={() => setOpen(false)}
          onConfirm={(p) => {
            onConfirm(p);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PickerDialog({
  model,
  name,
  added,
  onClose,
  onConfirm,
}: {
  model: string;
  name: string;
  added: Set<string>;
  onClose: () => void;
  onConfirm: (picked: PickedPart[]) => void;
}) {
  const { rows, total, loading, error, refetch } = useProductsPage(
    { page: 1, pageSize: MAX, model, status: 'Active' },
    'active',
  );
  const [q, setQ] = React.useState('');
  const [draft, setDraft] = React.useState<Record<string, Line>>({});
  // a part with a legacy second product_stock row comes back once per row (the list left-joins it): one row per code
  const parts = React.useMemo(
    () => rows.filter((p, i) => rows.findIndex((x) => x.sysCode === p.sysCode) === i),
    [rows],
  );
  const shown = React.useMemo(() => matchProducts(parts, q, MAX), [parts, q]);
  const picked: PickedPart[] = parts.flatMap((p) => {
    const l = draft[p.sysCode];
    return l && asked(l) ? [{ product: p, plan: planFields(l) }] : [];
  });
  const lineOf = (p: PickableProduct) => draft[p.sysCode] ?? blank(p);
  const set = (p: PickableProduct, patch: Partial<Line>) =>
    setDraft((d) => ({ ...d, [p.sysCode]: { ...lineOf(p), ...patch } }));

  const empty =
    parts.length === 0
      ? `ยังไม่มีอะไหล่ที่ผูกกับรุ่น ${name} — ค้นหาอะไหล่จากช่องค้นหาแทน`
      : `ไม่พบอะไหล่ที่ตรงกับ "${q.trim()}"`;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`อะไหล่ของรุ่น ${name}`}
      description="อะไหล่ที่ใช้ได้กับรุ่นนี้ (ตามที่ผูกไว้ในข้อมูลอะไหล่) — ติ๊ก เบิก / เสนอ และจำนวน แล้วกดเพิ่ม"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={picked.length === 0} onClick={() => onConfirm(picked)}>
            เพิ่ม {picked.length > 0 ? `${picked.length} รายการ` : 'รายการ'}
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="กรองรายการ — ชื่อ / รหัส / เลข part / หมวด…"
          aria-label="กรองรายการอะไหล่ของรุ่น"
          className="pl-8"
        />
      </div>
      {total > rows.length && (
        <p className="mb-2 text-xs text-warning">
          แสดง {rows.length} จาก {total} รายการ — พิมพ์ในช่องค้นหาด้านนอกเพื่อหารายการอื่น
        </p>
      )}
      <TableScroll label="อะไหล่ของรุ่น" className="rounded-md border border-border">
        <table className="w-full min-w-[840px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-2xs text-muted-foreground">
              <th rowSpan={2} className="w-8 px-2 py-2 text-left">
                #
              </th>
              <th rowSpan={2} className="w-20 px-2 py-2 text-left">
                รหัสอะไหล่
              </th>
              <th rowSpan={2} className="px-2 py-2 text-left">
                ชื่ออะไหล่
              </th>
              <th rowSpan={2} className="w-16 px-2 py-2 text-right">
                คงเหลือ
              </th>
              <th rowSpan={2} className="w-20 px-2 py-2 text-right">
                ราคา/หน่วย
              </th>
              <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                เสนอราคาแบบ A (Normal)
              </th>
              <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
                เสนอราคาแบบ B (VIP)
              </th>
            </tr>
            <tr className="border-b border-border bg-muted/60 text-2xs text-muted-foreground">
              {(['a', 'b'] as const).map((k) => (
                <React.Fragment key={k}>
                  <th className="w-10 border-l border-border px-1 py-1.5 text-center">เบิก</th>
                  <th className="w-10 px-1 py-1.5 text-center">เสนอ</th>
                  <th className="w-14 px-1 py-1.5 text-center">จำนวน</th>
                  <th className="w-16 px-2 py-1.5 text-right">เป็นเงิน</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={13} role="alert" className="px-3 py-8 text-center text-sm text-danger">
                  โหลดรายการอะไหล่ไม่สำเร็จ{' '}
                  <button type="button" onClick={refetch} className="font-medium underline underline-offset-2">
                    ลองใหม่
                  </button>
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  กำลังโหลด…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              shown.map((p, i) => {
                const l = lineOf(p);
                const isAdded = added.has(p.sysCode);
                return (
                  <tr key={p.sysCode} className={cn('border-b border-border/70', asked(l) && 'bg-primary-soft/40')}>
                    <td className="num px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="num px-2 py-1.5 font-medium">{p.sysCode}</td>
                    <td className="px-2 py-1.5">
                      <span className="block">{p.name}</span>
                      <span className="block text-2xs text-muted-foreground">
                        {[
                          p.category !== 'ยังไม่ระบุ' && p.category && `หมวด: ${p.category}`,
                          p.mfgCode !== '-' && p.mfgCode,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className={cn('num px-2 py-1.5 text-right', p.onhand <= 0 && 'text-danger')}>{p.onhand}</td>
                    <td className="num px-2 py-1.5 text-right">{baht(p.price)}</td>
                    {isAdded ? (
                      <td colSpan={8} className="border-l border-border px-2 py-1.5 text-center">
                        <Badge tone="neutral">อยู่ในรายการแล้ว — แก้จำนวนที่ตาราง</Badge>
                      </td>
                    ) : (
                      (['a', 'b'] as const).map((k) => {
                        const { pick, quote, qty } = planOf(l, k);
                        const T = k.toUpperCase();
                        return (
                          <React.Fragment key={k}>
                            <td className="border-l border-border px-1 py-1.5 text-center">
                              <Checkbox
                                aria-label={`เบิก แบบ ${T} ${p.sysCode}`}
                                checked={pick}
                                onChange={() => set(p, tickPlan(l, k, 'pick'))}
                              />
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              <Checkbox
                                aria-label={`เสนอ แบบ ${T} ${p.sysCode}`}
                                checked={quote}
                                onChange={() => set(p, tickPlan(l, k, 'quote'))}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <NumberInput
                                min={0}
                                max={1000}
                                placeholder="0"
                                aria-label={`จำนวน แบบ ${T} ${p.sysCode}`}
                                value={qty}
                                onChange={(n) => set(p, k === 'a' ? { aQty: n } : { bQty: n })}
                                className="h-7 w-12 px-1.5"
                              />
                            </td>
                            {/* the table's own เป็นเงิน cells: เบิก without เสนอ = 0.00, as legacy charges it */}
                            <td className="num px-2 py-1.5 text-right">
                              {k === 'a' ? amountA(l) : baht(quoteTotal([l], 'b'))}
                            </td>
                          </React.Fragment>
                        );
                      })
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableScroll>
    </Modal>
  );
}

/** a side with nothing ticked goes in at Qty 0: its typed Qty asked for nothing */
const planFields = ({ aPick, aQuote, aQty, bPick, bQuote, bQty }: Line): PartPlan => ({
  aPick,
  aQuote,
  aQty: aPick || aQuote ? aQty : 0,
  bPick,
  bQuote,
  bQty: bPick || bQuote ? bQty : 0,
});
