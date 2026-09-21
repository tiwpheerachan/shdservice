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
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import dynamic from "next/dynamic";

// call-log modal — loaded on first open, not with the list page
const CustomerCallModal = dynamic(() => import("@/components/shared/customer-call-modal").then((m) => m.CustomerCallModal), { ssr: false });
import { JOB_STATUS_OPTIONS, type Job, type Customer } from "@/data/mock";
import { useJobsPage, useJobTypes, useStaff, useJobStats } from "@/data/db";
import { baht, cn } from "@/lib/utils";
import { api, qs, exportXlsx } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

type Filters = { no: string; customer: string; from: string; to: string; type: string; status: string; engineer: string; imei: string };
const NO_FILTER: Filters = { no: "", customer: "", from: "", to: "", type: "", status: "", engineer: "", imei: "" };

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
  const { data: STAFF } = useStaff();
  const { data: statRows, loading: statsLoading } = useJobStats();

  // FilterBar (applied on ค้นหา) + table state → one server query per change
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  // deep link from the customer page: /jobs/list?customer=C43600 → prefilled ลูกค้า filter
  React.useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("customer")?.trim();
    if (c) {
      setDraft((f) => ({ ...f, customer: c }));
      setFilters((f) => ({ ...f, customer: c }));
    }
  }, []);
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const { rows: JOBS, total, loading } = useJobsPage({
    page: table.page,
    pageSize: table.pageSize,
    // table search box wins; otherwise the first filled text filter (all search the same columns)
    q: table.q || filters.no || filters.customer || filters.imei,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    from: filters.from,
    to: filters.to,
    type: filters.type,
    status: filters.status,
    engineer: filters.engineer,
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
            <Button variant="outline" size="sm" onClick={() => exportXlsx("jobs", { q: table.q || filters.no || filters.customer || filters.imei, from: filters.from, to: filters.to, type: filters.type, status: filters.status, engineer: filters.engineer })}>
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
          setFilters(draft);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilters(NO_FILTER);
        }}
        defaultOpen={false}
      >
        <Field label="เลขที่งาน">
          <Input placeholder="J2612164" className="num" value={draft.no} onChange={(e) => setD("no", e.target.value)} />
        </Field>
        <Field label="ชื่อ / รหัสลูกค้า">
          <Input placeholder="ชื่อลูกค้า หรือ C00xxxxx" value={draft.customer} onChange={(e) => setD("customer", e.target.value)} />
        </Field>
        <Field label="วันที่เปิดงาน (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="วันที่เปิดงาน (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="ประเภทงาน">
          <Select value={draft.type} onChange={(e) => setD("type", e.target.value)}>
            <option value="">- - Select All - -</option>
            {JOB_TYPES.map((j) => (
              <option key={j.id}>{j.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะงาน">
          <Select value={draft.status} onChange={(e) => setD("status", e.target.value)}>
            <option value="">- - Select All - -</option>
            {JOB_STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="ผู้รับผิดชอบ">
          <Select value={draft.engineer} onChange={(e) => setD("engineer", e.target.value)}>
            <option value="">- - Select All - -</option>
            {STAFF.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IMEI / Serial No.">
          <Input className="num" value={draft.imei} onChange={(e) => setD("imei", e.target.value)} />
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={JOBS}
        loading={loading}
        rowKey={(r) => r.no}
        searchPlaceholder="ค้นหาเลขที่งาน / ลูกค้า / รุ่น…"
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
