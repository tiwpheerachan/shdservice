'use client';

import * as React from 'react';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { modelNameOptions } from '@/components/shared/model-picker';
import { Field, type Lookup } from '@/components/ui/field';
import { Input, Select, Checkbox } from '@/components/ui/input';
import { WARRANTY_OPTIONS } from '@/data/options';
import { useJobTypes, useManufacturers, useModels, useJobTypeDetails, useJobStatuses, type Staff } from '@/data/db';
import type { Filters } from './use-job-list-url';

export function JobFilterBar({
  draft,
  setDraft,
  setD,
  onSearch,
  onReset,
  staff: STAFF,
  staffLookup,
}: {
  draft: Filters;
  setDraft: React.Dispatch<React.SetStateAction<Filters>>;
  setD: <K extends keyof Filters>(k: K, v: Filters[K]) => void;
  onSearch: () => void;
  onReset: () => void;
  staff: Staff[];
  staffLookup: Lookup;
}) {
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const { data: JOB_TYPE_DETAILS, ...typeDetailsLookup } = useJobTypeDetails();
  const { data: BRANDS, ...brandsLookup } = useManufacturers();
  // a chosen brand loads only its models; without one the whole list waits until the รุ่น field is first used
  const [modelsWanted, setModelsWanted] = React.useState(false);
  const wantModels = () => setModelsWanted(true);
  const { data: MODELS, ...modelsLookup } = useModels('active', {
    brand: draft.brand,
    enabled: !!draft.brand || !!draft.model || modelsWanted,
  });
  // models narrow to the chosen brand (1,171 models in total)
  const MODEL_OPTIONS = React.useMemo(() => modelNameOptions(MODELS, draft.brand), [MODELS, draft.brand]);
  const BRAND_OPTIONS = React.useMemo(() => BRANDS.map((b) => ({ value: b.name, label: b.name })), [BRANDS]);
  const JOB_TYPE_OPTIONS = React.useMemo(() => JOB_TYPES.map((j) => ({ value: j.name, label: j.name })), [JOB_TYPES]);
  const STAFF_OPTIONS = React.useMemo(
    () => STAFF.map((st) => ({ value: String(st.id), label: st.name, sub: st.userType || undefined })),
    [STAFF],
  );
  const all = { placeholder: 'ทั้งหมด', emptyLabel: 'ทั้งหมด' };
  // every status in the DB (25, incl. ones the old hard-coded list missed), in workflow order
  const { data: JOB_STATUSES, ...statusesLookup } = useJobStatuses();
  const STATUS_OPTIONS = React.useMemo(
    () =>
      [...JOB_STATUSES]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          value: String(s.id),
          label: s.name.trim(),
          sub: s.active ? s.group : `${s.group} · ไม่ใช้งาน`,
        })),
    [JOB_STATUSES],
  );

  return (
    <FilterBar onSearch={onSearch} onReset={onReset}>
      <Field label="เลขที่งาน">
        <Input placeholder="J2612164" className="num" value={draft.no} onChange={(e) => setD('no', e.target.value)} />
      </Field>
      <Field label="เลขคำสั่งซื้อ">
        <Input
          placeholder="เลขคำสั่งซื้อ Shopee / Lazada …"
          className="num"
          value={draft.ref}
          onChange={(e) => setD('ref', e.target.value)}
        />
      </Field>
      <Field label="ยี่ห้อ" lookup={brandsLookup}>
        <SearchSelect
          {...all}
          value={draft.brand}
          onChange={(v) => setDraft((f) => ({ ...f, brand: v, model: '' }))}
          options={BRAND_OPTIONS}
          searchPlaceholder="พิมพ์ชื่อยี่ห้อ…"
        />
      </Field>
      <Field label="รุ่น" lookup={modelsLookup}>
        <div className="contents" onFocus={wantModels} onPointerDown={wantModels}>
          <SearchSelect
            {...all}
            value={draft.model}
            onChange={(v) => setD('model', v)}
            options={MODEL_OPTIONS}
            minWidth={360}
            searchPlaceholder="พิมพ์ชื่อรุ่น หรือยี่ห้อ…"
          />
        </div>
      </Field>
      <Field label="ประเภทงาน" lookup={jobTypesLookup}>
        <SearchSelect {...all} value={draft.type} onChange={(v) => setD('type', v)} options={JOB_TYPE_OPTIONS} />
      </Field>
      <Field label="งานย่อย" lookup={typeDetailsLookup}>
        <SearchSelect
          {...all}
          value={draft.typeDetail}
          onChange={(v) => setD('typeDetail', v)}
          options={strOptions(JOB_TYPE_DETAILS)}
        />
      </Field>
      <Field label="เปิดงานโดย" lookup={staffLookup}>
        <SearchSelect
          {...all}
          value={draft.createdBy}
          onChange={(v) => setD('createdBy', v)}
          options={STAFF_OPTIONS}
          searchPlaceholder="พิมพ์ชื่อพนักงาน…"
        />
      </Field>
      <Field label="ผู้รับผิดชอบ" lookup={staffLookup}>
        <SearchSelect
          {...all}
          value={draft.engineer}
          onChange={(v) => setD('engineer', v)}
          options={STAFF_OPTIONS}
          searchPlaceholder="พิมพ์ชื่อช่าง…"
        />
      </Field>
      {/* which date the range applies to — empty dates = all */}
      <Field label="ช่วงวันที่ (ตาม)">
        <Select value={draft.dateBy} onChange={(e) => setD('dateBy', e.target.value as Filters['dateBy'])}>
          <option value="create">วันที่เปิดงาน</option>
          <option value="reception">วันที่รับเครื่องซ่อม</option>
          <option value="closed">วันที่ปิดงาน-ส่งคืน</option>
        </Select>
      </Field>
      <Field label="ตั้งแต่วันที่">
        <Input
          type="date"
          value={draft.from}
          max={draft.to || undefined}
          onChange={(e) => setD('from', e.target.value)}
        />
      </Field>
      <Field label="ถึงวันที่">
        <Input
          type="date"
          value={draft.to}
          min={draft.from || undefined}
          onChange={(e) => setD('to', e.target.value)}
        />
      </Field>
      <Field label="ชื่อ-สกุล / รหัสลูกค้า">
        <Input
          placeholder="ชื่อลูกค้า หรือ C43600"
          value={draft.customer}
          onChange={(e) => setD('customer', e.target.value)}
        />
      </Field>
      <Field label="เบอร์โทร">
        <Input
          placeholder="08xxxxxxxx"
          className="num"
          inputMode="tel"
          value={draft.phone}
          onChange={(e) => setD('phone', e.target.value)}
        />
      </Field>
      <Field label="เลขพัสดุจากลูกค้า">
        <Input className="num" value={draft.tracking} onChange={(e) => setD('tracking', e.target.value)} />
      </Field>
      <Field label="IMEI / Serial No.">
        <Input className="num" value={draft.imei} onChange={(e) => setD('imei', e.target.value)} />
      </Field>
      <Field label="Warranty">
        <Select value={draft.warranty} onChange={(e) => setD('warranty', e.target.value)}>
          <option value="">ทั้งหมด</option>
          {WARRANTY_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w === 'IN' ? 'IN — ในประกัน' : 'OUT — นอกประกัน'}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ค่าใช้จ่าย (เก็บลูกค้า)">
        <Select value={draft.cost} onChange={(e) => setD('cost', e.target.value as Filters['cost'])}>
          <option value="">ทั้งหมด</option>
          <option value="yes">มีค่าใช้จ่าย</option>
          <option value="no">ไม่มีค่าใช้จ่าย</option>
        </Select>
      </Field>
      <Field label="สถานะงาน" lookup={statusesLookup}>
        <SearchSelect
          {...all}
          value={draft.statusId || (STATUS_OPTIONS.find((o) => o.label === draft.status.trim())?.value ?? '')}
          onChange={(v) =>
            setDraft((f) => ({ ...f, statusId: v, status: STATUS_OPTIONS.find((o) => o.value === v)?.label ?? '' }))
          }
          options={STATUS_OPTIONS}
          minWidth={360}
          searchPlaceholder="พิมพ์ชื่อสถานะ…"
        />
      </Field>
      <Field label="เฉพาะงาน" className="sm:col-span-2" group="group">
        <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox checked={draft.bounce} onChange={(e) => setD('bounce', e.target.checked)} />
            งานซ่อมซ้ำ
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox checked={draft.within30} onChange={(e) => setD('within30', e.target.checked)} />
            ซ่อมภายใน 30 วันหลังการขาย
          </label>
        </div>
      </Field>
    </FilterBar>
  );
}
