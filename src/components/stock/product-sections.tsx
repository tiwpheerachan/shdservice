'use client';

import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, LookupError } from '@/components/ui/field';
import { Input, Textarea, Checkbox, Radio } from '@/components/ui/input';
import { SearchSelect, withCurrent } from '@/components/shared/search-select';
import { useModels, useColors, useCategories, useManufacturers } from '@/data/db';
import type { Product } from '@/data/types';
import { int } from '@/lib/utils';
import type { FieldErrors } from '@/lib/validation';
import { STORE_LOCATION_NAME } from '@/lib/status-ids';
import { useTourRestore } from '@/components/tour/tour';
import { type ProductForm, modelRows } from './product-form';

export type StockCardRow = {
  no: string;
  date: string;
  type: string;
  before: number;
  income: number;
  outcome: number;
  after: number;
  ref: string;
  remark: string;
};

type FormProps = {
  form: ProductForm;
  set: <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => void;
  errors: FieldErrors;
  ro: boolean;
};

/** a price in บาท (ราคาทุน / ขายส่ง / ขายปลีก) */
function PriceField({
  form,
  set,
  errors,
  ro,
  k,
  label,
}: FormProps & { k: 'capitalPrice' | 'wholesalePrice' | 'price'; label: string }) {
  return (
    <Field label={label} error={errors[k]}>
      <Input
        type="number"
        step="0.01"
        min={0}
        inputMode="decimal"
        placeholder="0.00"
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        readOnly={ro}
        className="num text-right"
      />
    </Field>
  );
}

export function ProductFields({ p, seeCost, ...f }: FormProps & { p: Product; seeCost: boolean }) {
  const { form, set, errors, ro } = f;
  const { data: CATEGORIES, ...categoriesLookup } = useCategories();
  const { data: MANUFACTURERS, ...brandsLookup } = useManufacturers();
  // บทสอน: what is tried in the dialog's form (models and status included) goes back before it closes
  useTourRestore(
    () => form,
    (v) => (Object.keys(v) as (keyof ProductForm)[]).forEach((k) => set(k, v[k])),
  );
  return (
    <FieldGrid cols={2}>
      <Field label="รหัสอะไหล่ (ระบบ)">
        <Input value={p.sysCode || 'Generate Auto'} readOnly className="num" />
      </Field>
      <Field
        label="รหัสอะไหล่ (ผู้ผลิต)"
        error={errors.mfgCode}
        hint={ro ? undefined : 'รหัสเดียว: A-Z 0-9 . _ / - (ไม่มีภาษาไทย ช่องว่าง หรือจุลภาค)'}
      >
        <Input
          value={form.mfgCode}
          onChange={(e) => set('mfgCode', e.target.value.toUpperCase())}
          readOnly={ro}
          maxLength={50}
          autoCapitalize="characters"
          spellCheck={false}
          className="num"
        />
      </Field>

      <Field label="ชื่ออะไหล่ (TH)" required wide error={errors.name}>
        <Input maxLength={500} value={form.name} onChange={(e) => set('name', e.target.value)} readOnly={ro} />
      </Field>
      <Field label="ชื่ออะไหล่ (EN)" wide error={errors.nameEn}>
        <Input maxLength={200} value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} readOnly={ro} />
      </Field>
      <Field label="ชื่ออะไหล่ (CN)" wide error={errors.nameCn}>
        <Input maxLength={200} value={form.nameCn} onChange={(e) => set('nameCn', e.target.value)} readOnly={ro} />
      </Field>
      <Field label="รายละเอียด" wide error={errors.description}>
        <Input
          maxLength={200}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="รายละเอียดเพิ่มเติม"
          readOnly={ro}
        />
      </Field>

      <Field label="หมวดหมู่" error={errors.category} lookup={categoriesLookup}>
        <SearchSelect
          value={form.category}
          onChange={(v) => set('category', v)}
          options={withCurrent(
            CATEGORIES.map((c) => ({ value: c.name, label: c.name })),
            form.category,
          )}
          disabled={ro}
          searchPlaceholder="พิมพ์ชื่อหมวดหมู่…"
        />
      </Field>
      <Field label="คุม S/N (Serial Control)" group="radiogroup">
        <div className="flex h-9 items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <Radio name={`sn-${p.sysCode}`} checked={!!p.serialControl} readOnly disabled /> True
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            {/* controlled: the stored value (False when null), not a defaultChecked lost on re-render */}
            <Radio name={`sn-${p.sysCode}`} checked={!p.serialControl} readOnly disabled /> False
          </label>
        </div>
      </Field>

      {seeCost && <PriceField {...f} k="capitalPrice" label="ราคาทุน (Capital) — บาท" />}
      <PriceField {...f} k="wholesalePrice" label="ราคาขายส่ง (Wholesale) — บาท" />
      <PriceField {...f} k="price" label="ราคาขายปลีก (Retail) — บาท" />
      <Field label="จำนวนคงเหลือ">
        <Input value={p.onhand} readOnly className="num text-right" />
      </Field>

      <Field label="ยี่ห้อ (ผู้ผลิต)" wide error={errors.brand} lookup={brandsLookup}>
        <SearchSelect
          value={form.brand}
          onChange={(v) => set('brand', v)}
          options={withCurrent(
            MANUFACTURERS.map((m) => ({ value: m.name, label: m.name })),
            form.brand,
          )}
          disabled={ro}
          searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
        />
      </Field>
    </FieldGrid>
  );
}

