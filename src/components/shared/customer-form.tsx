"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea, Select, Radio } from "@/components/ui/input";
import { SearchSelect } from "./search-select";
import { Button } from "@/components/ui/button";
import { type Customer, CUSTOMER_TYPES, PRICE_GROUPS } from "@/data/mock";
import { useProvinces } from "@/data/db";
import { api, qs } from "@/lib/api";

/**
 * Customer form shared by the ข้อมูลลูกค้า page (modal) and CustomerSelect
 * (inline "ลูกค้าใหม่" on job / quotation / sale order). One source of truth for
 * the fields, the cascading address lists and the payload shape (/api/customers).
 */
export type Opt = { id: number; name: string; postal?: string };

export type CustomerFormValues = {
  code: string;
  type: string;
  online: boolean;
  name: string;
  taxId: string;
  address1: string;
  address2: string;
  cityId: number;
  districtId: number;
  subDistrictId: number;
  postalCode: string;
  phone: string;
  email: string;
  line: string;
  priceGroup: string;
  status: string;
};

export const EMPTY_CUSTOMER: CustomerFormValues = {
  code: "",
  type: "Normal",
  online: true,
  name: "",
  taxId: "",
  address1: "",
  address2: "",
  cityId: -1,
  districtId: -1,
  subDistrictId: -1,
  postalCode: "",
  phone: "",
  email: "",
  line: "",
  priceGroup: PRICE_GROUPS[0],
  status: "Active",
};

export const toCustomerForm = (c: Customer): CustomerFormValues => ({
  code: c.code,
  type: c.type ?? "Normal",
  online: c.online !== false,
  name: c.name,
  taxId: c.taxId,
  address1: c.address1 || c.address,
  address2: c.address2 ?? "",
  cityId: c.cityId ?? -1,
  districtId: c.districtId ?? -1,
  subDistrictId: c.subDistrictId ?? -1,
  postalCode: c.postalCode ?? "",
  phone: c.phone,
  email: c.email,
  line: c.line,
  priceGroup: c.priceGroup ?? PRICE_GROUPS[0],
  status: c.status,
});

/** cascading address lists (mt_city → mt_district → mt_sub_district) */
export function useAddressLists(cityId: number, districtId: number) {
  const { data: PROVINCES } = useProvinces();
  const [districts, setDistricts] = React.useState<Opt[]>([]);
  const [subDistricts, setSubDistricts] = React.useState<Opt[]>([]);
  React.useEffect(() => {
    if (cityId > 0) {
      api<{ rows: Opt[] }>(`/api/address${qs({ level: "district", city: cityId })}`)
        .then((d) => setDistricts(d.rows))
        .catch(() => setDistricts([]));
    } else setDistricts([]);
  }, [cityId]);
  React.useEffect(() => {
    if (districtId > 0) {
      api<{ rows: Opt[] }>(`/api/address${qs({ level: "subdistrict", district: districtId })}`)
        .then((d) => setSubDistricts(d.rows))
        .catch(() => setSubDistricts([]));
    } else setSubDistricts([]);
  }, [districtId]);
  return { PROVINCES, districts, subDistricts };
}

/** Server 409 payload when phone / email / tax id already belong to another customer. */
export type CustomerConflict = { field: "phone" | "email" | "taxId"; value: string; code: string; name: string; phone: string; email: string; taxId: string };
const FIELD_LABEL: Record<CustomerConflict["field"], string> = { phone: "เบอร์โทรศัพท์", email: "อีเมล", taxId: "เลขบัตร / ผู้เสียภาษี" };

