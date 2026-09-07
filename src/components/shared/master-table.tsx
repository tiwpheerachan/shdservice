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

export type MasterConfig = {
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
  const [rows, setRows] = React.useState(config.rows);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<(MasterRow & { group?: string }) | null>(
    null
  );

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (r: MasterRow & { group?: string }) => {
    setEditing(r);
    setOpen(true);
  };

  const save = () => {
    setOpen(false);
    push({
      kind: "success",
      title: editing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มข้อมูลใหม่แล้ว",
      desc: `${config.title} — ระบบสาธิต ข้อมูลไม่ถูกบันทึกจริง`,
    });
  };

  const toggleStatus = (id: string) => {
    setRows((s) =>
      s.map((r) =>
        r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r
      )
    );
    push({ kind: "info", title: "เปลี่ยนสถานะเรียบร้อย" });
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
        <RowActions
          onEdit={() => openEdit(r)}
          onDelete={() =>
            push({ kind: "warning", title: "ต้องมีสิทธิ์ลบข้อมูล", desc: r.name })
          }
        />
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
            <Button variant="outline" size="sm">
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
            <Button size="sm" onClick={save}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label={config.nameLabel} required>
            <Input defaultValue={editing?.name ?? ""} placeholder={config.nameLabel} />
          </Field>
          <Field label="สถานะ" required>
            <Select defaultValue={editing?.status ?? "Active"}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
          {config.extraLabel && (
            <Field label={config.extraLabel}>
              <Select defaultValue={editing?.group ?? ""}>
                {(config.extraOptions ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
          )}
          {config.detailLabel && (
            <Field label={config.detailLabel} wide>
              <Textarea defaultValue={editing?.detail ?? ""} rows={3} />
            </Field>
          )}
        </FieldGrid>
      </Modal>
    </>
  );
}