/** ใช้สำหรับ รุ่นสินค้า — the models this part fits: a list (view) or a searchable checklist (edit) */
export function ProductModelChecklist({
  form,
  set,
  errors,
  ro,
  modelQ,
  setModelQ,
  allBrands,
  setAllBrands,
}: FormProps & {
  modelQ: string;
  setModelQ: (q: string) => void;
  /** รุ่นสินค้า: only the chosen ยี่ห้อ's models unless ticked */
  allBrands: boolean;
  setAllBrands: (fn: (x: boolean) => boolean) => void;
}) {
  const brandOnly = !allBrands && !!form.brand.trim();
  // the chosen brand's models only; the whole list (~140 KB) only when asked for — แสดงทุกยี่ห้อ, or a search typed
  // with no brand chosen (view: the brand's list names the ticked ones)
  const wantAll = !ro && !brandOnly && (allBrands || !!modelQ.trim());
  const { data: MODELS, ...modelsLookup } = useModels('active', {
    brand: wantAll ? '' : form.brand,
    enabled: wantAll || !!form.brand.trim(),
  });
  const rows = modelRows(MODELS, form.models, { readOnly: ro, brandOnly, brand: form.brand, q: modelQ });

  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        ใช้สำหรับ รุ่นสินค้า{' '}
        <span className="num text-xs font-normal text-muted-foreground">({form.models.length} รุ่น)</span>
      </p>
      {errors.models && <p className="mb-2 text-xs text-danger">{errors.models}</p>}
      {!ro && (
        <div className="mb-2 flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="ค้นหารุ่นสินค้า"
            placeholder="พิมพ์รหัสรุ่น ชื่อรุ่น หรือยี่ห้อ…"
            value={modelQ}
            onChange={(e) => setModelQ(e.target.value)}
            className="h-8 max-w-sm"
          />
          {form.brand.trim() && (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={allBrands} onChange={() => setAllBrands((x) => !x)} />
              แสดงทุกยี่ห้อ
            </label>
          )}
        </div>
      )}
      <div className="grid max-h-72 grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((m) =>
          ro ? (
            <span key={m.code} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="num shrink-0 text-muted-foreground">{m.code}</span>
              <span className="truncate">{m.name || '—'}</span>
            </span>
          ) : (
            <label key={m.code} className="flex min-w-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={form.models.includes(m.code)}
                onChange={() =>
                  set(
                    'models',
                    form.models.includes(m.code) ? form.models.filter((c) => c !== m.code) : [...form.models, m.code],
                  )
                }
              />
              <span className="num shrink-0 text-muted-foreground">{m.code}</span>
              <span className="truncate" title={m.brand ? `${m.name} · ${m.brand}` : m.name}>
                {m.name}
              </span>
            </label>
          ),
        )}
        {rows.length === 0 && (
          <span className="text-xs text-muted-foreground">
            {ro
              ? 'ยังไม่ได้ระบุรุ่นสินค้า'
              : !wantAll && !form.brand.trim()
                ? 'เลือกยี่ห้อ หรือพิมพ์ค้นหารุ่นสินค้า'
                : MODELS.length === 0
                  ? 'ไม่มีข้อมูลรุ่นสินค้า'
                  : brandOnly
                    ? `ไม่พบรุ่นของยี่ห้อ ${form.brand}${modelQ.trim() ? ` ที่ตรงกับ "${modelQ.trim()}"` : ''} — ติ๊ก แสดงทุกยี่ห้อ`
                    : `ไม่พบรุ่นที่ตรงกับ "${modelQ.trim()}"`}
          </span>
        )}
      </div>
      {!ro && <LookupError error={modelsLookup.error} onRetry={modelsLookup.refetch} />}
    </div>
  );
}

export function ProductColorStatus({ form, set, ro, sysCode }: Omit<FormProps, 'errors'> & { sysCode: string }) {
  const { data: COLORS, ...colorsLookup } = useColors();
  return (
    <FieldGrid cols={2}>
      <Field label="ใช้สำหรับ สีสินค้า" lookup={colorsLookup}>
        <SearchSelect
          value={form.forModelColor}
          onChange={(v) => set('forModelColor', v)}
          options={withCurrent(
            COLORS.map((c) => ({ value: c.name, label: c.name })),
            form.forModelColor,
          )}
          disabled={ro}
          emptyLabel="- - เลือก - -"
          searchPlaceholder="พิมพ์ชื่อสี…"
        />
      </Field>
      <Field label="สถานะ" group="radiogroup">
        <div className="flex h-9 items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <Radio
              name={`status-${sysCode}`}
              checked={form.status === 'Active'}
              onChange={() => set('status', 'Active')}
              disabled={ro}
            />{' '}
            Active
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm">
            <Radio
              name={`status-${sysCode}`}
              checked={form.status !== 'Active'}
              onChange={() => set('status', 'Inactive')}
              disabled={ro}
            />{' '}
            Inactive
          </label>
        </div>
      </Field>
    </FieldGrid>
  );
}

