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
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CustomerCallModal } from "@/components/shared/customer-call-modal";
import { JOB_STATUS_OPTIONS, TECHNICIANS, type Job, type Customer } from "@/data/mock";
import { useJobs, useJobTypes, useCustomers } from "@/data/db";
import { baht, cn } from "@/lib/utils";

const DONE = new Set(["ปิดงาน", "ซ่อมเสร็จ"]);

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
        <p className="num text-lg font-semibold leading-tight tabular-nums">
          {loading ? "—" : value.toLocaleString("en-US")}
        </p>
      </div>
    </div>
  );
}

export default function JobListPage() {
  const { push } = useToast();
  const { data: JOBS, loading } = useJobs();
  const { data: JOB_TYPES } = useJobTypes();
  const { data: CUSTOMERS } = useCustomers();

  const [callFor, setCallFor] = React.useState<{
    customer: Customer | null;
    jobNo: string;
  } | null>(null);

  const openCall = (job: Job) =>
    setCallFor({
      customer: CUSTOMERS.find((c) => c.name === job.customer) ?? null,
      jobNo: job.no,
    });

  const stats = React.useMemo(() => {
    const total = JOBS.length;
    const fresh = JOBS.filter((j) => j.status === "งานใหม่").length;
    const done = JOBS.filter((j) => DONE.has(j.status)).length;
    return { total, fresh, done, progress: total - fresh - done };
  }, [JOBS]);

  const columns: Column<Job>[] = [
    {
      key: "no",
      header: "เลขที่งาน",
      width: "130px",
      cell: (r) => (
        <Link href="/jobs/repair" className="num font-medium text-primary hover:underline">
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
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onView={() => push({ kind: "info", title: r.no, desc: r.brandModel })}
          onEdit={() => push({ kind: "info", title: "แก้ไขงาน", desc: r.no })}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="รายการงานทั้งหมด"
        description={`ทะเบียนงานบริการทั้งหมด ${JOBS.length} รายการในระบบ`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Link href="/jobs/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                เปิดงานใหม่
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatChip icon={Layers} label="งานทั้งหมด" value={stats.total} tone="primary" loading={loading} />
        <StatChip icon={Sparkles} label="งานใหม่" value={stats.fresh} tone="info" loading={loading} />
        <StatChip icon={Loader2} label="กำลังดำเนินการ" value={stats.progress} tone="warning" loading={loading} />
        <StatChip icon={CheckCircle2} label="ซ่อมเสร็จ / ปิดงาน" value={stats.done} tone="success" loading={loading} />
      </div>

      <FilterBar
        onSearch={() => push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" })}
        defaultOpen={false}
      >
        <Field label="เลขที่งาน">
          <Input placeholder="JOB2604460" className="num" />
        </Field>
        <Field label="ชื่อ / รหัสลูกค้า">
          <Input placeholder="ชื่อลูกค้า หรือ C00xxxxx" />
        </Field>
        <Field label="วันที่เปิดงาน (ตั้งแต่)">
          <Input type="date" defaultValue="2026-08-05" />
        </Field>
        <Field label="วันที่เปิดงาน (ถึง)">
          <Input type="date" defaultValue="2026-09-04" />
        </Field>
        <Field label="ประเภทงาน">
          <Select>
            <option>- - Select All - -</option>
            {JOB_TYPES.map((j) => (
              <option key={j.id}>{j.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะงาน">
          <Select>
            <option>- - Select All - -</option>
            {JOB_STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="ผู้รับผิดชอบ">
          <Select>
            <option>- - Select All - -</option>
            {TECHNICIANS.slice(1).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="IMEI / Serial No.">
          <Input className="num" />
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={JOBS}
        loading={loading}
        rowKey={(r) => r.no}
        searchPlaceholder="ค้นหาเลขที่งาน / ลูกค้า / รุ่น…"
      />

      <CustomerCallModal
        open={!!callFor}
        onClose={() => setCallFor(null)}
        customer={callFor?.customer ?? null}
        jobNo={callFor?.jobNo}
      />
    </>
  );
}
