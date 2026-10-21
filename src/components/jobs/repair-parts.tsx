'use client';

import * as React from 'react';
import { Plus, Trash2, Stethoscope } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { ProductPicker } from '@/components/shared/product-picker';
import { Badge } from '@/components/ui/badge';
import { TableScroll } from '@/components/ui/data-table';
import { Checkbox, NumberInput } from '@/components/ui/input';
import type { PickableProduct } from '@/lib/product-match';
import type { FieldErrors } from '@/lib/validation';
import { baht, cn } from '@/lib/utils';
import { type Line, amountA, partTone, planOf, quoteTotal, statusOf, tickPlan } from './repair-lines';

type Action = { errors: FieldErrors; clear: (key: string) => void };
type RowProps = {
  lines: Line[];
  lock?: string;
  act: Action;
  upd: (id: number, patch: Partial<Line>) => void;
  remove: (l: Line) => void;
  /** the line a second pick of the same part pointed at — highlighted */
  dup: number | null;
};

/** การใช้อะไหล่ และการเสนอราคา — the part lines of บันทึกงานซ่อม, quotation แบบ A (Normal) / B (VIP) */
export function RepairPartsSection({
  lines,
  setLines,
  onAdd,
  lock,
  act,
}: {
  lines: Line[];
  setLines: React.Dispatch<React.SetStateAction<Line[]>>;
  onAdd: (p: PickableProduct) => void;
  /** a closed job: part lines / prices stay as they are */
  lock?: string;
  act: Action;
}) {
  /** a part picked again while its line is still open (not issued / returned): point at that line, add none */
  const [dup, setDup] = React.useState<number | null>(null);
  const upd = (id: number, patch: Partial<Line>) => {
    setDup(null);
    setLines((s) => s.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const remove = (l: Line) => {
    setDup(null);
    setLines((s) => s.filter((x) => x.id !== l.id));
  };
  const pick = (p: PickableProduct) => {
    const open = lines.find((l) => !l.locked && !l.issued && l.code === p.sysCode);
    setDup(open?.id ?? null);
    if (!open) onAdd(p); // an issued line of it → a new line is the way to ask for more
  };
  const dupRow = lines.findIndex((l) => l.id === dup);
  const dupLine = lines[dupRow];
  // part-line rule errors ("parts.<row>.a.qty" …) — listed under the table by row number
  const partErrors = Object.entries(act.errors).filter(([k]) => k.startsWith('parts.'));
  const rows = { lines, lock, act, upd, remove, dup };

  return (
    <Section
      title="การใช้อะไหล่ และการเสนอราคา"
      icon={Stethoscope}
      description={lock ?? 'เสนอราคาแบบ A (Normal) และแบบ B (VIP)'}
      bodyClassName="p-0"
    >
      {!lock && (
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <ProductPicker
              onPick={(p) => p?.product && pick(p.product)}
              placeholder="เพิ่มอะไหล่ — ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…"
              className="sm:max-w-xl"
            />
          </div>
          <p role="status" className="text-xs text-warning empty:hidden">
            {dupLine && `${dupLine.code} อยู่ในรายการแล้ว (แถว ${dupRow + 1}) — แก้จำนวนที่แถวเดิม`}
          </p>
        </div>
      )}
      <PartCards {...rows} />
      <PartsTable {...rows} />
      {partErrors.length > 0 && (
        <ul role="alert" className="space-y-0.5 border-t border-border px-3 py-2 text-2xs text-danger">
          {partErrors.map(([k, m]) => (
            <li key={k}>
              แถว {Number(k.split('.')[1]) + 1}: {m}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** a partly issued line: what may still change (saveRepair's rule) */
function IssuedHint({ l }: { l: Line }) {
  if (!l.issued) return null;
  return (
    <p className="mt-1 text-2xs text-muted-foreground">
      จ่ายแล้ว {l.issued.granted} จาก {l.issued.requested} — ลดจำนวนเหลือ {l.issued.granted} เพื่อยกเลิกส่วนที่เหลือ
    </p>
  );
}

function RemoveLine({ line, lock, remove }: { line: Line; lock?: string; remove: (l: Line) => void }) {
  if (line.locked || line.issued || lock) return null;
  return (
    <button
      onClick={() => remove(line)}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
      aria-label="ลบ"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** phone: one card per line (the 14-column table does not fit) — the same fields, desktop keeps the table */
function PartCards({ lines, lock, act, upd, remove, dup }: RowProps) {
  return (
    <ul className="divide-y divide-border md:hidden">
      {lines.length === 0 && (
        <li className="px-3 py-8 text-center text-xs text-muted-foreground">
          ยังไม่มีรายการอะไหล่ — ค้นหาในช่องด้านบนเพื่อเพิ่ม
        </li>
      )}
      {lines.map((l, i) => (
        <li key={l.id} className={cn('space-y-2 p-3 text-sm', l.id === dup && 'bg-warning-soft')}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="num font-medium">
                {i + 1}. {l.code}
              </p>
              <p className="text-xs text-muted-foreground">{l.name}</p>
            </div>
            <span className="num shrink-0">{baht(l.price)}</span>
            <RemoveLine line={l} lock={lock} remove={remove} />
          </div>
          {(['a', 'b'] as const).map((k) => {
            const { pick, quote, qty } = planOf(l, k);
            const off = l.locked || !!lock;
            const T = k.toUpperCase();
            const fixed = off || !!l.issued; // a partly issued line: only แบบ A's qty moves (down)
            const range = k === 'a' && l.issued ? l.issued : undefined;
            return (
              <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="w-14 text-muted-foreground">แบบ {T}</span>
                <label className="inline-flex items-center gap-1">
                  <Checkbox
                    aria-label={`เบิก แบบ ${T} ${l.code}`}
                    checked={pick}
                    disabled={fixed}
                    onChange={() => {
                      upd(l.id, tickPlan(l, k, 'pick'));
                      act.clear(`parts.${i}.${k}.qty`);
                    }}
                  />
                  เบิก
                </label>
                <label className="inline-flex items-center gap-1">
                  <Checkbox
                    aria-label={`เสนอ แบบ ${T} ${l.code}`}
                    checked={quote}
                    disabled={fixed}
                    onChange={() => {
                      upd(l.id, tickPlan(l, k, 'quote'));
                      act.clear(`parts.${i}.${k}.qty`);
                    }}
                  />
                  เสนอ
                </label>
                <NumberInput
                  min={range?.granted ?? 0}
                  max={range?.requested ?? 1000}
                  placeholder="0"
                  aria-label={`จำนวน แบบ ${T} ${l.code}`}
                  value={qty}
                  disabled={range ? off : fixed}
                  aria-invalid={!!act.errors[`parts.${i}.${k}.qty`] || undefined}
                  onChange={(n) => {
                    upd(l.id, k === 'a' ? { aQty: n } : { bQty: n });
                    act.clear(`parts.${i}.${k}.qty`);
                  }}
                  className="h-8 w-16 px-1.5"
                />
                <span className="num ml-auto">{k === 'a' ? amountA(l) : baht(quote ? l.price * qty : 0)}</span>
              </div>
            );
          })}
          <Badge tone={partTone(statusOf(l))} dot>
            {statusOf(l)}
          </Badge>
          <IssuedHint l={l} />
        </li>
      ))}
      {lines.length > 0 && (
        <li className="flex justify-between bg-muted/50 px-3 py-2 text-xs font-semibold">
          <span>
            ยอดเสนอราคา แบบ A <span className="num text-primary">{baht(quoteTotal(lines, 'a'))}</span>
          </span>
          <span>
            ยอดเสนอราคา แบบ B <span className="num text-primary">{baht(quoteTotal(lines, 'b'))}</span>
          </span>
        </li>
      )}
    </ul>
  );
}

/** desktop: เบิก / เสนอ / Qty / เป็นเงิน of one quotation (แบบ A or B) — the same four cells for both */
function PlanCells({
  l,
  i,
  k,
  lock,
  act,
  upd,
}: Omit<RowProps, 'lines' | 'remove' | 'dup'> & { l: Line; i: number; k: 'a' | 'b' }) {
  const { pick, quote, qty } = planOf(l, k);
  const T = k.toUpperCase();
  const fixed = l.locked || !!lock || !!l.issued; // a partly issued line: only แบบ A's qty moves (down)
  const range = k === 'a' && l.issued ? l.issued : undefined;
  return (
    <>
      <td className="border-l border-border px-2 py-2 text-center">
        <Checkbox
          aria-label={`เบิก แบบ ${T} ${l.code}`}
          checked={pick}
          disabled={fixed}
          onChange={() => {
            upd(l.id, tickPlan(l, k, 'pick'));
            act.clear(`parts.${i}.${k}.qty`);
          }}
        />
      </td>
      <td className="px-2 py-2 text-center">
        <Checkbox
          aria-label={`เสนอ แบบ ${T} ${l.code}`}
          checked={quote}
          disabled={fixed}
          onChange={() => {
            upd(l.id, tickPlan(l, k, 'quote'));
            act.clear(`parts.${i}.${k}.qty`);
          }}
        />
      </td>
      <td className="px-2 py-2">
        <NumberInput
          min={range?.granted ?? 0}
          max={range?.requested ?? 1000}
          placeholder="0"
          aria-label={`จำนวน แบบ ${T} ${l.code}`}
          value={qty}
          disabled={range ? l.locked || !!lock : fixed}
          aria-invalid={!!act.errors[`parts.${i}.${k}.qty`] || undefined}
          onChange={(n) => {
            upd(l.id, k === 'a' ? { aQty: n } : { bQty: n });
            act.clear(`parts.${i}.${k}.qty`);
          }}
          className="h-7 w-14 px-1.5"
        />
      </td>
      <td className="num px-2 py-2 text-right">{k === 'a' ? amountA(l) : baht(quote ? l.price * qty : 0)}</td>
    </>
  );
}

function PartsTable({ lines, lock, act, upd, remove, dup }: RowProps) {
  return (
    <TableScroll label="รายการอะไหล่" className="hidden rounded-none md:block">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
            <th rowSpan={2} className="w-10 px-2 py-2 text-left">
              #
            </th>
            <th rowSpan={2} className="w-24 px-2 py-2 text-left">
              รหัสอะไหล่
            </th>
            <th rowSpan={2} className="px-2 py-2 text-left">
              รายละเอียด
            </th>
            <th rowSpan={2} className="w-24 px-2 py-2 text-right">
              ราคา/หน่วย
            </th>
            <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
              เสนอราคาแบบ A (Normal)
            </th>
            <th colSpan={4} className="border-l border-border px-2 py-1.5 text-center">
              เสนอราคาแบบ B (VIP)
            </th>
            <th rowSpan={2} className="w-24 px-2 py-2 text-left">
              สถานะ
            </th>
            <th rowSpan={2} className="w-16 px-2 py-2 text-center">
              Action
            </th>
          </tr>
          <tr className="border-b border-border bg-muted/60 text-2xs text-muted-foreground">
            {(['a', 'b'] as const).map((k) => (
              <React.Fragment key={k}>
                <th className="w-14 border-l border-border px-2 py-1.5 text-center">เบิก</th>
                <th className="w-14 px-2 py-1.5 text-center">เสนอ</th>
                <th className="w-16 px-2 py-1.5 text-center">Qty</th>
                <th className="w-24 px-2 py-1.5 text-right">เป็นเงิน</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={14} className="px-3 py-10 text-center text-xs text-muted-foreground">
                ยังไม่มีรายการอะไหล่ — ค้นหาในช่องด้านบนเพื่อเพิ่ม
              </td>
            </tr>
          ) : (
            lines.map((l, i) => (
              <tr
                key={l.id}
                className={cn('border-b border-border/70 hover:bg-accent/50', l.id === dup && 'bg-warning-soft')}
              >
                <td className="num px-2 py-2 text-muted-foreground">{i + 1}</td>
                <td className="num px-2 py-2 font-medium">{l.code}</td>
                <td className="px-2 py-2">
                  <span className="line-clamp-2 max-w-[280px]">{l.name}</span>
                </td>
                <td className="num px-2 py-2 text-right">{baht(l.price)}</td>
                <PlanCells l={l} i={i} k="a" lock={lock} act={act} upd={upd} />
                <PlanCells l={l} i={i} k="b" lock={lock} act={act} upd={upd} />
                <td className="px-2 py-2">
                  <Badge tone={partTone(statusOf(l))} dot>
                    {statusOf(l)}
                  </Badge>
                  <IssuedHint l={l} />
                </td>
                <td className="px-2 py-2 text-center">
                  <RemoveLine line={l} lock={lock} remove={remove} />
                </td>
              </tr>
            ))
          )}
        </tbody>
        {lines.length > 0 && (
          <tfoot>
            <tr className="bg-muted/50 font-semibold">
              <td colSpan={7} className="px-2 py-2 text-right text-xs">
                ยอดเสนอราคา แบบ A
              </td>
              <td className="num px-2 py-2 text-right text-primary">{baht(quoteTotal(lines, 'a'))}</td>
              <td colSpan={3} className="px-2 py-2 text-right text-xs">
                ยอดเสนอราคา แบบ B
              </td>
              <td className="num px-2 py-2 text-right text-primary">{baht(quoteTotal(lines, 'b'))}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </TableScroll>
  );
}
