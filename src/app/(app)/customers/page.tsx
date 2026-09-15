"use client";

import * as React from "react";
import { Plus, Download, MapPin } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea, Select, Radio } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Customer, CUSTOMER_TYPES, PRICE_GROUPS } from "@/data/mock";
import { useCustomersPage, useProvinces } from "@/data/db";
import { api, postJson, errMsg, qs } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

type Opt = { id: number; name: string; postal?: string };

type CustomerForm = {
  code: string;
  type: string;
  online: boolean;
  name: string;
  taxId: string;
  address1: string;
  address2: string;
  cityId: number;
  districtId: number;
  subDistrictId: number;
  postalCode: string;
  phone: string;
  email: string;
  line: string;
  priceGroup: string;
  status: string;
};

const EMPTY: CustomerForm = {
  code: "",
  type: "Normal",
  online: true,
  name: "",
  taxId: "",
  address1: "",
  address2: "",
  cityId: -1,
  districtId: -1,
  subDistrictId: -1,
  postalCode: "",
  phone: "",
  email: "",
  line: "",
  priceGroup: PRICE_GROUPS[0],
  status: "Active",
};

export default function CustomersPage() {
  const { push } = useToast();
  const { add: canAdd, edit: canEdit } = useAccess().forPath("/customers");

  // server-side paging / search over the customer table (43k rows)
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  const { rows: CUSTOMERS, total, loading, refetch } = useCustomersPage({
    page: table.page,
    pageSize: table.pageSize,
    q: table.q,
    sort: table.sort?.key,
    dir: table.sort?.dir,
  });

  const { data: PROVINCES } = useProvinces();
  const [districts, setDistricts] = React.useState<Opt[]>([]);
  const [subDistricts, setSubDistricts] = React.useState<Opt[]>([]);

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [form, setForm] = React.useState<CustomerForm>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // cascading address lists (mt_city → mt_district → mt_sub_district)
  React.useEffect(() => {
    if (form.cityId > 0) {
      api<{ rows: Opt[] }>(`/api/address${qs({ level: "district", city: form.cityId })}`)
        .then((d) => setDistricts(d.rows))
        .catch(() => setDistricts([]));
    } else setDistricts([]);
  }, [form.cityId]);
  React.useEffect(() => {
    if (form.districtId > 0) {
      api<{ rows: Opt[] }>(`/api/address${qs({ level: "subdistrict", district: form.districtId })}`)
        .then((d) => setSubDistricts(d.rows))
        .catch(() => setSubDistricts([]));
    } else setSubDistricts([]);
  }, [form.districtId]);

  const openForm = (c: Customer | null) => {
    setEditing(c);
    setForm(
      c
        ? {
            code: c.code,
            type: c.type ?? "Normal",
            online: c.online !== false,
            name: c.name,
            taxId: c.taxId,
            address1: c.address1 || c.address,
            address2: c.address2 ?? "",
            cityId: c.cityId ?? -1,
            districtId: c.districtId ?? -1,
            subDistrictId: c.subDistrictId ?? -1,
            postalCode: c.postalCode ?? "",
            phone: c.phone,
            email: c.email,
            line: c.line,
            priceGroup: c.priceGroup ?? PRICE_GROUPS[0],
            status: c.status,
          }
        : EMPTY
    );
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุชื่อลูกค้า" });
      return;
    }
    if (!form.phone.trim()) {
      push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุเบอร์โทรศัพท์" });
      return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ row: Customer }>("/api/customers", { ...form, code: editing?.code || undefined });
      setOpen(false);
      push({ kind: "success", title: "บันทึกข้อมูลลูกค้าแล้ว", desc: `${d.row.code} · ${d.row.name}` });
      refetch();
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

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
            เลขผู้เสียภาษี {r.taxId || "—"}
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
          onEdit={canEdit ? () => openForm(r) : undefined}
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
            {canAdd && (
              <Button size="sm" onClick={() => openForm(null)}>
                <Plus className="h-3.5 w-3.5" />
                เพิ่มลูกค้า
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={CUSTOMERS}
        loading={loading}
        rowKey={(r) => r.code}
        searchPlaceholder="ค้นหารหัส / ชื่อ / เบอร์โทร / อีเมล…"
        server={{ total, onChange: setTable }}
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
            <Button size="sm" onClick={save} disabled={saving}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label="รหัสลูกค้า" required>
            <Input value={editing?.code ?? "Generate Auto"} readOnly />
          </Field>
          <Field label="ประเภทลูกค้า">
            <div className="flex items-center gap-3">
              <Select value={form.type} onChange={(e) => set("type", e.target.value)} className="flex-1">
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
              <div className="flex shrink-0 items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name="customer-channel" checked={form.online} onChange={() => set("online", true)} /> On-Line
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Radio name="customer-channel" checked={!form.online} onChange={() => set("online", false)} /> Off-Line
                </label>
              </div>
            </div>
          </Field>

          <Field label="ชื่อลูกค้า" required wide>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>

          <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี" wide>
            <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} className="num" />
          </Field>

          <Field label="ที่อยู่ เลขที่" wide>
            <Textarea
              rows={2}
              value={form.address1}
              onChange={(e) => set("address1", e.target.value)}
              placeholder="บ้านเลขที่ / หมู่ / หมู่บ้าน / อาคาร"
            />
          </Field>

          <Field label="ซอย - ถนน">
            <Input value={form.address2} onChange={(e) => set("address2", e.target.value)} placeholder="ซอย / ถนน" />
          </Field>
          <Field label="จังหวัด">
            <Select
              value={form.cityId > 0 ? String(form.cityId) : ""}
              onChange={(e) => setForm((f) => ({ ...f, cityId: Number(e.target.value) || -1, districtId: -1, subDistrictId: -1 }))}
            >
              <option value="">- - Please Select - -</option>
              {PROVINCES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="เขต / อำเภอ">
            <Select
              value={form.districtId > 0 ? String(form.districtId) : ""}
              onChange={(e) => setForm((f) => ({ ...f, districtId: Number(e.target.value) || -1, subDistrictId: -1 }))}
              disabled={form.cityId <= 0}
            >
              <option value="">- - Please Select - -</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="แขวง / ตำบล">
            <Select
              value={form.subDistrictId > 0 ? String(form.subDistrictId) : ""}
              onChange={(e) => {
                const id = Number(e.target.value) || -1;
                const hit = subDistricts.find((s) => s.id === id);
                setForm((f) => ({ ...f, subDistrictId: id, postalCode: hit?.postal || f.postalCode }));
              }}
              disabled={form.districtId <= 0}
            >
              <option value="">- - Please Select - -</option>
              {subDistricts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="รหัสไปรษณีย์">
            <Input value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} className="num" placeholder="10000" />
          </Field>
          <Field label="เบอร์โทรศัพท์" required>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="num" />
          </Field>

          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Line ID">
            <Input value={form.line} onChange={(e) => set("line", e.target.value)} />
          </Field>

          <Field label="ใช้กลุ่มราคา">
            <Select value={form.priceGroup} onChange={(e) => set("priceGroup", e.target.value)}>
              {PRICE_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="สถานะ">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