/** legacy read-only notes: stock-adjustment log (product_none_serial.remark) + cancel reason */
export function ProductLegacyNotes({ detail }: { detail: Product | null }) {
  if (!(detail?.stockRemark || detail?.cancelRemark || detail?.cancelDate)) return null;
  return (
    <FieldGrid cols={2}>
      {detail?.stockRemark && (
        <Field label="หมายเหตุสต๊อก (จากระบบเดิม)" wide>
          <Textarea rows={2} readOnly value={detail.stockRemark} />
        </Field>
      )}
      {(detail?.cancelRemark || detail?.cancelDate) && (
        <Field label="เหตุผลที่ยกเลิก" wide>
          <Textarea
            rows={2}
            readOnly
            value={[
              detail?.cancelRemark,
              detail?.cancelDate ? `${detail.cancelDate}${detail.cancelBy ? ` · โดย ${detail.cancelBy}` : ''}` : '',
            ]
              .filter(Boolean)
              .join('\n')}
          />
        </Field>
      )}
    </FieldGrid>
  );
}

export function ProductStockTables({
  p,
  stockCard,
  total,
  onMore,
  loadingMore = false,
}: {
  p: Product;
  /** newest first — the pages loaded so far */
  stockCard: StockCardRow[];
  /** every line the card has (โหลดเพิ่ม shows while fewer are loaded) */
  total: number;
  onMore: () => void;
  loadingMore?: boolean;
}) {
  // stock on-hand row (single warehouse / condition in the legacy system)
  const onhandRows = [
    {
      sn: '-',
      loc: STORE_LOCATION_NAME,
      cond: 'สินค้าใหม่',
      income: p.received ?? p.onhand,
      outcome: p.issued ?? 0,
      reserve: p.reserved ?? 0,
      avail: p.onhand,
      status: p.status,
    },
  ];
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <p className="mb-2 text-sm font-semibold">สินค้าคงเหลือ (Stock Onhand)</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="px-3 py-2 text-left">S/N</th>
                <th className="px-3 py-2 text-left">สถานที่จัดเก็บ</th>
                <th className="px-3 py-2 text-left">สภาพสินค้า</th>
                <th className="px-3 py-2 text-right">รับเข้า</th>
                <th className="px-3 py-2 text-right">จ่ายออก</th>
                <th className="px-3 py-2 text-right">จอง (งานซ่อม)</th>
                <th className="px-3 py-2 text-right">คงเหลือ</th>
                <th className="px-3 py-2 text-left">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {onhandRows.map((r, i) => (
                <tr key={i} className="border-b border-border/70 last:border-0">
                  <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                  <td className="num px-3 py-2">{r.sn}</td>
                  <td className="px-3 py-2">{r.loc}</td>
                  <td className="px-3 py-2">{r.cond}</td>
                  <td className="num px-3 py-2 text-right">{int(r.income)}</td>
                  <td className="num px-3 py-2 text-right">{int(r.outcome)}</td>
                  <td className="num px-3 py-2 text-right">{int(r.reserve)}</td>
                  <td className="num px-3 py-2 text-right font-semibold">{int(r.avail)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">ประวัติการรับ-จ่าย (Stock Card)</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="px-3 py-2 text-left">Movement No.</th>
                <th className="px-3 py-2 text-left">วันที่</th>
                <th className="px-3 py-2 text-left">ประเภท</th>
                <th className="px-3 py-2 text-right">Before</th>
                <th className="px-3 py-2 text-right">รับ (+)</th>
                <th className="px-3 py-2 text-right">จ่าย (−)</th>
                <th className="px-3 py-2 text-right">After</th>
                <th className="px-3 py-2 text-left">Ref No.</th>
              </tr>
            </thead>
            <tbody>
              {stockCard.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    ยังไม่มีประวัติการเคลื่อนไหว
                  </td>
                </tr>
              ) : (
                stockCard.map((m, i) => (
                  <tr key={i} className="border-b border-border/70 last:border-0">
                    <td className="num px-3 py-2 text-center text-muted-foreground">{i + 1}</td>
                    <td className="num px-3 py-2 font-medium">{m.no}</td>
                    <td className="num px-3 py-2 text-xs">{m.date}</td>
                    <td className="px-3 py-2">{m.type}</td>
                    <td className="num px-3 py-2 text-right">{int(m.before)}</td>
                    <td className="num px-3 py-2 text-right text-success">{int(m.income)}</td>
                    <td className="num px-3 py-2 text-right text-danger">{int(m.outcome)}</td>
                    <td className="num px-3 py-2 text-right font-semibold">{int(m.after)}</td>
                    <td className="num px-3 py-2 text-xs text-muted-foreground">{m.ref || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {stockCard.length < total && (
          <div className="mt-2 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>
              แสดง {int(stockCard.length)} จาก {int(total)} รายการ
            </span>
            <Button size="sm" variant="outline" onClick={onMore} disabled={loadingMore}>
              {loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
