"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuditPage, useAuditModules, type AuditRow } from "@/data/db";
import { exportXlsx } from "@/lib/api";

// action → badge tone / Thai label
const ACTION: Record<string, { label: string; tone: Tone }> = {
  CREATE: { label: "เพิ่ม", tone: "success" },
  UPDATE: { label: "แก้ไข", tone: "info" },
  DELETE: { label: "ลบ", tone: "danger" },
  STATUS: { label: "เปลี่ยนสถานะ", tone: "warning" },
  APPROVE: { label: "อนุมัติ", tone: "primary" },
  ASSIGN: { label: "มอบหมาย", tone: "info" },
  ISSUE: { label: "จ่ายสต๊อก", tone: "warning" },
  RECEIVE: { label: "รับเข้า", tone: "success" },
  RETURN: { label: "รับคืน", tone: "success" },
  UPLOAD: { label: "แนบไฟล์", tone: "neutral" },
  LOGIN: { label: "เข้าสู่ระบบ", tone: "neutral" },
};

type Filters = { from: string; to: string; user: string; module: string; action: string; key: string };
const NO_FILTER: Filters = { from: "", to: "", user: "", module: "", action: "", key: "" };

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function AuditPage() {
  const { push } = useToast();
  const { data: MODULES } = useAuditModules();
  const [draft, setDraft] = React.useState<Filters>(NO_FILTER);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  const setD = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 50, q: "", sort: null });
  const { rows, total, loading } = useAuditPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    ...filters,
  });
  const [detail, setDetail] = React.useState<AuditRow | null>(null);

  const columns: Column<AuditRow>[] = [
    { key: "at", header: "เวลา", width: "150px", cell: (r) => <span className="num text-xs">{r.at}</span> },
    { key: "user", header: "ผู้ใช้", width: "180px", cell: (r) => <span className="line-clamp-1">{r.user || "—"}</span> },
    {
      key: "action",
      header: "การกระทำ",
      width: "120px",
      cell: (r) => (
        <Badge tone={ACTION[r.action]?.tone ?? "neutral"} dot>
          {ACTION[r.action]?.label ?? r.action}
        </Badge>
      ),
    },
    { key: "module", header: "โมดูล", hideBelow: "lg", width: "160px" },
    { key: "key", header: "เลขที่ / รหัส", width: "130px", cell: (r) => <span className="num font-medium">{r.key}</span> },
    { key: "summary", header: "รายละเอียด", sortable: false, cell: (r) => <span className="line-clamp-2">{r.summary}</span> },
    {
      key: "changes",
      header: "ค่าที่เปลี่ยน",
      sortable: false,
      width: "110px",
      align: "center",
      cell: (r) =>
        r.changes ? (
          <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
            {Object.keys(r.changes).length} ฟิลด์
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ประวัติการใช้งาน (Audit Log)"
        description="ข้อมูลระบบ » ใครทำอะไร กับรายการไหน เมื่อไร — บันทึกทุกการเพิ่ม/แก้ไข/ลบ/เปลี่ยนสถานะ/อนุมัติ/จ่ายสต๊อก และการเข้าสู่ระบบ"
        actions={
          <Button variant="outline" size="sm" onClick={() => exportXlsx("audit_log", { ...filters, q: table.q })}>
            <Download className="h-3.5 w-3.5" />
            ส่งออก Excel
          </Button>
        }
      />

      <FilterBar
        onSearch={() => {
          setFilters(draft);
          setTable((t) => ({ ...t, page: 1 }));
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilters(NO_FILTER);
          push({ kind: "info", title: "แสดงข้อมูลทั้งหมด" });
        }}
      >
        <Field label="วันที่ (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD("from", e.target.value)} />
        </Field>
        <Field label="วันที่ (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD("to", e.target.value)} />
        </Field>
        <Field label="ผู้ใช้">
          <Input placeholder="ชื่อ หรือ user id" value={draft.user} onChange={(e) => setD("user", e.target.value)} />
        </Field>
        <Field label="โมดูล">
          <Select value={draft.module} onChange={(e) => setD("module", e.target.value)}>
            <option value="">- - ทั้งหมด - -</option>
            {MODULES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="การกระทำ">
          <Select value={draft.action} onChange={(e) => setD("action", e.target.value)}>
            <option value="">- - ทั้งหมด - -</option>
            {Object.entries(ACTION).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="เลขที่ / รหัส">
          <Input placeholder="J2612088 / Q2600462 / P00012" className="num" value={draft.key} onChange={(e) => setD("key", e.target.value.trim())} />
        </Field>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={loading}
        searchPlaceholder="ค้นหา เลขที่ / รายละเอียด / ชื่อผู้ใช้…"
        server={{ total, onChange: setTable }}
        emptyText="ยังไม่มีประวัติในช่วงที่เลือก"
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${ACTION[detail.action]?.label ?? detail.action} · ${detail.key}` : ""}
        description={detail ? `${detail.at} · ${detail.user || "—"} · ${detail.summary}` : undefined}
        size="lg"
      >
        {detail?.changes && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">ฟิลด์</th>
                  <th className="px-3 py-2 text-left">ค่าเดิม</th>
                  <th className="px-3 py-2 text-left">ค่าใหม่</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(detail.changes).map(([k, [a, b]]) => (
                  <tr key={k} className="border-b border-border/70 last:border-0">
                    <td className="num px-3 py-2 font-medium">{k}</td>
                    <td className="px-3 py-2 text-muted-foreground break-all">{fmt(a)}</td>
                    <td className="px-3 py-2 break-all">{fmt(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
