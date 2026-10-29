'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Textarea, Select, Radio } from '@/components/ui/input';
import { SearchSelect } from './search-select';
import { Button } from '@/components/ui/button';
import { CUSTOMER_TYPES, PRICE_GROUPS } from '@/data/options';
import type { Customer } from '@/data/types';
import { TTL_MASTER, useApi, useProvinces } from '@/data/db';
import { errMsg, postJson, qs } from '@/lib/api';
import type { FieldErrors } from '@/lib/validation';
import { useAccess } from '@/lib/use-access';
import { useFormErrors } from '@/lib/use-form-errors';
import { useToast } from '@/components/ui/toast';
import { isIndividual } from '@/lib/validation/customer';

/**
 * Customer form shared by the ข้อมูลลูกค้า page (modal) and CustomerSelect
 * (inline "ลูกค้าใหม่" on job / quotation / sale order). One source of truth for
 * the fields, the cascading address lists and the payload shape (/api/customers).
 */
export type Opt = { id: string; name: string; postal?: string };

export type CustomerFormValues = {
  code: string;
  type: string;
  online: boolean;
  name: string;
  taxId: string;
  address1: string;
  address2: string;
  /** uuids of the picked จังหวัด / อำเภอ / ตำบล — '' = not picked */
  cityId: string;
  districtId: string;
  subDistrictId: string;
  postalCode: string;
  phone: string;
  email: string;
  line: string;
  priceGroup: string;
  status: string;
  /** customer.row_version as loaded (an edit sends it back; 409 when someone saved in between) */
  version?: number;
};

export const EMPTY_CUSTOMER: CustomerFormValues = {
  code: '',
  type: 'Normal',
  online: true,
  name: '',
  taxId: '',
  address1: '',
  address2: '',
  cityId: '',
  districtId: '',
  subDistrictId: '',
  postalCode: '',
  phone: '',
  email: '',
  line: '',
  priceGroup: PRICE_GROUPS[0],
  status: 'Active',
};

export const toCustomerForm = (c: Customer): CustomerFormValues => ({
  code: c.code,
  type: c.type ?? 'Normal',
  online: c.online !== false,
  name: c.name,
  taxId: c.taxId,
  address1: c.address1 || c.address,
  address2: c.address2 ?? '',
  cityId: c.cityId ?? '',
  districtId: c.districtId ?? '',
  subDistrictId: c.subDistrictId ?? '',
  postalCode: c.postalCode ?? '',
  phone: c.phone,
  email: c.email,
  line: c.line,
  priceGroup: c.priceGroup ?? PRICE_GROUPS[0],
  status: c.status,
  version: c.version,
});

/** cascading address lists (mt_city → mt_district → mt_sub_district) */
export function useAddressLists(cityId: string, districtId: string) {
  const { data: PROVINCES, ...provinces } = useProvinces();
  // master data: read once, shared by every customer form (5 min cache like the other masters)
  const { data: d, ...dLoad } = useApi<{ rows: Opt[] }>(
    cityId ? `/api/address${qs({ level: 'district', city: cityId })}` : null,
    { ttl: TTL_MASTER },
  );
  const { data: sd, ...sdLoad } = useApi<{ rows: Opt[] }>(
    districtId ? `/api/address${qs({ level: 'subdistrict', district: districtId })}` : null,
    { ttl: TTL_MASTER },
  );
  const districts = React.useMemo(() => (cityId ? (d?.rows ?? []) : []), [cityId, d]);
  const subDistricts = React.useMemo(() => (districtId ? (sd?.rows ?? []) : []), [districtId, sd]);
  return {
    PROVINCES,
    districts,
    subDistricts,
    /** re-read the sub-districts (after "+ เพิ่มชื่อ" added one) */
    reloadSubDistricts: sdLoad.mutate,
    /** for each list's <Field lookup> — a failed load says so instead of an empty dropdown */
    lookups: {
      provinces,
      districts: { error: dLoad.error, refetch: () => void dLoad.mutate() },
      subDistricts: { error: sdLoad.error, refetch: () => void sdLoad.mutate() },
    },
  };
}

/** Server 409 payload when phone / email / tax id already belong to another customer. */
export type CustomerConflict = {
  field: 'phone' | 'email' | 'taxId';
  value: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  taxId: string;
};
const FIELD_LABEL: Record<CustomerConflict['field'], string> = {
  phone: 'เบอร์โทรศัพท์',
  email: 'อีเมล',
  taxId: 'เลขบัตร / ผู้เสียภาษี',
};

