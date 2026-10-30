'use client';

import * as React from 'react';
import { UserCheck, ListChecks, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect } from '@/components/shared/search-select';
import { modelNameOptions } from '@/components/shared/model-picker';
import { Field } from '@/components/ui/field';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import type { Job } from '@/data/types';
import { useJobsPage, useJobTypes, useManufacturers, useModels } from '@/data/db';
import { api, postJson, errMsg, qs, ApiError } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { useTourRestore } from '@/components/tour/tour';
import { apiFieldErrors } from '@/lib/use-form-errors';
import { useServerTable } from '@/lib/use-server-table';
import { NOT_ENGINEER } from '@/lib/validation/job';
import { brandModelColumn, COL_MIN_WIDTH } from '@/components/shared/table-columns';

// filter bar — subset of the job-list filters (no status/engineer: everything here is new & unassigned)
type AssignFilter = {
  no: string;
  ref: string;
  brand: string;
  model: string;
  type: string;
  customer: string;
  phone: string;
  imei: string;
  dateBy: 'create' | 'reception';
  from: string;
  to: string;
};
const NO_FILTER: AssignFilter = {
  no: '',
  ref: '',
  brand: '',
  model: '',
  type: '',
  customer: '',
  phone: '',
  imei: '',
  dateBy: 'create',
  from: '',
  to: '',
};

