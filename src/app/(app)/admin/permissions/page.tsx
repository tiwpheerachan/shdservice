"use client";

import * as React from "react";
import { Save, ShieldCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ROLES, type Permission } from "@/data/mock";
import { usePermissions } from "@/data/db";

// เมนูงานหลักของระบบ — ใช้สร้าง matrix สิทธิ์ให้ครบทุก role
const MENUS = [
  "ข้อมูลระบบ",
  "ข้อมูลอะไหล่",
  "ข้อมูลลูกค้า",
  "ข้อมูลงานบริการ",
  "ข้อมูลเสนอราคา",
  "ข้อมูลใบสั่งขาย",
  "รายงาน",
];

// role ที่กำหนดสิทธิ์ได้ (ตัด "รออนุมัติ" ออก — เป็นสถานะรอ ไม่ใช่บทบาทใช้งาน)
const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== "รออนุมัติ");

type Key = string; // `${role}::${menu}`
const keyOf = (role: string, menu: string): Key => `${role}::${menu}`;

type Cell = { add: boolean; edit: boolean; del: boolean; view: boolean };

export default function PermissionsPage() {
  const { push } = useToast();
  const { data: perms, loading, refetch } = usePermissions();
  const [map, setMap] = React.useState<Record<Key, Cell>>({});
  const [role, setRole] = React.useState<string>(ASSIGNABLE_ROLES[0]);
  const [saving, setSaving] = React.useState(false);

  // build the editable map from DB rows
  React.useEffect(() => {
    const m: Record<Key, Cell> = {};
    for (const p of perms) {
      m[keyOf(p.role, p.menu)] = {
        add: !!p.add,
        edit: !!p.edit,
        del: !!p.del,
        view: !!p.view,
      };
    }
    setMap(m);
  }, [perms]);

  const cellOf = (r: string, menu: string): Cell =>
    map[keyOf(r, menu)] ?? { add: false, edit: false, del: false, view: false };

  const toggle = (menu: string, field: keyof Cell) =>
    setMap((s) => {
      const k = keyOf(role, menu);
      const cur = s[k] ?? { add: false, edit: false, del: false, view: false };
      return { ...s, [k]: { ...cur, [field]: !cur[field] } };
    });

  // rows for the selected role — always all menus, so anything can be granted
  const viewRows: Permission[] = MENUS.map((menu) => {
    const c = cellOf(role, menu);
    return { id: keyOf(role, menu), role, menu, ...c };
  });

  const save = async () => {
    setSaving(true);
    try {
      const items = MENUS.map((menu) => ({ role, menu, ...cellOf(role, menu) }));
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.status === 401) {
        window.location.href =
          "/api/sso/login?next=" + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `error ${res.status}`);
      push({ kind: "success", title: "บันทึกสิทธิ์แล้ว", desc: `บทบาท: ${role}` });
      refetch();
    } catch (e) {
      push({
        kind: "error",
        title: "บันทึกไม่สำเร็จ",
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const check = (field: keyof Cell, header: string): Column<Permission> => ({
    key: field,
    header,
    align: "center",
    width: "130px",
    sortable: false,
    cell: (r) => (
      <Checkbox
        checked={!!r[field]}
        onChange={() => toggle(r.menu, field)}
        aria-label={`${header} · ${r.menu}`}
      />
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
      key: "menu",
      header: "เมนูงาน",
      cell: (r) => <span className="font-medium">{r.menu}</span>,
    },
    check("add", "เพิ่ม"),
    check("edit", "แก้ไข"),
    check("del", "ลบ"),
    check("view", "ดู"),
  ];

  return (
    <>
      <PageHeader
        title="สิทธิการใช้งาน"
        description="กำหนดสิทธิ์เพิ่ม / แก้ไข / ลบ / ดูข้อมูล แยกตามบทบาทและเมนูงาน"
        actions={
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            บันทึกสิทธิ์
          </Button>
        }
      />

      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">บทบาทที่กำหนดสิทธิ์</span>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-8 w-full text-xs sm:w-56"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <Badge tone="primary">{role}</Badge>
        <span className="num text-xs text-muted-foreground">{MENUS.length} เมนู</span>
      </div>

      <DataTable
        columns={columns}
        rows={viewRows}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={25}
        searchPlaceholder="ค้นหาเมนู…"
        dense
      />
    </>
  );
}
