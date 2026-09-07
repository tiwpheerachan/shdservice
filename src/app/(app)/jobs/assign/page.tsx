"use client";

import * as React from "react";
import { Search, UserCheck, ListChecks, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Checkbox } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { type Job } from "@/data/mock";
import { useJobs } from "@/data/db";
import { cn } from "@/lib/utils";

const CURRENT_TECH = "May - Pradit";

export default function AssignPage() {
  const { push } = useToast();
  const { data: JOBS, loading } = useJobs();

  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());

  const pool = React.useMemo(
    () =>
      JOBS.filter(
        (j) =>
          (j.owner === "- ยังไม่ระบุ -" || j.status === "งานใหม่") &&
          !removed.has(j.no)
      ),
    [JOBS, removed]
  );

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

  const go = () => {
    const v = q.trim();
    if (!v) return;
    const hit = pool.find((j) => j.no.toLowerCase() === v.toLowerCase());
    if (hit) {
      setPicked((s) => new Set(s).add(hit.no));
      push({ kind: "success", title: "เลือกงานแล้ว", desc: hit.no });
    } else {
      push({ kind: "warning", title: "ไม่พบงานนี้ในรายการรอรับมอบหมาย", desc: v });
    }
    setQ("");
  };

  const confirm = () => {
    const list = [...picked];
    setRemoved((r) => new Set([...r, ...list]));
    setPicked(new Set());
    push({
      kind: "success",
      title: `ยืนยันรับงานแล้ว ${list.length} รายการ`,
      desc: "เปลี่ยนสถานะเป็น 'อยู่ระหว่างดำเนินการ' (ระบบสาธิต)",
    });
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
      cell: (r) => <span className="num text-xs">{r.openDate.slice(0, 10)}</span>,
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
            <label
              htmlFor="assign-job-no"
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
            >
              ระบุ หมายเลขงานซ่อม
            </label>
            <div className="relative">
              <Input
                id="assign-job-no"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()}
                placeholder="JOB2604460"
                className="num h-9 w-44 pr-8"
              />
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
            <Button size="md" variant="outline" onClick={go}>
              GO
            </Button>
          </div>
        }
      />

      {/* smart selection toolbar — sticks under the topbar like a navbar */}
      <div className="surface sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            เลือกแล้ว
            <span className="num rounded-md bg-primary/10 px-2 py-0.5 text-primary">
              {picked.size}
            </span>
            / {pool.length} งาน
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
          <Button size="sm" disabled={picked.size === 0} onClick={confirm}>
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
        searchPlaceholder="ค้นหางานที่รอรับมอบหมาย…"
        emptyText="ไม่มีงานรอรับมอบหมาย"
        emptyHint="งานทั้งหมดมีผู้รับผิดชอบแล้ว"
        footerNote={
          picked.size > 0 ? (
            <span className="font-medium text-primary">
              · เลือกไว้ {picked.size} งาน
            </span>
          ) : undefined
        }
      />
    </>
  );
}
