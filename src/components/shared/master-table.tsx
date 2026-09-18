"use client";

import * as React from "react";
import { Plus, Download } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "./page-header";
import { RowActions } from "./row-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { MasterRow } from "@/data/mock";
import { postJson, errMsg, exportXlsx } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

/** API resource name of the master (= /api/masters/<kind>, /api/admin/records table) */
export type MasterKind = "categories" | "manufacturers" | "colors" | "job_types" | "product_types" | "symptoms";

export type MasterConfig = {
  kind: MasterKind;
  title: string;
  description: string;
  nameLabel: string;
  detailLabel?: string;
  extraLabel?: string;
  extraOptions?: string[];
  rows: (MasterRow & { group?: string })[];
};

export function MasterTable({ config }: { config: MasterConfig }) {
  const { push } = useToast();
  const { isAdmin } = useAccess();
  const [rows, setRows] = React.useState(config.rows);
  React.useEffect(() => setRows(config.rows), [config.rows]);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<(MasterRow & { group?: string }) | null>(
    null
  );
  const [form, setForm] = React.useState({ name: "", status: "Active", group: "", detail: "" });
  const [saving, setSaving] = React.useState(false);

  // group options = configured list ∪ values already in the DB
  const groupOptions = React.useMemo(() => {
    const set = new Set<string>(["", ...(config.extraOptions ?? [])]);
    for (const r of rows) if (r.group) set.add(r.group);
    return Array.from(set);
  }, [rows, config.extraOptions]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", status: "Active", group: "", detail: "" });
    setOpen(true);
  };
  const openEdit = (r: MasterRow & { group?: string }) => {
    setEditing(r);
    setForm({ name: r.name, status: r.status, group: r.group ?? "", detail: r.detail ?? "" });
    setOpen(true);
  };

  const upsertRow = (row: MasterRow & { group?: string }) =>
    setRows((s) => (s.some((x) => x.id === row.id) ? s.map((x) => (x.id === row.id ? row : x)) : [...s, row]));

  const save = async () => {
    if (!form.name.trim()) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: `ต้องระบุ${config.nameLabel}` });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ row: MasterRow & { group?: string } }>(`/api/masters/${config.kind}`, {
        id: editing?.id,
        name: form.name.trim(),
        detail: form.detail,
        group: form.group,
        status: form.status,
      });
      upsertRow(d.row);
      setOpen(false);
      push({
        kind: "success",
        title: editing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มข้อมูลใหม่แล้ว",
        desc: `${config.title} — ${d.row.name}`,
      });
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // สถานะ = is_active ในตารางเดิม (Inactive = ซ่อนจาก dropdown ทุกหน้า)
  const toggleStatus = async (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const next = r.status === "Active" ? "Inactive" : "Active";
    try {
      await postJson("/api/admin/records", { table: config.kind, id, status: next === "Inactive" ? "INACTIVE" : "ACTIVE" });
      setRows((s) => s.map((x) => (x.id === id ? { ...x, status: next } : x)));
      push({ kind: "info", title: "เปลี่ยนสถานะเรียบร้อย", desc: `${r.name} → ${next}` });
    } catch (e) {
      push({ kind: "error", title: "เปลี่ยนสถานะไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const remove = async (r: MasterRow) => {
    if (!isAdmin) {
      push({ kind: "warning", title: "ต้องมีสิทธิ์ลบข้อมูล", desc: r.name });
      return;
    }
    if (!window.confirm(`ลบ "${r.name}"? (ซ่อนจากทุกหน้า กู้คืนได้ทาง SQL เท่านั้น)`)) return;
    try {
      await postJson("/api/admin/records", { table: config.kind, id: r.id, status: "DELETED" });
      setRows((s) => s.filter((x) => x.id !== r.id));
      push({ kind: "success", title: "ลบข้อมูลแล้ว", desc: r.name });
    } catch (e) {
      push({ kind: "error", title: "ลบไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const columns: Column<MasterRow & { group?: string }>[] = [
    {
      key: "no",
      header: "#",
      width: "56px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "name",
      header: config.nameLabel,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    ...(config.detailLabel
      ? [
          {
            key: "detail",
            header: config.detailLabel,
            hideBelow: "md" as const,
            cell: (r: MasterRow) => (
              <span className="text-muted-foreground">{r.detail || "—"}</span>
            ),
          },
        ]
      : []),
    ...(config.extraLabel
      ? [
          {
            key: "group",
            header: config.extraLabel,
            hideBelow: "lg" as const,
            cell: (r: MasterRow & { group?: string }) => (
              <Badge tone="info">{r.group}</Badge>
            ),
          },
        ]
      : []),
    {
      key: "id",
      header: "ID",
      width: "110px",
      hideBelow: "sm",
      cell: (r) => <span className="num text-xs text-muted-foreground">{r.id}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      width: "110px",
      cell: (r) => (
        <button onClick={() => toggleStatus(r.id)} title="คลิกเพื่อสลับสถานะ">
          <Badge tone={r.status === "Active" ? "success" : "neutral"} dot>
            {r.status}
          </Badge>
        </button>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions onEdit={() => openEdit(r)} onDelete={() => remove(r)} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportXlsx(config.kind, { deleted: "exclude" })}>
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มข้อมูล
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        searchPlaceholder={`ค้นหา ${config.nameLabel}…`}
        footerNote={
          <span className="hidden sm:inline">
            · Active {rows.filter((r) => r.status === "Active").length} รายการ
          </span>
        }
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `แก้ไข${config.title}` : `เพิ่ม${config.title}`}
        description="กรอกข้อมูลให้ครบถ้วน ช่องที่มี * จำเป็นต้องระบุ"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label={config.nameLabel} required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={config.nameLabel}
            />
          </Field>
          <Field label="สถานะ" required>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
          {config.extraLabel && (
            <Field label={config.extraLabel}>
              {/* พิมพ์กลุ่มใหม่ได้ + เลือกจากค่าที่มีอยู่แล้วใน DB (datalist) */}
              <Input
                list={`${config.kind}-group-options`}
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder="- - ไม่ระบุ - -"
              />
              <datalist id={`${config.kind}-group-options`}>
                {groupOptions.filter(Boolean).map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </Field>
          )}
          {config.detailLabel && (
            <Field label={config.detailLabel} wide>
              <Textarea
                value={form.detail}
                onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
                rows={3}
              />
            </Field>
          )}
        </FieldGrid>
      </Modal>
    </>
  );
}
