"use client";

import * as React from "react";
import { Plus, Download, KeyRound, Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ROLES, type User } from "@/data/mock";
import { useUsers } from "@/data/db";

export default function UsersPage() {
  const { push } = useToast();
  const { data: USERS, loading } = useUsers();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<User | null>(null);

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
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-2xs font-semibold text-primary">
            {r.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="num truncate text-2xs text-muted-foreground">
              {r.username} · {r.code}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "ประเภทผู้ใช้งาน",
      cell: (r) => <Badge tone="primary">{r.role}</Badge>,
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
          <p className="num flex items-center gap-1.5">
            <Phone className="h-3 w-3" /> {r.phone}
          </p>
        </div>
      ),
    },
    {
      key: "lastLogin",
      header: "เข้าใช้งานล่าสุด",
      hideBelow: "md",
      cell: (r) => <span className="num text-xs">{r.lastLogin}</span>,
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
      width: "110px",
      align: "center",
      sortable: false,
      cell: (r) => (
        <RowActions
          onEdit={() => {
            setEditing(r);
            setOpen(true);
          }}
          onCancel={() =>
            push({ kind: "info", title: "รีเซ็ตรหัสผ่าน", desc: `ส่งลิงก์ไปที่ ${r.email}` })
          }
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ผู้ใช้ระบบ"
        description="จัดการบัญชีผู้ใช้ สิทธิ์การเข้าถึง และสถานะการใช้งาน"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              ส่งออก Excel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              เพิ่มผู้ใช้งาน
            </Button>
          </>
        }
      />

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
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                push({ kind: "success", title: "บันทึกข้อมูลผู้ใช้แล้ว" });
              }}
            >
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label="รหัสพนักงาน" required>
            <Input defaultValue={editing?.code ?? ""} placeholder="EMP-000" />
          </Field>
          <Field label="ชื่อ-สกุล" required>
            <Input defaultValue={editing?.name ?? ""} />
          </Field>
          <Field label="Username" required>
            <Input defaultValue={editing?.username ?? ""} />
          </Field>
          <Field label="ประเภทผู้ใช้งาน" required>
            <Select defaultValue={editing?.role ?? ROLES[0]}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="อีเมล">
            <Input type="email" defaultValue={editing?.email ?? ""} />
          </Field>
          <Field label="เบอร์โทรศัพท์">
            <Input defaultValue={editing?.phone ?? ""} />
          </Field>
          <Field label="สาขา / หน่วยงาน">
            <Input defaultValue={editing?.branch ?? ""} />
          </Field>
          <Field label="สถานะ">
            <Select defaultValue={editing?.status ?? "Active"}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
          <Field
            label="รหัสผ่าน"
            hint="เว้นว่างไว้หากไม่ต้องการเปลี่ยนรหัสผ่าน"
            wide
          >
            <div className="flex gap-2">
              <Input type="password" placeholder="••••••••" className="flex-1" />
              <Button variant="outline" size="md" type="button">
                <KeyRound className="h-3.5 w-3.5" />
                สุ่มรหัส
              </Button>
            </div>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
