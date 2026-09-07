"use client";

import * as React from "react";
import { Plus, Download, MapPin } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea, Select, Radio } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Customer, CUSTOMER_TYPES, PRICE_GROUPS, PROVINCES } from "@/data/mock";
import { useCustomers } from "@/data/db";

export default function CustomersPage() {
  const { push } = useToast();
  const { data: CUSTOMERS, loading } = useCustomers();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);

  const columns: Column<Customer>[] = [
    {
      key: "code",
      header: "รหัสลูกค้า",
      width: "120px",
      cell: (r) => <span className="num font-medium">{r.code}</span>,
    },
    {
      key: "name",
      header: "ชื่อ-สกุล",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="num truncate text-2xs text-muted-foreground">
            เลขผู้เสียภาษี {r.taxId}
          </p>
        </div>
      ),
    },
    {
      key: "address",
      header: "ที่อยู่",
      hideBelow: "lg",
      cell: (r) => (
        <span className="line-clamp-2 flex max-w-[360px] gap-1.5 text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {r.address}
        </span>
      ),
    },
    {
      key: "phone",
      header: "เบอร์โทรศัพท์",
      width: "140px",
      cell: (r) => <span className="num">{r.phone}</span>,
    },
    { key: "email", header: "Email", hideBelow: "xl" },
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
          onView={() => push({ kind: "info", title: r.name, desc: r.address })}
          onEdit={() => {
            setEditing(r);
            setOpen(true);
          }}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ข้อมูลลูกค้า"
        description="ฐานข้อมูลลูกค้าบุคคลและนิติบุคคล ใช้อ้างอิงตอนเปิดงานและออกเอกสาร"
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
              เพิ่มลูกค้า
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={CUSTOMERS}
        loading={loading}
        rowKey={(r) => r.code}
        searchPlaceholder="ค้นหารหัส / ชื่อ / เบอร์โทร / อีเมล…"
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้าใหม่"}
        description={
          editing
            ? `Mode: Edit Data · Customer Id #${editing.code}`
            : "Mode: Add New · รหัสลูกค้าจะถูกสร้างอัตโนมัติ"
        }
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                push({ kind: "success", title: "บันทึกข้อมูลลูกค้าแล้ว" });
              }}
            >
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label="รหัสลูกค้า" required>
            <Input defaultValue={editing?.code ?? "Generate Auto"} readOnly={!!editing} />
          </Field>
          <Field label="ประเภทลูกค้า">
            <div className="flex items-center gap-3">
              <Select defaultValue="Normal" className="flex-1">
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
              <div className="flex shrink-0 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name="customer-channel" defaultChecked /> On-Line
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name="customer-channel" /> Off-Line
                </label>
              </div>
            </div>
          </Field>

          <Field label="ชื่อลูกค้า" required wide>
            <Input defaultValue={editing?.name ?? ""} />
          </Field>

          <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี" wide>
            <Input defaultValue={editing?.taxId ?? ""} className="num" />
          </Field>

          <Field label="ที่อยู่ เลขที่" wide>
            <Textarea
              rows={2}
              defaultValue={editing?.address ?? ""}
              placeholder="บ้านเลขที่ / หมู่ / หมู่บ้าน / อาคาร"
            />
          </Field>

          <Field label="ซอย - ถนน">
            <Input placeholder="ซอย / ถนน" />
          </Field>
          <Field label="จังหวัด">
            <Select defaultValue="">
              <option value="">- - Please Select - -</option>
              {PROVINCES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="เขต / อำเภอ">
            <Input placeholder="เขต / อำเภอ" />
          </Field>
          <Field label="แขวง / ตำบล">
            <Input placeholder="แขวง / ตำบล" />
          </Field>
          <Field label="รหัสไปรษณีย์">
            <Input className="num" placeholder="10000" />
          </Field>
          <Field label="เบอร์โทรศัพท์" required>
            <Input defaultValue={editing?.phone ?? ""} className="num" />
          </Field>

          <Field label="Email">
            <Input type="email" defaultValue={editing?.email ?? ""} />
          </Field>
          <Field label="Line ID">
            <Input defaultValue={editing?.line ?? ""} />
          </Field>

          <Field label="ใช้กลุ่มราคา">
            <Select defaultValue={PRICE_GROUPS[0]}>
              {PRICE_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="สถานะ">
            <Select defaultValue={editing?.status ?? "Active"}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