export default function AssignPage() {
  const { push } = useToast();
  const ask = useConfirm();
  // the signed-in technician receives the jobs (job.engineer_app_user_pk = app_user.pk)
  const { name: CURRENT_TECH, userId, has, can } = useAccess();
  // open jobs without an engineer / still "งานใหม่" — server-side paging
  const {
    draft,
    setDraft,
    setD,
    filters: filter,
    apply,
    reset,
    narrowed,
    pageArgs,
    server,
  } = useServerTable(NO_FILTER);
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const { data: BRANDS, ...brandsLookup } = useManufacturers();
  // a chosen brand loads only its models; without one the whole list waits until the รุ่น field is first used
  const [modelsWanted, setModelsWanted] = React.useState(false);
  const wantModels = () => setModelsWanted(true);
  const { data: MODELS, ...modelsLookup } = useModels('active', {
    brand: draft.brand,
    enabled: !!draft.brand || !!draft.model || modelsWanted,
  });
  const MODEL_OPTIONS = React.useMemo(() => modelNameOptions(MODELS, draft.brand), [MODELS, draft.brand]);
  const BRAND_OPTIONS = React.useMemo(() => BRANDS.map((b) => ({ value: b.name, label: b.name })), [BRANDS]);
  const JOB_TYPE_OPTIONS = React.useMemo(() => JOB_TYPES.map((j) => ({ value: j.name, label: j.name })), [JOB_TYPES]);
  const all = { placeholder: 'ทั้งหมด', emptyLabel: 'ทั้งหมด' };
  const {
    rows: JOBS,
    total,
    loading,
    refetch,
    error: loadError,
  } = useJobsPage({
    ...pageArgs,
    unassigned: 1,
    ...filter,
    dateBy: filter.dateBy === 'create' ? '' : filter.dateBy,
  });
  const [saving, setSaving] = React.useState(false);

  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());
  // a บทสอน leaves the filter bar and the ticks as it found them
  useTourRestore(
    () => ({ draft, picked: [...picked] }),
    (v) => {
      setDraft(v.draft);
      setPicked(new Set(v.picked));
    },
  );

  const pool = React.useMemo(() => JOBS.filter((j) => !removed.has(j.no)), [JOBS, removed]);

  const allSelected = pool.length > 0 && pool.every((j) => picked.has(j.no));

  const toggle = (no: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(no)) n.delete(no);
      else n.add(no);
      return n;
    });

  const toggleAll = () => setPicked(allSelected ? new Set() : new Set(pool.map((j) => j.no)));

  // type a job no (or pick it: `no` = its number) → verify on the server that it is still waiting, then tick it
  const go = async (picked: string, no?: string) => {
    const v = (no ?? picked).trim().toUpperCase();
    if (!v) return;
    const local = pool.find((j) => j.no === v);
    if (local) {
      setPicked((s) => new Set(s).add(local.no));
      push({ kind: 'success', title: 'เลือกงานแล้ว', desc: local.no });
      return;
    }
    try {
      const d = await api<{ rows: Job[] }>(`/api/data/jobs${qs({ paged: 1, pageSize: 1, q: v, unassigned: 1 })}`);
      const hit = d.rows.find((j) => j.no === v);
      if (hit) {
        setPicked((s) => new Set(s).add(hit.no));
        push({ kind: 'success', title: 'เลือกงานแล้ว', desc: hit.no });
      } else {
        push({ kind: 'warning', title: 'ไม่พบงานนี้ในรายการรอรับมอบหมาย', desc: v });
      }
    } catch (e) {
      push({ kind: 'error', title: 'ค้นหาไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  // POST /api/jobs/assign → engineer_app_user_pk; a "งานใหม่" job also → status 2 "อยู่ระหว่างดำเนินการ" (+ job_log)
  const confirm = async () => {
    const list = [...picked];
    if (!list.length) return;
    setSaving(true);
    try {
      const send = (takeOver?: boolean) =>
        postJson<{ assigned: number }>('/api/jobs/assign', { jobNos: list, engineerId: userId, takeOver });
      // a job someone else already has: the API asks first (409 takeOver) — taken only when the user says so
      const d = await send().catch(async (e) => {
        const takeOver = e instanceof ApiError && (e.details as { takeOver?: boolean } | undefined)?.takeOver;
        if (!takeOver) throw e;
        return (await ask({ title: e.message, confirmLabel: 'มอบให้คนใหม่' })) ? send(true) : null;
      });
      if (!d) return;
      setRemoved((r) => new Set([...r, ...list]));
      setPicked(new Set());
      push({
        kind: 'success',
        title: `ยืนยันรับงานแล้ว ${d.assigned} งาน`,
        desc: "งานที่เป็น 'งานใหม่' เปลี่ยนสถานะเป็น 'อยู่ระหว่างดำเนินการ' · งานอื่นคงสถานะเดิม",
      });
      refetch();
    } catch (e) {
      // no engineer field here (always the signed-in user) — the API's reason goes in the toast
      push({ kind: 'error', title: 'รับงานไม่สำเร็จ', desc: apiFieldErrors(e)?.engineerId ?? errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Job>[] = [
    {
      key: 'pick',
      header: (
        <label className="flex cursor-pointer items-center justify-center" title="เลือกทั้งหมด">
          <Checkbox checked={allSelected} onChange={toggleAll} aria-label="เลือกทั้งหมด" />
        </label>
      ),
      width: '84px',
      align: 'center',
      sortable: false,
      cell: (r) => <Checkbox checked={picked.has(r.no)} onChange={() => toggle(r.no)} aria-label={`รับงาน ${r.no}`} />,
    },
    {
      key: 'no',
      header: 'หมายเลขงาน',
      width: '130px',
      cell: (r) => <span className="num font-medium text-primary">{r.no}</span>,
    },
    {
      key: 'openDate',
      header: 'วันที่เปิดงาน',
      width: '140px',
      cell: (r) => <span className="num text-xs">{r.openDate}</span>,
    },
    {
      key: 'receiveDate',
      header: 'วันที่รับเครื่อง',
      width: '130px',
      hideBelow: 'lg',
      sortable: false,
      cell: (r) => <span className="num text-xs">{r.receptionDate || r.openDate.slice(0, 10)}</span>,
    },
    {
      key: 'customer',
      header: 'ลูกค้า',
      minWidth: COL_MIN_WIDTH.customer,
      cell: (r) => (
        <span className="line-clamp-1 max-w-[220px]" title={r.customer}>
          {r.customer}
        </span>
      ),
    },
    {
      key: 'so',
      header: 'เลขคำสั่งซื้อ',
      width: '120px',
      hideBelow: 'xl',
      cell: (r) => <span className="num text-xs">{r.so}</span>,
    },
    brandModelColumn(),
    { key: 'jobType', header: 'ประเภทงาน', hideBelow: 'xl' },
    {
      key: 'status',
      header: 'สถานะงาน',
      minWidth: COL_MIN_WIDTH.status,
      cell: (r) => <StatusBadge status={r.status} group={r.statusGroup} wrap />,
    },
  ];

  return (
    <>
      <PageHeader
        title="จนท.รับมอบหมายงาน"
        description="เลือกงานที่ต้องการรับผิดชอบ (เลือกทีละงาน หรือทั้งหมด) แล้วกดยืนยันรับงาน"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="assign-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงานซ่อม
            </label>
            <JobSearch id="assign-job-no" scope="unassigned" onPick={go} />
          </div>
        }
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="เลขที่งาน">
          <Input placeholder="J2612164" className="num" value={draft.no} onChange={(e) => setD('no', e.target.value)} />
        </Field>
        <Field label="เลขคำสั่งซื้อ">
          <Input className="num" value={draft.ref} onChange={(e) => setD('ref', e.target.value)} />
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
        <Field label="IMEI / Serial No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD('imei', e.target.value)} />
        </Field>
        <Field label="ช่วงวันที่ (ตาม)">
          <Select value={draft.dateBy} onChange={(e) => setD('dateBy', e.target.value as AssignFilter['dateBy'])}>
            <option value="create">วันที่เปิดงาน</option>
            <option value="reception">วันที่รับเครื่องซ่อม</option>
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
      </FilterBar>

      {/* smart selection toolbar — sticks under the topbar like a navbar */}
      <div className="surface sticky top-(--topbar-h) z-20 flex flex-wrap items-center justify-between gap-3 p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            เลือกแล้ว
            <span className="num rounded-md bg-primary/10 px-2 py-0.5 text-primary">{picked.size}</span>/{' '}
            {total.toLocaleString('en-US')} งาน
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wrench className="h-3.5 w-3.5" />
            เจ้าหน้าที่ช่าง: <span className="font-medium text-foreground">{CURRENT_TECH}</span>
          </span>
        </div>
        {/* wraps on phones: three buttons are wider than 390px */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggleAll} disabled={pool.length === 0}>
            {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
            ล้างการเลือก
          </Button>
          {!has('Job Take') ? (
            // only a role with Job Take takes jobs (the API refuses anyone else)
            <span role="note" className="text-xs font-medium text-warning">
              {NOT_ENGINEER} — ดูรายการได้อย่างเดียว
            </span>
          ) : can('Job Assign', 'edit') ? (
            // data-tour-block: a บทสอน lets the user tick jobs, never take them
            <Button size="sm" disabled={picked.size === 0 || saving} onClick={confirm} data-tour-block>
              <UserCheck className="h-3.5 w-3.5" />
              ยืนยันรับงาน ({picked.size} งาน)
            </Button>
          ) : (
            <span role="note" className="text-xs font-medium text-warning">
              ไม่มีสิทธิ์รับงาน — ดูรายการได้อย่างเดียว
            </span>
          )}
        </div>
      </div>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        columns={columns}
        rows={pool}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        rowKey={(r) => r.no}
        rowClassName={(r) => (picked.has(r.no) ? 'bg-primary/5' : '')}
        searchable={false}
        emptyText="ไม่มีงานรอรับมอบหมาย"
        emptyHint="งานทั้งหมดมีผู้รับผิดชอบแล้ว"
        footerNote={
          picked.size > 0 ? <span className="font-medium text-primary">· เลือกไว้ {picked.size} งาน</span> : undefined
        }
        server={{ ...server, total }}
      />
    </>
  );
}