export function ConflictNotice({
  conflicts,
  onPick,
  pickLabel = 'ใช้ลูกค้ารายนี้',
  editing = false,
}: {
  conflicts: CustomerConflict[];
  onPick?: (code: string) => void;
  pickLabel?: string;
  /** an existing customer's edit — nothing is being created */
  editing?: boolean;
}) {
  const byCode = new Map<string, CustomerConflict & { fields: string[] }>();
  for (const c of conflicts) {
    const cur = byCode.get(c.code) ?? { ...c, fields: [] };
    cur.fields.push(FIELD_LABEL[c.field]);
    byCode.set(c.code, cur);
  }
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-danger">
        <AlertTriangle className="h-4 w-4" />{' '}
        {editing ? 'ข้อมูลนี้เป็นของลูกค้ารายอื่นแล้ว — ระบบไม่บันทึก' : 'ข้อมูลนี้มีลูกค้าอยู่แล้ว — ระบบไม่สร้างซ้ำ'}
      </p>
      <ul className="mt-2 space-y-1.5">
        {[...byCode.values()].map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2">
            <span className="num font-medium">{c.code}</span>
            <span>{c.name}</span>
            <span className="num text-xs text-muted-foreground">
              {c.phone}
              {c.email ? ` · ${c.email}` : ''}
              {c.taxId ? ` · ${c.taxId}` : ''}
            </span>
            <span className="text-xs text-danger">ซ้ำ: {c.fields.join(', ')}</span>
            {onPick && (
              <Button size="sm" variant="outline" onClick={() => onPick(c.code)}>
                {pickLabel}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CustomerFields({
  form,
  setForm,
  editing,
  showStatus = true,
  extra,
  errors = {},
  clearError,
}: {
  form: CustomerFormValues;
  setForm: React.Dispatch<React.SetStateAction<CustomerFormValues>>;
  editing: Customer | null;
  showStatus?: boolean;
  extra?: React.ReactNode;
  /** from useFormErrors — shown under each field */
  errors?: FieldErrors;
  clearError?: (key: string) => void;
}) {
  const set = <K extends keyof CustomerFormValues>(k: K, v: CustomerFormValues[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    clearError?.(k);
  };
  const { PROVINCES, districts, subDistricts, reloadSubDistricts, lookups } = useAddressLists(
    form.cityId,
    form.districtId,
  );
  const canAddSubDistrict = useAccess().can('Customer', 'edit') && !!form.districtId;
  const [addingSubDistrict, setAddingSubDistrict] = React.useState(false);
  // a hint only, never an error — the master's code is wrong for some ตำบล (Mueang Chiang Mai: all 50000)
  const postalHint = subDistricts.find((s) => s.id === form.subDistrictId)?.postal?.trim();
  // no maxLength on the text boxes (it cut a paste silently): the rules say it in Thai; a count once near the limit
  const count = (v: string, max: number) => (v.length > max - 20 ? `${v.length} / ${max} ตัวอักษร` : undefined);
  return (
    <FieldGrid cols={2}>
      <Field label="รหัสลูกค้า">
        <Input value={editing?.code || 'ออกรหัสอัตโนมัติเมื่อบันทึก'} readOnly />
      </Field>
      <Field label="ประเภทลูกค้า" error={errors.type}>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={form.type} onChange={(e) => set('type', e.target.value)} className="min-w-28 flex-1">
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <div className="flex shrink-0 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Radio name="customer-channel" checked={form.online} onChange={() => set('online', true)} /> On-Line
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Radio name="customer-channel" checked={!form.online} onChange={() => set('online', false)} /> Off-Line
            </label>
          </div>
        </div>
      </Field>

      <Field label="ชื่อลูกค้า" required wide error={errors.name} hint={count(form.name, 200)}>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>

      <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี" wide error={errors.taxId}>
        <Input
          inputMode="numeric"
          placeholder="13 หลัก"
          value={form.taxId}
          onChange={(e) => set('taxId', e.target.value)}
          className="num"
        />
      </Field>

      <Field
        label="ที่อยู่ เลขที่"
        wide
        error={errors.address1}
        hint={
          editing && !editing.cityId && form.address1
            ? 'ที่อยู่เดิมจากระบบเก่ายังไม่แยกจังหวัด/อำเภอ — ถ้าจะเลือกจังหวัดด้านล่าง กรุณาตัดส่วนตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ออกจากช่องนี้ก่อน ไม่เช่นนั้นที่อยู่จะซ้ำ'
            : count(form.address1, 100)
        }
      >
        <Textarea
          rows={2}
          value={form.address1}
          onChange={(e) => set('address1', e.target.value)}
          placeholder="บ้านเลขที่ / หมู่ / หมู่บ้าน / อาคาร"
        />
      </Field>

      <Field label="ซอย - ถนน" error={errors.address2} hint={count(form.address2, 100)}>
        <Input value={form.address2} onChange={(e) => set('address2', e.target.value)} placeholder="ซอย / ถนน" />
      </Field>
      <Field label="จังหวัด" lookup={lookups.provinces}>
        <SearchSelect
          value={form.cityId}
          onChange={(v) => setForm((f) => ({ ...f, cityId: v, districtId: '', subDistrictId: '', postalCode: '' }))}
          options={PROVINCES.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="- - เลือกจังหวัด - -"
          emptyLabel="- - เลือกจังหวัด - -"
          searchPlaceholder="พิมพ์ชื่อจังหวัด…"
        />
      </Field>
      <Field label="เขต / อำเภอ" lookup={lookups.districts}>
        <SearchSelect
          value={form.districtId}
          onChange={(v) => setForm((f) => ({ ...f, districtId: v, subDistrictId: '', postalCode: '' }))}
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
          disabled={!form.cityId}
          searchPlaceholder="พิมพ์ชื่อเขต / อำเภอ…"
        />
      </Field>
      <Field label="แขวง / ตำบล" lookup={lookups.subDistricts}>
        <SearchSelect
          value={form.subDistrictId}
          onChange={(v) => {
            const hit = subDistricts.find((s) => s.id === v);
            setForm((f) => ({ ...f, subDistrictId: v, postalCode: hit?.postal || f.postalCode }));
            clearError?.('postalCode');
          }}
          options={subDistricts.map((s) => ({ value: s.id, label: s.name, sub: s.postal || undefined }))}
          disabled={!form.districtId}
          searchPlaceholder="พิมพ์ชื่อแขวง / ตำบล หรือรหัสไปรษณีย์…"
        />
        {canAddSubDistrict && !addingSubDistrict && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-1 h-auto px-0"
            onClick={() => setAddingSubDistrict(true)}
          >
            + เพิ่มชื่อ (ไม่มีในรายการ)
          </Button>
        )}
      </Field>
      {canAddSubDistrict && addingSubDistrict && (
        <AddSubDistrict
          districtId={form.districtId}
          postal={subDistricts[0]?.postal?.trim() ?? ''}
          onDone={async (row) => {
            setAddingSubDistrict(false);
            if (!row) return;
            await reloadSubDistricts();
            setForm((f) => ({ ...f, subDistrictId: row.id, postalCode: row.postal }));
            clearError?.('postalCode');
          }}
        />
      )}
      <Field
        label="รหัสไปรษณีย์"
        error={errors.postalCode}
        hint={
          postalHint && form.postalCode.trim() && postalHint !== form.postalCode.trim()
            ? `ตำบลนี้ในระบบใช้ ${postalHint} — ถ้ารหัสที่กรอกถูกต้องแล้ว บันทึกได้เลย`
            : undefined
        }
      >
        <Input
          inputMode="numeric"
          value={form.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
          className="num"
          placeholder="10000"
        />
      </Field>
      <Field
        label="เบอร์โทรศัพท์"
        required={!editing || !!editing.phone?.trim()}
        error={errors.phone}
        hint={
          editing
            ? 'มือถือใช้รับ OTP ติดตามงาน'
            : isIndividual(form.type)
              ? 'ลูกค้าบุคคลต้องมีเบอร์มือถือ — มือถือใช้รับ OTP ติดตามงาน'
              : 'นิติบุคคล / ตัวแทน ใช้เบอร์สำนักงานได้ — มือถือใช้รับ OTP ติดตามงาน'
        }
      >
        <Input inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="num" />
      </Field>

      <Field label="Email" error={errors.email}>
        <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="Line ID" error={errors.line}>
        <Input value={form.line} onChange={(e) => set('line', e.target.value)} />
      </Field>

      <Field label="ใช้กลุ่มราคา" error={errors.priceGroup}>
        <Select value={form.priceGroup} onChange={(e) => set('priceGroup', e.target.value)}>
          {PRICE_GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </Select>
      </Field>
      {showStatus && (
        <Field label="สถานะ">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
      )}
      {extra}
    </FieldGrid>
  );
}

/** "+ เพิ่มชื่อ" แขวง / ตำบล (as the legacy form had it): saved to the address list for everyone (Customer edit) */
function AddSubDistrict({
  districtId,
  postal: postal0,
  onDone,
}: {
  districtId: string;
  postal: string;
  onDone: (row: (Opt & { postal: string }) | null) => void | Promise<void>;
}) {
  const [name, setName] = React.useState('');
  const [postal, setPostal] = React.useState(postal0);
  const [busy, setBusy] = React.useState(false);
  const fe = useFormErrors();
  const { push } = useToast();
  const save = async () => {
    setBusy(true);
    try {
      const d = await postJson<{ row: Opt & { postal: string } }>('/api/address', {
        district: districtId,
        name,
        postal,
      });
      push({ kind: 'success', title: 'เพิ่มแขวง / ตำบลแล้ว', desc: d.row.name });
      await onDone(d.row);
    } catch (e) {
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'เพิ่มไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 col-span-full sm:grid-cols-[1fr_8rem_auto]">
      <Field label="ชื่อแขวง / ตำบลใหม่" required error={fe.errors.name}>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            fe.clear('name');
          }}
        />
      </Field>
      <Field label="รหัสไปรษณีย์" required error={fe.errors.postal}>
        <Input
          inputMode="numeric"
          className="num"
          value={postal}
          onChange={(e) => {
            setPostal(e.target.value);
            fe.clear('postal');
          }}
        />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
          บันทึกชื่อ
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onDone(null)}>
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
