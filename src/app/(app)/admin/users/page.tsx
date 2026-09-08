"use client";

import * as React from "react";
import { Plus, Download, ShieldCheck, Mail, Phone, Loader2, Clock, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { PeoplePicker, type Person } from "@/components/shared/people-picker";
import { useToast } from "@/components/ui/toast";
import { ROLES, type User } from "@/data/mock";
import { useUsers } from "@/data/db";

type UserForm = {
  id: string;
  code: string;
  name: string;
  username: string;
  role: string;
  branch: string;
  email: string;
  phone: string;
  status: string;
  avatar: string;
};

const EMPTY: UserForm = {
  id: "",
  code: "",
  name: "",
  username: "",
  role: ROLES[0],
  branch: "",
  email: "",
  phone: "",
  status: "Active",
  avatar: "",
};

export default function UsersPage() {
  const { push } = useToast();
  const [view, setView] = React.useState<"active" | "deleted">("active");
  const { data: USERS, loading, refetch } = useUsers(
    view === "deleted" ? "only" : "exclude"
  );
  const pendingCount = USERS.filter((u) => u.role === "รออนุมัติ").length;
  // auto-refresh so users who just signed in (pending) show up without a reload
  React.useEffect(() => {
    if (view !== "active") return;
    const id = setInterval(() => refetch(), 25000);
    return () => clearInterval(id);
  }, [refetch, view]);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<UserForm>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const openAdd = () => {
    setForm(EMPTY);
    setEditing(false);
    setOpen(true);
  };

  const toForm = (r: User): UserForm => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name ?? "",
    username: r.username ?? "",
    role: r.role ?? ROLES[0],
    branch: r.branch ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    status: r.status ?? "Active",
    avatar: r.avatar ?? "",
  });

  const openEdit = (r: User) => {
    setForm(toForm(r));
    setEditing(true);
    setOpen(true);
  };

  // Approve in ONE click — assign a default real role + Active immediately.
  // (Change the role afterwards via the edit pencil if needed.)
  const approveNow = (r: User) =>
    quickSet(r, { role: "เจ้าหน้าที่รับงาน", status: "Active" }, "อนุมัติแล้ว");

  // เลือกพนักงานจาก Lark directory → เติมข้อมูลอัตโนมัติ
  const pickPerson = (p: Person | null) => {
    if (!p) return;
    setForm((f) => ({
      ...f,
      name: p.name || f.name,
      email: (p.email || f.email).toLowerCase(),
      username: p.email ? p.email.split("@")[0] : f.username,
      code: p.id || f.code,
      branch: p.department || f.branch,
      avatar: p.avatar || f.avatar,
    }));
  };

  // POST a user with one automatic session-refresh + retry on 401, so a valid
  // write is never silently lost to an expiring cookie. Returns the parsed data
  // or throws; returns null if it had to redirect to re-login.
  const postUser = async (body: Record<string, unknown>) => {
    const doPost = () =>
      fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `error ${res.status}`);
    return data;
  };

  const save = async () => {
    if (!form.name.trim() || !form.role.trim()) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องมีชื่อและประเภทผู้ใช้งาน" });
      return;
    }
    setSaving(true);
    try {
      const data = await postUser(form);
      if (!data) return;
      push({
        kind: "success",
        title: data.created ? "เพิ่มผู้ใช้งานแล้ว" : "บันทึกการแก้ไขแล้ว",
        desc: `${form.name} · ${form.role}`,
      });
      setOpen(false);
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

  // Quick inline actions (revoke / restore) — write straight to the DB and refetch.
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const quickSet = async (r: User, patch: Partial<UserForm>, okTitle: string) => {
    setBusyId(r.id);
    try {
      const data = await postUser({ ...toForm(r), ...patch });
      if (!data) return;
      push({ kind: "success", title: okTitle, desc: r.name });
      refetch();
    } catch (e) {
      push({
        kind: "error",
        title: "ทำรายการไม่สำเร็จ",
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  // Soft delete / restore via the generic records endpoint (401-resilient).
  const softSet = async (r: User, deleted: boolean) => {
    setBusyId(r.id);
    try {
      const doPost = () =>
        fetch("/api/admin/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: "users", id: r.id, deleted }),
        });
      let res = await doPost();
      if (res.status === 401) {
        await fetch("/api/sso/refresh", { cache: "no-store" }).catch(() => {});
        await new Promise((x) => setTimeout(x, 400));
        res = await doPost();
      }
      if (res.status === 401) {
        window.location.href =
          "/api/sso/login?next=" + encodeURIComponent(window.location.pathname);
        return;
      }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `error ${res.status}`);
      push({
        kind: "success",
        title: deleted ? "ย้ายไปรายการที่ลบแล้ว" : "กู้คืนแล้ว",
        desc: r.name,
      });
      refetch();
    } catch (e) {
      push({
        kind: "error",
        title: "ทำรายการไม่สำเร็จ",
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<User>[] = [
    {
      key: "no",
      header: "#",
      width: "52px",
      align: "center",
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: "name",
      header: "ชื่อผู้ใช้งาน",
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          {r.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.avatar}
              alt={r.name}
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-2xs font-semibold text-primary">
              {r.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="num truncate text-2xs text-muted-foreground">
              {r.username}
              {r.code ? ` · ${r.code}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "ประเภทผู้ใช้งาน / สิทธิ์",
      cell: (r) =>
        r.role === "รออนุมัติ" ? (
          <Badge tone="warning" dot>
            {r.role}
          </Badge>
        ) : (
          <Badge tone="primary">{r.role}</Badge>
        ),
    },
    { key: "branch", header: "สาขา / หน่วยงาน", hideBelow: "lg" },
    {
      key: "email",
      header: "ติดต่อ",
      hideBelow: "xl",
      cell: (r) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> {r.email}
          </p>
          {r.phone && (
            <p className="num flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> {r.phone}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "lastLogin",
      header: "เข้าใช้งานล่าสุด",
      hideBelow: "md",
      cell: (r) => <span className="num text-xs">{r.lastLogin || "—"}</span>,
    },
    {
      key: "status",
      header: "สถานะ",
      width: "100px",
      cell: (r) => (
        <Badge tone={r.status === "Active" ? "success" : "neutral"} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "150px",
      align: "center",
      sortable: false,
      cell: (r) =>
        view === "deleted" ? (
          <div className="flex items-center justify-center">
            <button
              disabled={busyId === r.id}
              onClick={() => softSet(r, false)}
              className="rounded-md border border-success/30 px-2.5 py-1 text-2xs font-medium text-success transition-colors hover:bg-success-soft disabled:opacity-50"
            >
              กู้คืน
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            {r.role === "รออนุมัติ" ? (
              <button
                disabled={busyId === r.id}
                onClick={() => approveNow(r)}
                className="rounded-md bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                อนุมัติ
              </button>
            ) : r.status === "Active" ? (
              <button
                disabled={busyId === r.id}
                onClick={() => quickSet(r, { status: "Inactive" }, "ถอนสิทธิ์แล้ว")}
                className="rounded-md border border-danger/30 px-2.5 py-1 text-2xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
              >
                ถอนสิทธิ์
              </button>
            ) : (
              <button
                disabled={busyId === r.id}
                onClick={() => quickSet(r, { status: "Active" }, "คืนสิทธิ์แล้ว")}
                className="rounded-md border border-success/30 px-2.5 py-1 text-2xs font-medium text-success transition-colors hover:bg-success-soft disabled:opacity-50"
              >
                คืนสิทธิ์
              </button>
            )}
            <RowActions onEdit={() => openEdit(r)} onDelete={() => softSet(r, true)} />
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ผู้ใช้ระบบ"
        description="เพิ่มผู้ใช้จากไดเรกทอรี Lark และกำหนดสิทธิ์การเข้าถึงตามบทบาท"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มผู้ใช้งาน
            </Button>
          </>
        }
      />

      <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
        {(["active", "deleted"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              "rounded-md px-3.5 py-1.5 font-medium transition-colors " +
              (view === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {v === "active" ? "ผู้ใช้งาน" : "รายการที่ลบ"}
          </button>
        ))}
      </div>

      {view === "active" && pendingCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
          <Clock className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-sm font-medium text-warning">
            มี {pendingCount} บัญชีรอการอนุมัติ
          </span>
          <span className="text-2xs text-warning/80">
            กด “อนุมัติ” ที่แถวนั้นเพื่อกำหนดบทบาทและเปิดสิทธิ์ใช้งาน
          </span>
          <button
            onClick={() => refetch()}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-warning/30 px-2.5 py-1 text-2xs font-medium text-warning transition-colors hover:bg-warning/10"
          >
            <RefreshCw className="h-3 w-3" />
            รีเฟรช
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={USERS}
        loading={loading}
        rowKey={(r) => r.id}
        searchPlaceholder="ค้นหาชื่อ, username, อีเมล…"
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "แก้ไขผู้ใช้ระบบ" : "เพิ่มผู้ใช้ระบบ"}
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "บันทึกข้อมูล" : "เพิ่มผู้ใช้งาน"}
            </Button>
          </>
        }
      >
        {!editing && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
            <label className="mb-1.5 block text-xs font-medium text-foreground">
              ค้นหาพนักงานจากไดเรกทอรี Lark
            </label>
            <PeoplePicker value={null} onChange={pickPerson} placeholder="พิมพ์ชื่อพนักงาน SHD เพื่อค้นหา…" />
            <p className="mt-1.5 text-2xs text-muted-foreground">
              เลือกจากรายชื่อจริง แล้วระบบจะเติมชื่อ อีเมล และหน่วยงานให้อัตโนมัติ
            </p>
          </div>
        )}

        {(form.avatar || form.name) && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            {form.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.avatar}
                alt={form.name}
                className="h-12 w-12 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                {form.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{form.name || "—"}</p>
              <p className="truncate text-2xs text-muted-foreground">{form.email || "ยังไม่ได้เลือกพนักงาน"}</p>
            </div>
          </div>
        )}

        <FieldGrid cols={2}>
          <Field label="ชื่อ-สกุล" required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="อีเมล">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Username">
            <Input value={form.username} onChange={(e) => set("username", e.target.value)} />
          </Field>
          <Field label="รหัสพนักงาน / Lark ID">
            <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="—" />
          </Field>
          <Field label="ประเภทผู้ใช้งาน / สิทธิ์" required hint="กำหนดบทบาทเพื่อคุมสิทธิ์เมนูที่เข้าถึงได้">
            <Select value={form.role} onChange={(e) => set("role", e.target.value)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="สาขา / หน่วยงาน">
            <Input value={form.branch} onChange={(e) => set("branch", e.target.value)} />
          </Field>
          <Field label="เบอร์โทรศัพท์">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="สถานะ">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
        </FieldGrid>

        <p className="mt-4 flex items-start gap-2 rounded-md bg-primary-soft/60 px-3 py-2 text-2xs text-primary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ผู้ใช้เข้าสู่ระบบด้วย SHD SSO — ไม่มีรหัสผ่านในระบบนี้ สิทธิ์การใช้งานกำหนดจากบทบาทที่เลือก
          (จัดการรายละเอียดสิทธิ์ได้ที่หน้า “สิทธิ์การใช้งาน”)
        </p>
      </Modal>
    </>
  );
}
