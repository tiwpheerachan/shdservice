'use client';

import * as React from 'react';
import { ModelPicker } from '@/components/shared/model-picker';
import { SearchSelect, strOptions, withCurrent } from '@/components/shared/search-select';
import type { JobFormState, useJobForm } from '@/components/shared/job-form';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea, Radio, Checkbox } from '@/components/ui/input';
import { CHANNELS, RECEIVE_METHODS, WARRANTY_OPTIONS } from '@/data/options';
import { useApi, useManufacturers, useModels, useProductTypes, useShippingProfiles } from '@/data/db';
import { qs } from '@/data/keys';
import { CodeInput } from '@/components/shared/code-input';
import { JobLinks, shopeeDateOff, thaiDate, Warn } from '@/components/jobs/job-checks';
import type { JobChecks } from '@/server/services/job-checks';
import { today } from '@/lib/dates';
import { shipperFor } from '@/lib/shipper';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { clean, cleanCode } from '@/lib/validation';
import {
  imeiAccepts,
  isRequiredFor,
  NO_SERIAL,
  serialAccepts,
  soAccepts,
  WAIT_SERIAL,
  type JobRequiredKey,
} from '@/lib/validation/job';

// Fields get the form as `f` instead of calling useJobForm(): job-form imports this file, so that would be a cycle.
type Form = Pick<ReturnType<typeof useJobForm>, 's' | 'set' | 'patch' | 'errors' | 'loaded'>;
type P = { f: Form };
type Checked = P & { c?: JobChecks | null };

/** changed from the job as loaded — only those get a warning (an edit does not nag about untouched values) */
const edited = ({ s, loaded }: Form, k: keyof JobFormState) => s[k] !== loaded[k];
const never = () => false;

// walk-in (หน้าร้าน): no sale order — SO no. / SO date / expire date may stay empty
const needed = (s: JobFormState, k: JobRequiredKey) => isRequiredFor(k, s.channel);

// Warranty the user has not picked follows the expire date: today or later = IN, passed = OUT
const withExpire = (s: JobFormState, expireDate: string): Partial<JobFormState> =>
  /^\d{4}-\d{2}-\d{2}$/.test(expireDate) && (!s.warranty || s.warrantyAuto)
    ? { expireDate, warranty: expireDate >= today() ? 'IN' : 'OUT', warrantyAuto: true }
    : { expireDate };

