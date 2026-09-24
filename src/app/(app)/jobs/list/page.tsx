"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Download,
  Printer,
  Layers,
  Sparkles,
  Loader2,
  CheckCircle2,
  Phone,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { SearchSelect, strOptions } from "@/components/shared/search-select";
import { modelNameOptions } from "@/components/shared/model-picker";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select, Checkbox } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import dynamic from "next/dynamic";

// call-log modal — loaded on first open, not with the list page
const CustomerCallModal = dynamic(() => import("@/components/shared/customer-call-modal").then((m) => m.CustomerCallModal), { ssr: false });
import { JOB_STATUS_OPTIONS, WARRANTY_OPTIONS, type Job, type Customer } from "@/data/mock";
import { useJobsPage, useJobTypes, useStaff, useJobStats, useManufacturers, useModels, useJobTypeDetails } from "@/data/db";
import { baht, cn } from "@/lib/utils";
import { api, qs, exportXlsx } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

/** Filter bar — every field is AND-ed on the server (see JobFilters in services/jobs.ts). */
type Filters = {
  no: string; ref: string; brand: string; model: string; type: string; typeDetail: string;
  createdBy: string; engineer: string;
  dateBy: "create" | "reception" | "closed"; from: string; to: string;
  customer: string; phone: string; tracking: string; imei: string; warranty: string;
  bounce: boolean; within30: boolean; cost: "" | "yes" | "no"; status: string;
  /* set only by a dashboard TAT deep link (no field in the bar): exact status id + open jobs only */
  statusId: string; open: boolean;
};
const NO_FILTER: Filters = {
  no: "", ref: "", brand: "", model: "", type: "", typeDetail: "",
  createdBy: "", engineer: "",
  dateBy: "create", from: "", to: "",
  customer: "", phone: "", tracking: "", imei: "", warranty: "",
  bounce: false, within30: false, cost: "", status: "",
  statusId: "", open: false,
};
/** query-string form of the applied filters — shared by the table hook and the Excel export */
const toParams = (f: Filters) => ({
  no: f.no, ref: f.ref, brand: f.brand, model: f.model, type: f.type, typeDetail: f.typeDetail,
  createdBy: f.createdBy, engineer: f.engineer,
  dateBy: f.dateBy === "create" ? "" : f.dateBy, from: f.from, to: f.to,
  customer: f.customer, phone: f.phone, tracking: f.tracking, imei: f.imei, warranty: f.warranty,
  bounce: f.bounce ? 1 : "", within30: f.within30 ? 1 : "", cost: f.cost,
  // statusId wins over the name (TAT trims names; the name filter is an exact match)
  status: f.statusId ? "" : f.status, statusId: f.statusId, open: f.open ? 1 : "",
});

/** dashboard TAT buckets (keys match the dashboard's TatKey) */
const TAT_BUCKET: Record<string, string> = {
  d13: "1–3 วัน", d47: "4–7 วัน", d814: "8–14 วัน", d1530: "15–30 วัน", over30: "เกิน 30 วัน", total: "ทุกช่วงวัน",
};
type TatSource = { bucket: string; status: string; type: string };

function StatChip({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "primary" | "info" | "warning" | "success";
  loading?: boolean;
}) {
  const c = {
    primary: "text-primary bg-primary-soft",
    info: "text-info bg-info-soft",
    warning: "text-warning bg-warning-soft",
    success: "text-success bg-success-soft",
  }[tone];
  return (
    <div className="surface flex items-center gap-3 p-3">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", c)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-5 w-12" />
        ) : (
          <p className="num text-lg font-semibold leading-tight tabular-nums">{value.toLocaleString("en-US")}</p>
        )}
      </div>
    </div>
  );
}

