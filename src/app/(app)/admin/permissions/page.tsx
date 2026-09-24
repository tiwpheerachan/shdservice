"use client";

import * as React from "react";
import { Save, ShieldCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { SearchSelect, strOptions } from "@/components/shared/search-select";
import { Field } from "@/components/ui/field";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ROLES, type Permission } from "@/data/mock";
import { usePermissions, useRoles, useModules } from "@/data/db";

// เมนูงาน (module) และบทบาท (user_type) มาจากตาราง app_config ของระบบเดิม
// — ค่า fallback ด้านล่างใช้เฉพาะระหว่างโหลด
const FALLBACK_MENUS = [
  "Job Management",
  "Job Assign",
  "Job Repair",
  "Job Closing",
  "Product",
  "Product Onhand",
  "Product Receive Stock",
  "Product Pick Stock",
  "Customer",
  "Quotation",
  "Sale Order",
];
const FALLBACK_ROLES = ROLES.filter((r) => r !== "รออนุมัติ");

type Key = string; // `${role}::${menu}`
const keyOf = (role: string, menu: string): Key => `${role}::${menu}`;

type Cell = { add: boolean; edit: boolean; del: boolean; view: boolean };

export default function PermissionsPage() {
  const { push } = useToast();
  const { data: perms, loading, refetch } = usePermissions();
  const { data: dbRoles } = useRoles();
  const { data: dbModules } = useModules();
  const ASSIGNABLE_ROLES = dbRoles.length ? dbRoles : FALLBACK_ROLES;
  const MENUS = dbModules.length ? dbModules : FALLBACK_MENUS;
  const [map, setMap] = React.useState<Record<Key, Cell>>({});
  const [role, setRole] = React.useState<string>(ASSIGNABLE_ROLES[0]);
  // filter bar: ประเภทผู้ใช้งาน picks the role being edited (applied on ค้นหา); เมนูงาน narrows
  // the rows shown — edits live in `map` for every menu, so hidden rows are still saved
  const [menuFilter, setMenuFilter] = React.useState("");
  const [draft, setDraft] = React.useState({ role: ASSIGNABLE_ROLES[0], menu: "" });
  React.useEffect(() => {
    // roles arrive from the server after first render — align the default once
    if (!dbRoles.length) return;
    setRole((r) => (dbRoles.includes(r) ? r : dbRoles[0]));
    setDraft((d) => (dbRoles.includes(d.role) ? d : { ...d, role: dbRoles[0] }));
  }, [dbRoles]);
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

  // rows for the selected role — every menu (so anything can be granted), narrowed by the เมนูงาน filter
  const viewRows: Permission[] = MENUS.filter((menu) => !menuFilter || menu === menuFilter).map((menu) => {
    const c = cellOf(role, menu);
    return { id: keyOf(role, menu), role, menu, ...c };
  });

  const save = async () => {
    setSaving(true);
    try {
      const items = MENUS.map((menu) => ({ role, menu, ...cellOf(role, menu) }));
      const doPost = () =>
        fetch("/api/admin/permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
      let res = await doPost();
      if (res.status === 401) {
        await fetch("/api/sso/refresh", { cache: "no-store" }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        res = await doPost();
      }
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

      <FilterBar
        onSearch={() => {
          setRole(draft.role);
          setMenuFilter(draft.menu);
        }}
        onReset={() => {
          setDraft({ role: ASSIGNABLE_ROLES[0], menu: "" });
          setRole(ASSIGNABLE_ROLES[0]);
          setMenuFilter("");
        }}
      >
        <Field label="ประเภทผู้ใช้งาน" required>
          <SearchSelect value={draft.role} onChange={(v) => setDraft((d) => ({ ...d, role: v }))} options={strOptions(ASSIGNABLE_ROLES)} />
        </Field>
        <Field label="เมนูงาน">
          <SearchSelect placeholder="ทั้งหมด" emptyLabel="ทั้งหมด" value={draft.menu} onChange={(v) => setDraft((d) => ({ ...d, menu: v }))} options={strOptions(MENUS)} />
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={viewRows}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={25}
        dense
        toolbar={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            กำลังกำหนดสิทธิ์ของ <Badge tone="primary">{role}</Badge>
            <span className="num">{viewRows.length} / {MENUS.length} เมนู</span>
          </span>
        }
      />
    </>
  );
}
