"use client";

import * as React from "react";
import { Save, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ROLES, type Permission } from "@/data/mock";
import { usePermissions } from "@/data/db";

export default function PermissionsPage() {
  const { push } = useToast();
  const { data: perms, loading } = usePermissions();
  const [rows, setRows] = React.useState<Permission[]>([]);
  const [role, setRole] = React.useState<string>("ทั้งหมด");

  React.useEffect(() => setRows(perms), [perms]);

  const toggle = (id: string, key: "add" | "edit" | "del" | "view") =>
    setRows((s) => s.map((r) => (r.id === id ? { ...r, [key]: !r[key] } : r)));

  const filtered = role === "ทั้งหมด" ? rows : rows.filter((r) => r.role === role);

  const check = (
    key: "add" | "edit" | "del" | "view",
    header: string
  ): Column<Permission> => ({
    key,
    header,
    align: "center",
    width: "130px",
    sortable: false,
    cell: (r) => (
      <Checkbox checked={r[key]} onChange={() => toggle(r.id, key)} aria-label={header} />
    ),
  });

  const columns: Column<Permission>[] = [
    {
      key: "no",
      header: "#",
      width: "52px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "role",
      header: "ประเภทผู้ใช้งาน",
      cell: (r) => <Badge tone="primary">{r.role}</Badge>,
    },
    {
      key: "menu",
      header: "เมนูงาน",
      cell: (r) => <span className="font-medium">{r.menu}</span>,
    },
    check("add", "สิทธิการเพิ่มข้อมูล"),
    check("edit", "สิทธิการแก้ไขข้อมูล"),
    check("del", "สิทธิการลบข้อมูล"),
    check("view", "สิทธิการดูข้อมูล"),
  ];

  return (
    <>
      <PageHeader
        title="สิทธิการใช้งาน"
        description="กำหนดสิทธิ์เพิ่ม / แก้ไข / ลบ / ดูข้อมูล แยกตามประเภทผู้ใช้งานและเมนู"
        actions={
          <Button
            size="sm"
            onClick={() => push({ kind: "success", title: "บันทึกสิทธิ์การใช้งานแล้ว" })}
          >
            <Save className="h-3.5 w-3.5" />
            บันทึกสิทธิ์
          </Button>
        }
      />

      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">กรองตามประเภทผู้ใช้งาน</span>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-8 w-full text-xs sm:w-56"
        >
          <option>ทั้งหมด</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <span className="num text-xs text-muted-foreground">
          {filtered.length} รายการสิทธิ์
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={25}
        searchPlaceholder="ค้นหาเมนู หรือประเภทผู้ใช้…"
        dense
      />
    </>
  );
}