export function ConflictNotice({ conflicts, onPick }: { conflicts: CustomerConflict[]; onPick?: (code: string) => void }) {
  const byCode = new Map<string, CustomerConflict & { fields: string[] }>();
  for (const c of conflicts) {
    const cur = byCode.get(c.code) ?? { ...c, fields: [] };
    cur.fields.push(FIELD_LABEL[c.field]);
    byCode.set(c.code, cur);
  }
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-danger">
        <AlertTriangle className="h-4 w-4" /> ข้อมูลนี้มีลูกค้าอยู่แล้ว — ระบบไม่สร้างซ้ำ
      </p>
      <ul className="mt-2 space-y-1.5">
        {[...byCode.values()].map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2">
            <span className="num font-medium">{c.code}</span>
            <span>{c.name}</span>
            <span className="num text-xs text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}{c.taxId ? ` · ${c.taxId}` : ""}</span>
            <span className="text-xs text-danger">ซ้ำ: {c.fields.join(", ")}</span>
            {onPick && (
              <Button size="sm" variant="outline" onClick={() => onPick(c.code)}>
                ใช้ลูกค้ารายนี้
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
}: {
  form: CustomerFormValues;
  setForm: React.Dispatch<React.SetStateAction<CustomerFormValues>>;
  editing: Customer | null;
  showStatus?: boolean;
  extra?: React.ReactNode;
}) {
  const set = <K extends keyof CustomerFormValues>(k: K, v: CustomerFormValues[K]) => setForm((f) => ({ ...f, [k]: v }));
  const { PROVINCES, districts, subDistricts } = useAddressLists(form.cityId, form.districtId);
  return (
    <FieldGrid cols={2}>
      <Field label="รหัสลูกค้า" required>
        <Input value={editing?.code || "Generate Auto"} readOnly />
      </Field>
      <Field label="ประเภทลูกค้า">
        <div className="flex items-center gap-3">
          <Select value={form.type} onChange={(e) => set("type", e.target.value)} className="flex-1">
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <div className="flex shrink-0 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Radio name="customer-channel" checked={form.online} onChange={() => set("online", true)} /> On-Line
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Radio name="customer-channel" checked={!form.online} onChange={() => set("online", false)} /> Off-Line
            </label>
          </div>
        </div>
      </Field>

      <Field label="ชื่อลูกค้า" required wide>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี" wide>
        <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} className="num" />
      </Field>

      <Field
        label="ที่อยู่ เลขที่"
        wide
        hint={
          editing && (editing.cityId ?? -1) <= 0 && form.address1
            ? "ที่อยู่เดิมจากระบบเก่ายังไม่แยกจังหวัด/อำเภอ — ถ้าจะเลือกจังหวัดด้านล่าง กรุณาตัดส่วนตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ออกจากช่องนี้ก่อน ไม่เช่นนั้นที่อยู่จะซ้ำ"
            : undefined
        }
      >
        <Textarea
          rows={2}
          value={form.address1}
          onChange={(e) => set("address1", e.target.value)}
          placeholder="บ้านเลขที่ / หมู่ / หมู่บ้าน / อาคาร"
        />
      </Field>

      <Field label="ซอย - ถนน">
        <Input value={form.address2} onChange={(e) => set("address2", e.target.value)} placeholder="ซอย / ถนน" />
      </Field>
      <Field label="จังหวัด">
        <SearchSelect
          value={form.cityId > 0 ? String(form.cityId) : ""}
          onChange={(v) => setForm((f) => ({ ...f, cityId: Number(v) || -1, districtId: -1, subDistrictId: -1 }))}
          options={PROVINCES.map((p) => ({ value: String(p.id), label: p.name }))}
          searchPlaceholder="พิมพ์ชื่อจังหวัด…"
        />
      </Field>
      <Field label="เขต / อำเภอ">
        <SearchSelect
          value={form.districtId > 0 ? String(form.districtId) : ""}
          onChange={(v) => setForm((f) => ({ ...f, districtId: Number(v) || -1, subDistrictId: -1 }))}
          options={districts.map((d) => ({ value: String(d.id), label: d.name }))}
          disabled={form.cityId <= 0}
          searchPlaceholder="พิมพ์ชื่อเขต / อำเภอ…"
        />
      </Field>
      <Field label="แขวง / ตำบล">
        <SearchSelect
          value={form.subDistrictId > 0 ? String(form.subDistrictId) : ""}
          onChange={(v) => {
            const id = Number(v) || -1;
            const hit = subDistricts.find((s) => s.id === id);
            setForm((f) => ({ ...f, subDistrictId: id, postalCode: hit?.postal || f.postalCode }));
          }}
          options={subDistricts.map((s) => ({ value: String(s.id), label: s.name, sub: s.postal || undefined }))}
          disabled={form.districtId <= 0}
          searchPlaceholder="พิมพ์ชื่อแขวง / ตำบล หรือรหัสไปรษณีย์…"
        />
      </Field>
      <Field label="รหัสไปรษณีย์">
        <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} className="num" placeholder="10000" />
      </Field>
      <Field label="เบอร์โทรศัพท์" required>
        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="num" />
      </Field>

      <Field label="Email">
        <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Line ID">
        <Input value={form.line} onChange={(e) => set("line", e.target.value)} />
      </Field>

      <Field label="ใช้กลุ่มราคา">
        <Select value={form.priceGroup} onChange={(e) => set("priceGroup", e.target.value)}>
          {PRICE_GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </Select>
      </Field>
      {showStatus && (
        <Field label="สถานะ">
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
      )}
      {extra}
    </FieldGrid>
  );
}
