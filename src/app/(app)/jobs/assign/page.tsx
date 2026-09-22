"use client";

import * as React from "react";
import { UserCheck, ListChecks, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { JobSearch } from "@/components/shared/job-search";
import { FilterBar } from "@/components/shared/filter-bar";
import { Field } from "@/components/ui/field";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { type Job } from "@/data/mock";
import { useJobsPage, useJobTypes, useManufacturers, useModels } from "@/data/db";
import { cn } from "@/lib/utils";
import { api, postJson, errMsg, qs } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

export default function AssignPage() {
  const { push } = useToast();
  // the signed-in technician receives the jobs (job.engineer_id = app_user.user_id)
  const { name: CURRENT_TECH, userId } = useAccess();
  // open jobs without an engineer / still "งานใหม่" — server-side paging
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  // filter bar — subset of the job-list filters (no status/engineer: everything here is new & unassigned)
  type AssignFilter = { no: string; ref: string; brand: string; model: string; type: string; customer: string; phone: string; imei: string; dateBy: "create" | "reception"; from: string; to: string };
  const NO_FILTER: AssignFilter = { no: "", ref: "", brand: "", model: "", type: "", customer: "", phone: "", imei: "", dateBy: "create", from: "", to: "" };
  const [draft, setDraft] = React.useState<AssignFilter>(NO_FILTER);
  const [filter, setFilter] = React.useState<AssignFilter>(NO_FILTER);
  const setD = <K extends keyof AssignFilter>(k: K, v: AssignFilter[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const { data: JOB_TYPES } = useJobTypes();
  const { data: BRANDS } = useManufacturers();
  const { data: MODELS } = useModels();
  const MODEL_OPTIONS = React.useMemo(() => (draft.brand ? MODELS.filter((m) => m.brand === draft.brand) : MODELS), [MODELS, draft.brand]);
  const { rows: JOBS, total, loading, refetch } = useJobsPage({
    page: table.page,
    pageSize: table.pageSize,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    unassigned: 1,
    ...filter,
    dateBy: filter.dateBy === "create" ? "" : filter.dateBy,
  });
  const [saving, setSaving] = React.useState(false);

  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());

  const pool = React.useMemo(() => JOBS.filter((j) => !removed.has(j.no)), [JOBS, removed]);

  const allSelected = pool.length > 0 && pool.every((j) => picked.has(j.no));

  const toggle = (no: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(no)) n.delete(no);
      else n.add(no);
      return n;
    });

  const toggleAll = () =>
    setPicked(allSelected ? new Set() : new Set(pool.map((j) => j.no)));

  // type a job no → verify on the server that it is still waiting, then tick it
  const go = async (v: string) => {
    if (!v) return;
    const local = pool.find((j) => j.no === v);
    if (local) {
      setPicked((s) => new Set(s).add(local.no));
      push({ kind: "success", title: "เลือกงานแล้ว", desc: local.no });
      return;
    }
    try {
      const d = await api<{ rows: Job[] }>(`/api/data/jobs${qs({ paged: 1, pageSize: 1, q: v, unassigned: 1 })}`);
      const hit = d.rows.find((j) => j.no === v);
      if (hit) {
        setPicked((s) => new Set(s).add(hit.no));
        push({ kind: "success", title: "เลือกงานแล้ว", desc: hit.no });
      } else {
        push({ kind: "warning", title: "ไม่พบงานนี้ในรายการรอรับมอบหมาย", desc: v });
      }
    } catch (e) {
      push({ kind: "error", title: "ค้นหาไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  // POST /api/jobs/assign → engineer_id + status 2 "อยู่ระหว่างดำเนินการ" (+ job_log)
  const confirm = async () => {
    const list = [...picked];
    if (!list.length) return;
    setSaving(true);
    try {
      const d = await postJson<{ assigned: number }>("/api/jobs/assign", { jobNos: list, engineerId: userId });
      setRemoved((r) => new Set([...r, ...list]));
      setPicked(new Set());
      push({
        kind: "success",
        title: `ยืนยันรับงานแล้ว ${d.assigned} รายการ`,
        desc: "เปลี่ยนสถานะเป็น 'อยู่ระหว่างดำเนินการ'",
      });
      refetch();
    } catch (e) {
      push({ kind: "error", title: "รับงานไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Job>[] = [
    {
      key: "pick",
      header: (
        <label className="flex cursor-pointer items-center justify-center" title="เลือกทั้งหมด">
          <Checkbox
            checked={allSelected}
            onChange={toggleAll}
            aria-label="เลือกทั้งหมด"
          />
        </label>
      ),
      width: "84px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <Checkbox
          checked={picked.has(r.no)}
          onChange={() => toggle(r.no)}
          aria-label={`รับงาน ${r.no}`}
        />
      ),
    },
    {
      key: "no",
      header: "หมายเลขงาน",
      width: "130px",
      cell: (r) => <span className="num font-medium text-primary">{r.no}</span>,
    },
    {
      key: "openDate",
      header: "วันที่เปิดงาน",
      width: "140px",
      cell: (r) => <span className="num text-xs">{r.openDate}</span>,
    },
    {
      key: "receiveDate",
      header: "วันที่รับเครื่อง",
      width: "130px",
      hideBelow: "lg",
      sortable: false,
      cell: (r) => <span className="num text-xs">{r.receptionDate || r.openDate.slice(0, 10)}</span>,
    },
    {
      key: "customer",
      header: "ลูกค้า",
      cell: (r) => <span className="line-clamp-1 max-w-[220px]">{r.customer}</span>,
    },
    {
      key: "so",
      header: "เลขคำสั่งซื้อ",
      width: "120px",
      hideBelow: "xl",
      cell: (r) => <span className="num text-xs">{r.so}</span>,
    },
    { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
    { key: "jobType", header: "ประเภทงาน", hideBelow: "xl" },
    {
      key: "status",
      header: "สถานะงาน",
      width: "150px",
      cell: (r) => <StatusBadge status={r.status} />,
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

      <FilterBar
        onSearch={() => {
          setFilter(draft);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilter(NO_FILTER);
        }}
      >
        <Field label="เลขที่งาน">
          <Input placeholder="J2612164" className="num" value={draft.no} onChange={(e) => setD("no", e.target.value)} />
        </Field>
        <Field label="เลขคำสั่งซื้อ">
          <Input className="num" value={draft.ref} onChange={(e) => setD("ref", e.target.value)} />
        </Field>
        <Field label="ยี่ห้อ">
          <Select value={draft.brand} onChange={(e) => setDraft((f) => ({ ...f, brand: e.target.value, model: "" }))}>
            <option value="">ทั้งหมด</option>
            {BRANDS.map((b) => (
              <option key={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="รุ่น">
          <Select value={draft.model} onChange={(e) => setD("model", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.code} value={m.name}>{draft.brand ? m.name : `${m.brand} ${m.name}`}</option>
            ))}
          </Select>
        </Field>
        <Field label="ประเภทงาน">
          <Select value={draft.type} onChange={(e) => setD("type", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {JOB_TYPES.map((j) => (
              <option key={j.id}>{j.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="ชื่อ-สกุล / รหัสลูกค้า">
          <Input placeholder="ชื่อลูกค้า หรือ C43600" value={draft.customer} onChange={(e) => setD("customer", e.target.value)} />
        </Field>
        <Field label="เบอร์โทร">
          <Input placeholder="08xxxxxxxx" className="num" inputMode="tel" value={draft.phone} onChange={(e) => setD("phone", e.target.value)} />
        </Field>
        <Field label="IMEI / Serial No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD("imei", e.target.value)} />
        </Field>
        <Field label="ช่วงวันที่ (ตาม)">
          <Select value={draft.dateBy} onChange={(e) => setD("dateBy", e.target.value as AssignFilter["dateBy"])}>
            <option value="create">วันที่เปิดงาน</option>
            <option value="reception">วันที่รับเครื่องซ่อม</option>
          </Select>
        </Field>
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <Input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setD("to", e.target.value)} />
        </Field>
      </FilterBar>

      {/* smart selection toolbar — sticks under the topbar like a navbar */}
      <div className="surface sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            เลือกแล้ว
            <span className="num rounded-md bg-primary/10 px-2 py-0.5 text-primary">
              {picked.size}
            </span>
            / {total.toLocaleString("en-US")} งาน
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wrench className="h-3.5 w-3.5" />
            เจ้าหน้าที่ช่าง: <span className="font-medium text-foreground">{CURRENT_TECH}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={toggleAll}
            disabled={pool.length === 0}
          >
            {allSelected ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPicked(new Set())}
            disabled={picked.size === 0}
          >
            ล้างการเลือก
          </Button>
          <Button size="sm" disabled={picked.size === 0 || saving} onClick={confirm}>
            <UserCheck className="h-3.5 w-3.5" />
            ยืนยันรับงานนี้ และเปลี่ยนสถานะงานเป็น &lsquo;อยู่ระหว่างดำเนินการ&rsquo;
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={pool}
        loading={loading}
        rowKey={(r) => r.no}
        rowClassName={(r) => (picked.has(r.no) ? "bg-primary/5" : "")}
        searchable={false}
        emptyText="ไม่มีงานรอรับมอบหมาย"
        emptyHint="งานทั้งหมดมีผู้รับผิดชอบแล้ว"
        footerNote={
          picked.size > 0 ? (
            <span className="font-medium text-primary">
              · เลือกไว้ {picked.size} งาน
            </span>
          ) : undefined
        }
        server={{ total, onChange: setTable }}
      />
    </>
  );
}
