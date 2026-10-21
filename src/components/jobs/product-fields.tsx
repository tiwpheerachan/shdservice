'use client';

import * as React from 'react';
import { ModelPicker } from '@/components/shared/model-picker';
import { SearchSelect, strOptions, withCurrent } from '@/components/shared/search-select';
import type { JobFormState, useJobForm } from '@/components/shared/job-form';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea, Radio, Checkbox } from '@/components/ui/input';
import { CHANNELS, RECEIVE_METHODS, WARRANTY_OPTIONS } from '@/data/options';
import { useManufacturers, useModels, useProductTypes, useShopNames, useShippingProfiles } from '@/data/db';
import { today } from '@/lib/dates';
import { isRequiredFor, NO_SERIAL, type JobRequiredKey } from '@/lib/validation/job';

/**
 * The fields of ProductSection (job-form), one component each so its layouts read as a list.
 * They get the job form as `f` (useJobForm()) instead of reading the context themselves — job-form
 * imports this file, so importing its hook back would make a cycle.
 */
type Form = Pick<ReturnType<typeof useJobForm>, 's' | 'set' | 'patch' | 'errors'>;
type P = { f: Form };

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

export function SoField({ f: { s, set, errors } }: P) {
  return (
    <Field label="Sale Order No." required={needed(s, 'so')} error={errors.so}>
      <Input
        placeholder="SO2600760"
        className="num"
        maxLength={50}
        value={s.so}
        onChange={(e) => set('so', e.target.value)}
      />
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
        <option value="">- - Please Select - -</option>
        {WARRANTY_OPTIONS.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </Select>
    </Field>
  );
}

export function ImeiField({ f: { s, set, errors } }: P) {
  return (
    <Field label="Imei No." error={errors.imei}>
      <Input
        className="num"
        inputMode="numeric"
        maxLength={50}
        placeholder="35xxxxxxxxxxxxx"
        value={s.imei}
        onChange={(e) => set('imei', e.target.value)}
      />
    </Field>
  );
}

export function SerialField({ f: { s, set, errors } }: P) {
  const noSerial = s.serial.trim() === NO_SERIAL;
  return (
    <Field label="Serial No." required error={errors.serial}>
      <Input
        className="num"
        maxLength={50}
        placeholder={noSerial ? 'ไม่มี S/N / S/N เสียหาย' : 'SN-XXXXXXXX'}
        value={noSerial ? '' : s.serial}
        disabled={noSerial}
        onChange={(e) => set('serial', e.target.value)}
      />
      {/* stored as the legacy "none" marker "-" (NO_SERIAL) — instead of typing a note into the serial */}
      <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={noSerial} onChange={(e) => set('serial', e.target.checked ? NO_SERIAL : '')} />
        ไม่มี S/N / S/N เสียหาย
      </label>
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

/** the two-column free-text notes (อุปกรณ์ / จุดตำหนิ / อาการเสีย (อื่นๆ) / หมายเหตุ) */
export function NoteField({
  f: { s, set, errors },
  k,
  label,
  maxLength,
  placeholder,
}: P & {
  k: 'equipment' | 'fault' | 'symptomOther' | 'remark';
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

/** Shop Name of เปิดงาน: free text with the most used names as suggestions */
export function ShopSuggestField({ f: { s, set, errors } }: P) {
  const { data: SHOP_NAMES, ...shopNamesLookup } = useShopNames();
  return (
    <Field label="Shop Name" error={errors.shopName} lookup={shopNamesLookup}>
      {/* free text in the legacy data (511 spellings) — the most used names as suggestions, new ones can be typed */}
      <Input
        list="shop-name-options"
        maxLength={100}
        placeholder="- - เลือกหรือพิมพ์ - -"
        value={s.shopName}
        onChange={(e) => set('shopName', e.target.value)}
      />
      <datalist id="shop-name-options">
        {SHOP_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
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
  // courier names from โปรไฟล์บริษัทขนส่ง; a legacy free-text value ("F", "flash" …) stays selectable as-is
  const legacyShipper =
    s.receptionShipper && !SHIPPING_PROFILES.some((p) => p.nameTh === s.receptionShipper) ? s.receptionShipper : '';
  // the API accepts a profile name or the job's own legacy value only (no free text)
  return (
    <Field label="โดยบริษัทขนส่ง" error={errors.receptionShipper} lookup={shippingLookup}>
      <Select value={s.receptionShipper} onChange={(e) => set('receptionShipper', e.target.value)}>
        <option value="">- - Please Select - -</option>
        {SHIPPING_PROFILES.map((p) => (
          <option key={p.id} value={p.nameTh}>
            {p.nameTh}
          </option>
        ))}
        {legacyShipper && <option value={legacyShipper}>{legacyShipper} (ค่าเดิม)</option>}
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