export default function JobListPage() {
  const { push } = useToast();
  const { add: canAdd, edit: canEdit } = useAccess().forPath("/jobs/list");
  const { data: JOB_TYPES } = useJobTypes();
  const { data: JOB_TYPE_DETAILS } = useJobTypeDetails();
  const { data: BRANDS } = useManufacturers();
  const { data: MODELS } = useModels();
  const { data: STAFF } = useStaff();
  const { data: statRows, loading: statsLoading } = useJobStats();

  // FilterBar (applied on ค้นหา) + table state → one server query per change
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  // where a dashboard TAT deep link came from (shown as a clearable chip)
  const [tat, setTat] = React.useState<TatSource | null>(null);
  // deep links:
  //   customer page  /jobs/list?customer=C43600 → prefilled ลูกค้า filter
  //   dashboard TAT  /jobs/list?src=tat&bucket=d814&open=1&statusId=3&status=…&from=…&to=…&type=…
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const g = (k: string) => p.get(k)?.trim() ?? "";
    const next: Partial<Filters> = {};
    if (g("customer")) next.customer = g("customer");
    if (g("src") === "tat") {
      Object.assign(next, {
        open: g("open") === "1", statusId: /^\d+$/.test(g("statusId")) ? g("statusId") : "", status: g("status"),
        dateBy: "create" as const, from: g("from"), to: g("to"), type: g("type"),
      });
      setTat({ bucket: g("bucket"), status: g("status"), type: g("type") });
    }
    if (Object.keys(next).length) {
      setDraft((f) => ({ ...f, ...next }));
      setFilters((f) => ({ ...f, ...next }));
    }
  }, []);
  const clearAll = () => {
    setDraft(NO_FILTER);
    setFilters(NO_FILTER);
    setTat(null);
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  };
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  // models narrow to the chosen brand (1,171 models in total)
  const MODEL_OPTIONS = React.useMemo(() => modelNameOptions(MODELS, draft.brand), [MODELS, draft.brand]);
  const BRAND_OPTIONS = React.useMemo(() => BRANDS.map((b) => ({ value: b.name, label: b.name })), [BRANDS]);
  const JOB_TYPE_OPTIONS = React.useMemo(() => JOB_TYPES.map((j) => ({ value: j.name, label: j.name })), [JOB_TYPES]);
  const STAFF_OPTIONS = React.useMemo(() => STAFF.map((st) => ({ value: String(st.id), label: st.name, sub: st.userType || undefined })), [STAFF]);
  const all = { placeholder: "ทั้งหมด", emptyLabel: "ทั้งหมด" };
  const { rows: JOBS, total, loading } = useJobsPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q, // quick search box in the table (job no / customer / order no / IMEI / serial / model)
    sort: table.sort?.key,
    dir: table.sort?.dir,
    ...toParams(filters),
  });

  const [callFor, setCallFor] = React.useState<{
    customer: Customer | null;
    jobNo: string;
  } | null>(null);
  // mount the (lazy) modal on first open and keep it mounted so the close animation still plays
  const [modalUsed, setModalUsed] = React.useState(false);
  React.useEffect(() => {
    if (callFor) setModalUsed(true);
  }, [callFor]);

  // customer_detail = "C12150 ชื่อ เบอร์" → look the customer up by code
  const openCall = async (job: Job) => {
    const code = job.customer.split(/\s+/)[0] ?? "";
    let customer: Customer | null = null;
    try {
      const d = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: code })}`);
      customer = d.rows[0] ?? null;
    } catch {
      customer = null;
    }
    setCallFor({ customer, jobNo: job.no });
  };

  const stats = statRows[0] ?? { total: 0, fresh: 0, done: 0, progress: 0 };

  const columns: Column<Job>[] = [
    {
      key: "no",
      header: "เลขที่งาน",
      width: "130px",
      cell: (r) => (
        <Link href={`/jobs/repair?job=${encodeURIComponent(r.no)}`} className="num font-medium text-primary hover:underline">
          {r.no}
        </Link>
      ),
    },
    {
      key: "openDate",
      header: "วันที่เปิดงาน",
      width: "140px",
      cell: (r) => <span className="num text-xs">{r.openDate}</span>,
    },
    {
      key: "customer",
      header: "ลูกค้า",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCall(r)}
            title="ดูข้อมูลลูกค้า / Call Log"
            aria-label={`ข้อมูลลูกค้า ${r.customer}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Phone className="h-3 w-3" />
          </button>
          <span className="line-clamp-1 max-w-[220px]">{r.customer}</span>
        </span>
      ),
    },
    {
      key: "so",
      header: "เลขคำสั่งซื้อ",
      width: "120px",
      hideBelow: "lg",
      cell: (r) => <span className="num text-xs">{r.so}</span>,
    },
    { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md" },
    {
      key: "jobType",
      header: "ประเภทงาน",
      hideBelow: "xl",
      cell: (r) => <Badge tone="primary">{r.jobType}</Badge>,
    },
    { key: "owner", header: "ผู้รับผิดชอบ", hideBelow: "lg" },
    {
      key: "amount",
      header: "มูลค่า",
      align: "right",
      width: "100px",
      hideBelow: "xl",
      value: (r) => r.amount,
      cell: (r) => baht(r.amount),
    },
    {
      key: "status",
      header: "สถานะงาน",
      width: "150px",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={r.status} />
          {r.isBounce && (
            <Badge tone="warning" className="px-1.5">
              งานเด้ง
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onView={() => (window.location.href = `/jobs/repair?job=${encodeURIComponent(r.no)}`)}
          onEdit={canEdit ? () => (window.location.href = `/jobs/edit?job=${encodeURIComponent(r.no)}`) : undefined}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รายการงานทั้งหมด"
        description={`ทะเบียนงานบริการทั้งหมด ${stats.total.toLocaleString("en-US")} รายการในระบบ`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("jobs", { q: table.q, ...toParams(filters) })}>
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            {canAdd && (
              <Link href="/jobs/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  เปิดงานใหม่
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatChip icon={Layers} label="งานทั้งหมด" value={stats.total} tone="primary" loading={statsLoading} />
        <StatChip icon={Sparkles} label="งานใหม่" value={stats.fresh} tone="info" loading={statsLoading} />
        <StatChip icon={Loader2} label="กำลังดำเนินการ" value={stats.progress} tone="warning" loading={statsLoading} />
        <StatChip icon={CheckCircle2} label="ซ่อมเสร็จ / ปิดงาน" value={stats.done} tone="success" loading={statsLoading} />
      </div>

      <FilterBar
        onSearch={() => {
          // editing any of the TAT-defining fields leaves the TAT view: drop its hidden "open jobs only" too
          const TAT_KEYS = ["status", "statusId", "dateBy", "from", "to", "type"] as const;
          const next = tat && TAT_KEYS.some((k) => draft[k] !== filters[k]) ? { ...draft, open: false, statusId: "" } : draft;
          if (next !== draft) {
            setTat(null);
            setDraft(next);
            window.history.replaceState(null, "", window.location.pathname);
          }
          setFilters(next);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={clearAll}
      >
        <Field label="เลขที่งาน">
          <Input placeholder="J2612164" className="num" value={draft.no} onChange={(e) => setD("no", e.target.value)} />
        </Field>
        <Field label="เลขคำสั่งซื้อ">
          <Input placeholder="เลขคำสั่งซื้อ Shopee / Lazada …" className="num" value={draft.ref} onChange={(e) => setD("ref", e.target.value)} />
        </Field>
        <Field label="ยี่ห้อ">
          <SearchSelect {...all} value={draft.brand} onChange={(v) => setDraft((f) => ({ ...f, brand: v, model: "" }))} options={BRAND_OPTIONS} searchPlaceholder="พิมพ์ชื่อยี่ห้อ…" />
        </Field>
        <Field label="รุ่น">
          <SearchSelect {...all} value={draft.model} onChange={(v) => setD("model", v)} options={MODEL_OPTIONS} minWidth={360} searchPlaceholder="พิมพ์ชื่อรุ่น หรือยี่ห้อ…" />
        </Field>
        <Field label="ประเภทงาน">
          <SearchSelect {...all} value={draft.type} onChange={(v) => setD("type", v)} options={JOB_TYPE_OPTIONS} />
        </Field>
        <Field label="งานย่อย">
          <SearchSelect {...all} value={draft.typeDetail} onChange={(v) => setD("typeDetail", v)} options={strOptions(JOB_TYPE_DETAILS)} />
        </Field>
        <Field label="เปิดงานโดย">
          <SearchSelect {...all} value={draft.createdBy} onChange={(v) => setD("createdBy", v)} options={STAFF_OPTIONS} searchPlaceholder="พิมพ์ชื่อพนักงาน…" />
        </Field>
        <Field label="ผู้รับผิดชอบ">
          <SearchSelect {...all} value={draft.engineer} onChange={(v) => setD("engineer", v)} options={STAFF_OPTIONS} searchPlaceholder="พิมพ์ชื่อช่าง…" />
        </Field>
        {/* which date the range applies to — empty dates = all */}
        <Field label="ช่วงวันที่ (ตาม)">
          <Select value={draft.dateBy} onChange={(e) => setD("dateBy", e.target.value as Filters["dateBy"])}>
            <option value="create">วันที่เปิดงาน</option>
            <option value="reception">วันที่รับเครื่องซ่อม</option>
            <option value="closed">วันที่ปิดงาน-ส่งคืน</option>
          </Select>
        </Field>
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="ถึงวันที่">
          <Input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="ชื่อ-สกุล / รหัสลูกค้า">
          <Input placeholder="ชื่อลูกค้า หรือ C43600" value={draft.customer} onChange={(e) => setD("customer", e.target.value)} />
        </Field>
        <Field label="เบอร์โทร">
          <Input placeholder="08xxxxxxxx" className="num" inputMode="tel" value={draft.phone} onChange={(e) => setD("phone", e.target.value)} />
        </Field>
        <Field label="เลขพัสดุจากลูกค้า">
          <Input className="num" value={draft.tracking} onChange={(e) => setD("tracking", e.target.value)} />
        </Field>
        <Field label="IMEI / Serial No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD("imei", e.target.value)} />
        </Field>
        <Field label="Warranty">
          <Select value={draft.warranty} onChange={(e) => setD("warranty", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {WARRANTY_OPTIONS.map((w) => (
              <option key={w} value={w}>{w === "IN" ? "IN — ในประกัน" : "OUT — นอกประกัน"}</option>
            ))}
          </Select>
        </Field>
        <Field label="ค่าใช้จ่าย (เก็บลูกค้า)">
          <Select value={draft.cost} onChange={(e) => setD("cost", e.target.value as Filters["cost"])}>
            <option value="">ทั้งหมด</option>
            <option value="yes">มีค่าใช้จ่าย</option>
            <option value="no">ไม่มีค่าใช้จ่าย</option>
          </Select>
        </Field>
        <Field label="สถานะงาน">
          <SearchSelect {...all} value={draft.status} onChange={(v) => setDraft((f) => ({ ...f, status: v, statusId: "" }))} options={strOptions(JOB_STATUS_OPTIONS)} minWidth={360} />
        </Field>
        <Field label="เฉพาะงาน" className="sm:col-span-2">
          <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <Checkbox checked={draft.bounce} onChange={(e) => setD("bounce", e.target.checked)} />
              งานซ่อมซ้ำ
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <Checkbox checked={draft.within30} onChange={(e) => setD("within30", e.target.checked)} />
              ซ่อมภายใน 30 วันหลังการขาย
            </label>
          </div>
        </Field>
      </FilterBar>

      {tat && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft py-1 pl-3 pr-1 text-primary">
            <span>
              จาก Dashboard TAT: <span className="font-medium">{tat.status || "ทุกสถานะ"}</span>
              {" · "}{TAT_BUCKET[tat.bucket] ?? tat.bucket}
              {tat.type && ` · ${tat.type}`}
              {" · "}งานที่ยังไม่ปิด
              <span className="num tabular-nums"> ({loading ? "…" : total.toLocaleString("en-US")} งาน)</span>
            </span>
            <button
              type="button"
              onClick={clearAll}
              title="ล้างตัวกรองจาก Dashboard"
              aria-label="ล้างตัวกรองจาก Dashboard"
              className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}

      <DataTable searchable={false}
        columns={columns}
        rows={JOBS}
        loading={loading}
        rowKey={(r) => r.no}
        server={{ total, onChange: setTable }}
      />

      {modalUsed && (
        <CustomerCallModal
          open={!!callFor}
          onClose={() => setCallFor(null)}
          customer={callFor?.customer ?? null}
          jobNo={callFor?.jobNo}
        />
      )}
    </>
  );
}