// expire date = sale order date + warranty months
const recalcExpire = ({ s, patch }: Form, saleDate: string, months: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return;
  const m = Number(months) || 0;
  const d = new Date(saleDate + 'T00:00:00');
  d.setMonth(d.getMonth() + m);
  const p = (n: number) => String(n).padStart(2, '0');
  patch(withExpire(s, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`));
};

export function SoField({ f, c }: Checked) {
  const { s, set, errors } = f;
  // Shopee's number starts with its order date: far from the Sale Order Date → one of the two is wrong
  const dateOff =
    s.channel === 'SHOPEE' && (edited(f, 'so') || edited(f, 'saleOrderDate')) && soAccepts(s.so, s.channel)
      ? shopeeDateOff(cleanCode(s.so), s.saleOrderDate)
      : null;
  return (
    <Field label="Sale Order No." required={needed(s, 'so')} error={errors.so}>
      <CodeInput
        placeholder="SO2600760"
        className="num"
        maxLength={50}
        value={s.so}
        onChange={(e) => set('so', e.target.value)}
        accepts={edited(f, 'so') ? (v) => soAccepts(v, s.channel) : never}
        onFix={(v) => set('so', v)}
      />
      {!!c?.so.jobs.length && (
        <Warn>
          เลขคำสั่งซื้อนี้อยู่ในงานของลูกค้าคนอื่น: <JobLinks jobs={c.so.jobs} />
        </Warn>
      )}
      {dateOff && <Warn>วันที่ในเลข Shopee คือ {thaiDate(dateOff)} ไม่ตรงกับ Sale Order Date</Warn>}
    </Field>
  );
}

export function ChannelField({ f: { s, set, errors }, repair }: P & { repair?: boolean }) {
  return (
    <Field label={repair ? 'Sale Channel' : 'Channel'} required error={errors.channel}>
      <SearchSelect
        value={s.channel}
        onChange={(v) => set('channel', v)}
        // "ยังไม่ระบุ" is the legacy "none" (counts as empty) — a legacy job still shows its own value
        options={withCurrent(strOptions(CHANNELS.filter((c) => c !== 'ยังไม่ระบุ')), s.channel)}
      />
    </Field>
  );
}

export function SaleDateField({ f }: P) {
  const { s, set, errors } = f;
  return (
    <Field label="Sale Order Date" required={needed(s, 'saleOrderDate')} error={errors.saleOrderDate}>
      <Input
        type="date"
        value={s.saleOrderDate}
        onChange={(e) => {
          set('saleOrderDate', e.target.value);
          recalcExpire(f, e.target.value, s.warrantyMonth);
        }}
      />
    </Field>
  );
}

export function WarrantyMonthField({ f }: P) {
  const { s, set, errors } = f;
  return (
    <Field label="รับประกัน (เดือน)" required error={errors.warrantyMonth}>
      <Input
        type="number"
        min={0}
        max={60}
        inputMode="numeric"
        value={s.warrantyMonth}
        onChange={(e) => {
          set('warrantyMonth', e.target.value);
          recalcExpire(f, s.saleOrderDate, e.target.value);
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="num text-right"
      />
    </Field>
  );
}

export function ExpireField({ f: { s, patch, errors } }: P) {
  return (
    <Field label="Expire Date" required={needed(s, 'expireDate')} error={errors.expireDate}>
      <Input type="date" value={s.expireDate} onChange={(e) => patch(withExpire(s, e.target.value))} />
    </Field>
  );
}

export function WarrantyField({ f: { s, patch, errors } }: P) {
  return (
    <Field label="Warranty" error={errors.warranty}>
      <Select value={s.warranty} onChange={(e) => patch({ warranty: e.target.value, warrantyAuto: false })}>
        <option value="">- - เลือก - -</option>
        {WARRANTY_OPTIONS.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </Select>
    </Field>
  );
}

export function ImeiField({ f }: P) {
  const { s, set, errors } = f;
  const settled = useDebouncedValue(s.imei, 500);
  const short = edited(f, 'imei') && settled === s.imei && /^\d+$/.test(cleanCode(s.imei)) && !imeiAccepts(s.imei);
  return (
    <Field label="Imei No." error={errors.imei}>
      <CodeInput
        className="num"
        inputMode="numeric"
        maxLength={50}
        placeholder="35xxxxxxxxxxxxx"
        value={s.imei}
        onChange={(e) => set('imei', e.target.value)}
        accepts={edited(f, 'imei') ? imeiAccepts : never}
        onFix={(v) => set('imei', v)}
      />
      {short && !errors.imei && (
        <Warn tone="info">IMEI ต้องเป็นตัวเลข 15 หลัก (พิมพ์แล้ว {cleanCode(s.imei).length} หลัก) — ตรวจอีกครั้ง</Warn>
      )}
    </Field>
  );
}

/** the two ticks under Serial No. (one at a time: both are the serial's value) — instead of a note typed into it */
const SERIAL_TICKS = [
  { value: NO_SERIAL, label: 'ไม่มี S/N / S/N เสียหาย' }, // the legacy "none" marker "-"
  { value: WAIT_SERIAL, label: 'รอ S/N จากลูกค้า' },
];

export function SerialField({ f, c }: Checked) {
  const { s, set, patch, errors } = f;
  const tick = SERIAL_TICKS.find((t) => t.value === s.serial.trim());
  const typed = React.useRef('');
  const seen = (edited(f, 'serial') && c?.serial.jobs) || []; // a brand changed alone asks about the brand only
  const sameCustomer = seen.some((j) => j.sameCustomer);
  return (
    <Field label="Serial No." error={errors.serial}>
      <CodeInput
        className="num"
        maxLength={50}
        placeholder={tick?.label ?? 'SN-XXXXXXXX'}
        value={tick ? '' : s.serial}
        disabled={!!tick}
        onChange={(e) => set('serial', e.target.value)}
        accepts={edited(f, 'serial') ? serialAccepts : never}
        onFix={(v) => set('serial', v)}
      />
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {SERIAL_TICKS.map((t) => (
          <label key={t.value} className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={tick === t}
              onChange={(e) => {
                // what was typed is kept aside, and back when the tick goes (not thrown away)
                if (e.target.checked && !tick) typed.current = s.serial;
                set('serial', e.target.checked ? t.value : typed.current);
              }}
            />
            {t.label}
          </label>
        ))}
      </div>
      {tick?.value === WAIT_SERIAL && s.jobNo && (
        <Warn tone="info">ยังรอ S/N จากลูกค้า — ได้แล้วเอาติ๊กออกแล้วใส่ S/N</Warn>
      )}
      {seen.length > 0 && (
        <Warn
          action={
            sameCustomer && !s.isBounce ? { label: 'ติ๊กงานเด้ง', onClick: () => patch({ isBounce: true }) } : undefined
          }
        >
          S/N นี้เคยเข้าซ่อมแล้ว: <JobLinks jobs={seen} /> <span className="whitespace-nowrap">(เปิดแท็บใหม่)</span>
          {sameCustomer ? ' — ลูกค้าคนเดิม' : s.customer ? ' — เป็นงานของลูกค้าคนอื่น ตรวจ S/N อีกครั้ง' : ''}
          {sameCustomer && s.isBounce && ' · ติ๊กงานเด้งแล้ว ✓'}
        </Warn>
      )}
      {c?.serial.looksLike && <Warn>S/N แบบนี้มักเป็นของ {c.serial.looksLike} — ตรวจยี่ห้อ / S/N อีกครั้ง</Warn>}
      {c?.serial.unusual && <Warn tone="info">ยังไม่เคยเห็น S/N รูปแบบนี้ใน {s.brand} — ตรวจอีกครั้งถ้าไม่แน่ใจ</Warn>}
    </Field>
  );
}

export function BrandField({ f: { s, set, errors } }: P) {
  const { data: MANUFACTURERS, ...brandsLookup } = useManufacturers();
  return (
    <Field label="ยี่ห้อ" required error={errors.brand} lookup={brandsLookup}>
      <SearchSelect
        value={s.brand}
        onChange={(v) => set('brand', v)}
        options={withCurrent(
          MANUFACTURERS.map((m) => ({ value: m.name, label: m.name })),
          s.brand,
        )}
        searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
      />
    </Field>
  );
}

export function ModelField({ f: { s, patch, errors } }: P) {
  // the chosen brand's models only (all the picker offers then). The whole list (1,171) only for a brand
  // with no models, a saved model of another brand (its name), or no brand — once the picker is used
  const [wanted, setWanted] = React.useState(false);
  const { data: OWN, ...ownLookup } = useModels('active', { brand: s.brand, enabled: !!s.brand });
  const own = React.useMemo(() => (s.brand ? OWN.filter((m) => m.brand === s.brand) : []), [OWN, s.brand]);
  const needAll = s.brand
    ? !ownLookup.loading && (!own.length || (!!s.modelCode && !own.some((m) => m.code === s.modelCode)))
    : wanted || !!s.modelCode;
  const { data: MODELS, ...modelsLookup } = useModels('active', { enabled: needAll });
  const modelOptions = own.length ? own : MODELS;
  return (
    <Field label="รุ่น" required error={errors.modelCode} lookup={[ownLookup, modelsLookup]}>
      <div className="contents" onFocus={() => setWanted(true)} onPointerDown={() => setWanted(true)}>
        <ModelPicker
          models={modelOptions}
          value={s.modelCode}
          // the stored name while the lists load: the field reads the same before and after
          fallbackName={[...own, ...MODELS].find((m) => m.code === s.modelCode)?.name ?? (s.modelName || undefined)}
          onPick={(m) => patch({ modelCode: m.code, modelName: m.name, brand: m.brand || s.brand })}
        />
      </div>
    </Field>
  );
}

export function ModelDetailField({ f: { s, set, errors } }: P) {
  return (
    <Field label="รุ่นย่อย (ถ้ามี)" error={errors.modelDetail}>
      <Input maxLength={200} value={s.modelDetail} onChange={(e) => set('modelDetail', e.target.value)} />
    </Field>
  );
}

export function ProductTypeField({ f: { s, set, errors } }: P) {
  const { data: PRODUCT_TYPES, ...typesLookup } = useProductTypes();
  return (
    <Field label="ประเภทสินค้า" error={errors.productType} lookup={typesLookup}>
      <SearchSelect
        value={s.productType}
        onChange={(v) => set('productType', v)}
        options={withCurrent(
          PRODUCT_TYPES.map((p) => ({ value: p.name, label: p.name })),
          s.productType,
        )}
      />
    </Field>
  );
}

/** the two-column free-text notes (อาการเสีย (อื่นๆ) / หมายเหตุ) */
export function NoteField({
  f: { s, set, errors },
  k,
  label,
  maxLength,
  placeholder,
}: P & {
  k: 'symptomOther' | 'remark';
  label: string;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} className="lg:col-span-2" error={errors[k]}>
      <Textarea
        rows={2}
        maxLength={maxLength}
        placeholder={placeholder}
        value={s[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
}

/**
 * Free text with the values typed before that contain what is typed, most used first (GET /api/jobs/suggestions)
 * — the browser's own list (datalist): pick one or keep what you typed. Read once the field is first focused.
 */
function SuggestInput({
  field,
  value,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { field: 'shop' | 'accessories' | 'defects'; value: string }) {
  const listId = React.useId();
  const [wanted, setWanted] = React.useState(false);
  const q = useDebouncedValue(clean(value), 250);
  const { data } = useApi<{ values: string[] }>(wanted ? `/api/jobs/suggestions${qs({ field, q })}` : null, {
    quiet: true,
    keepPrevious: true,
  });
  return (
    <>
      {/* title: a value longer than the one-line box reads in full on hover */}
      <Input
        {...props}
        list={listId}
        value={value}
        title={String(value ?? '') || undefined}
        onFocus={() => setWanted(true)}
      />
      <datalist id={listId}>
        {data?.values.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}

/** อุปกรณ์ (ที่นำส่ง) / จุดตำหนิ: free text, what was typed before as suggestions */
export function SuggestNoteField({
  f: { s, set, errors },
  k,
  label,
  placeholder,
}: P & { k: 'equipment' | 'fault'; label: string; placeholder: string }) {
  return (
    <Field label={label} className="lg:col-span-2" error={errors[k]}>
      <SuggestInput
        field={k === 'equipment' ? 'accessories' : 'defects'}
        maxLength={100}
        placeholder={placeholder}
        value={s[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
}

/** Shop Name of เปิดงาน: free text (511 spellings in the legacy data), the names typed before as suggestions */
export function ShopSuggestField({ f: { s, set, errors }, c }: Checked) {
  return (
    <Field label="Shop Name" error={errors.shopName}>
      <SuggestInput
        field="shop"
        maxLength={100}
        placeholder="- - เลือกหรือพิมพ์ - -"
        value={s.shopName}
        onChange={(e) => set('shopName', e.target.value)}
      />
      {c?.shop.brand && <Warn>ร้านนี้ขาย {c.shop.brand} เป็นหลัก — ตรวจยี่ห้อ / ร้านอีกครั้ง</Warn>}
    </Field>
  );
}

/** Shop Name elsewhere: a plain input */
export function ShopPlainField({ f: { s, set, errors } }: P) {
  return (
    <Field label="Shop Name" error={errors.shopName}>
      <Input
        placeholder="ชื่อร้านค้า"
        maxLength={100}
        value={s.shopName}
        onChange={(e) => set('shopName', e.target.value)}
      />
    </Field>
  );
}

export function ReceptionDateField({ f: { s, set, errors } }: P) {
  return (
    <Field label="วันที่รับเข้า" error={errors.receptionDate}>
      <Input type="date" value={s.receptionDate} onChange={(e) => set('receptionDate', e.target.value)} />
    </Field>
  );
}

export function TrackingField({ f: { s, set, errors } }: P) {
  return (
    <Field
      label="เลขพัสดุจากลูกค้า"
      error={errors.receptionTrackingNo}
      hint="ไม่มีเลขพัสดุ (ลูกค้า / ไรเดอร์มาส่งเอง) ให้เว้นว่าง แล้วเลือก รับสินค้าเข้าโดย"
    >
      <Input
        className="num"
        maxLength={50}
        value={s.receptionTrackingNo}
        onChange={(e) => set('receptionTrackingNo', e.target.value)}
      />
    </Field>
  );
}

export function ShipperField({ f: { s, set, errors } }: P) {
  const { data: SHIPPING_PROFILES, ...shippingLookup } = useShippingProfiles();
  // courier names from โปรไฟล์บริษัทขนส่ง; a legacy free-text value is that profile when it is one of its names
  // ("THAIPOST" → ไปรษณีย์ไทย, src/lib/shipper.ts), else it stays selectable as-is ("(ค่าเดิม)")
  const matched = shipperFor(SHIPPING_PROFILES, s.receptionShipper);
  const legacyShipper = s.receptionShipper && !matched ? s.receptionShipper : '';
  // the API accepts a profile name or the job's own legacy value only (no free text)
  return (
    <Field label="โดยบริษัทขนส่ง" error={errors.receptionShipper} lookup={shippingLookup}>
      <Select value={matched?.nameTh ?? s.receptionShipper} onChange={(e) => set('receptionShipper', e.target.value)}>
        <option value="">- - เลือก - -</option>
        {SHIPPING_PROFILES.map((p) => (
          <option key={p.id} value={p.nameTh}>
            {p.nameTh}
          </option>
        ))}
        {/* not "(ค่าเดิม)" before the profiles are in: it may still turn out to be one ("F" → Flash Express) */}
        {legacyShipper && (
          <option value={legacyShipper}>
            {legacyShipper}
            {shippingLookup.loading ? '' : ' (ค่าเดิม)'}
          </option>
        )}
      </Select>
    </Field>
  );
}

export function ReceptionTypeField({ f: { s, set, errors } }: P) {
  return (
    <Field label="รับสินค้าเข้าโดย" wide group="radiogroup" error={errors.receptionType}>
      <div className="flex flex-wrap gap-4 rounded-md border border-border bg-muted/40 px-3 py-2">
        {RECEIVE_METHODS.map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
            <Radio name="receive-method" checked={s.receptionType === m} onChange={() => set('receptionType', m)} />
            {m}
          </label>
        ))}
      </div>
    </Field>
  );
}
