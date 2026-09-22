"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, MapPin } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { FilterBar } from "@/components/shared/filter-bar";
import { DataTable, type Column, type ServerTableState } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CUSTOMER_TYPES, type Customer } from "@/data/mock";
import { useCustomersPage, useProvinces } from "@/data/db";
import { CustomerFields, ConflictNotice, EMPTY_CUSTOMER, toCustomerForm, type CustomerFormValues, type CustomerConflict } from "@/components/shared/customer-form";
import { api, postJson, errMsg, qs, exportXlsx, ApiError } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

export default function CustomersPage() {
  const { push } = useToast();
  const router = useRouter();
  const { add: canAdd, edit: canEdit } = useAccess().forPath("/customers");

  // server-side paging / search over the customer table (43k rows)
  const [table, setTable] = React.useState<ServerTableState>({ page: 1, pageSize: 25, q: "", sort: null });
  // filter bar (applied on ค้นหา) — every field is AND-ed on the server; same params feed the Excel export
  type CustomerFilter = { code: string; name: string; phone: string; email: string; taxId: string; type: string; province: string; status: "" | "Active" | "Inactive" };
  const NO_FILTER: CustomerFilter = { code: "", name: "", phone: "", email: "", taxId: "", type: "", province: "", status: "" };
  const [draft, setDraft] = React.useState<CustomerFilter>(NO_FILTER);
  const [filter, setFilter] = React.useState<CustomerFilter>(NO_FILTER);
  const setD = <K extends keyof CustomerFilter>(k: K, v: CustomerFilter[K]) => setDraft((f) => ({ ...f, [k]: v }));
  const { data: PROVINCES } = useProvinces();
  const { rows: CUSTOMERS, total, loading, refetch } = useCustomersPage({
    page: table.page,
    pageSize: table.pageSize,
    sort: table.sort?.key,
    dir: table.sort?.dir,
    ...filter,
  });

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [viewOnly, setViewOnly] = React.useState(false);
  const [form, setForm] = React.useState<CustomerFormValues>(EMPTY_CUSTOMER);
  const [saving, setSaving] = React.useState(false);
  const [conflicts, setConflicts] = React.useState<CustomerConflict[] | null>(null);

  const openForm = (c: Customer | null, readOnly = false) => {
    setViewOnly(readOnly);
    setEditing(c);
    setConflicts(null);
    setForm(c ? toCustomerForm(c) : EMPTY_CUSTOMER);
    setOpen(true);
  };

  // deep links: /customers?edit=C43601 (from job / quotation / SO forms) · /customers?new=1&phone=…&name=…
  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const edit = sp.get("edit")?.trim();
    if (edit) {
      api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: edit })}`)
        .then((d) => { const hit = d.rows.find((c) => c.code === edit) ?? d.rows[0]; if (hit) openForm(hit, !canEdit); })
        .catch(() => {});
    } else if (sp.get("new") && canAdd) {
      openForm(null);
      setForm((f) => ({ ...f, phone: sp.get("phone") ?? "", name: sp.get("name") ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setConflicts(null);
    try {
      const d = await postJson<{ row: Customer }>("/api/customers", { ...form, code: editing?.code || undefined });
      setOpen(false);
      push({ kind: "success", title: "บันทึกข้อมูลลูกค้าแล้ว", desc: `${d.row.code} · ${d.row.name}` });
      refetch();
    } catch (e) {
      // 409 = phone / email / tax id already belongs to another customer (server refuses)
      const details = e instanceof ApiError ? (e.details as { conflicts?: CustomerConflict[] } | undefined) : undefined;
      if (details?.conflicts?.length) setConflicts(details.conflicts);
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
          onView={() => openForm(r, true)}
          onEdit={canEdit ? () => openForm(r) : undefined}
          onHistory={() => router.push(`/jobs/list?customer=${encodeURIComponent(r.code)}`)}
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
            <Button variant="outline" size="sm" onClick={() => exportXlsx("customers", { ...filter })}>
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

      <FilterBar
        onSearch={() => {
          setFilter(draft);
          push({ kind: "info", title: "กรองข้อมูลตามเงื่อนไขแล้ว" });
        }}
        onReset={() => {
          setDraft(NO_FILTER);
          setFilter(NO_FILTER);
        }}
      >
        <Field label="รหัสลูกค้า">
          <Input placeholder="C43600" className="num" value={draft.code} onChange={(e) => setD("code", e.target.value)} />
        </Field>
        <Field label="ชื่อ-สกุล">
          <Input placeholder="พิมพ์บางส่วนของชื่อ" value={draft.name} onChange={(e) => setD("name", e.target.value)} />
        </Field>
        <Field label="เบอร์โทรศัพท์">
          <Input placeholder="08xxxxxxxx" className="num" inputMode="tel" value={draft.phone} onChange={(e) => setD("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input placeholder="name@example.com" value={draft.email} onChange={(e) => setD("email", e.target.value)} />
        </Field>
        <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี">
          <Input className="num" value={draft.taxId} onChange={(e) => setD("taxId", e.target.value)} />
        </Field>
        <Field label="ประเภทลูกค้า">
          <Select value={draft.type} onChange={(e) => setD("type", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="จังหวัด">
          <Select value={draft.province} onChange={(e) => setD("province", e.target.value)}>
            <option value="">ทั้งหมด</option>
            {PROVINCES.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="สถานะ">
          <Select value={draft.status} onChange={(e) => setD("status", e.target.value as CustomerFilter["status"])}>
            <option value="">ทั้งหมด</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={CUSTOMERS}
        loading={loading}
        rowKey={(r) => r.code}
        server={{ total, onChange: setTable }}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={viewOnly ? "ข้อมูลลูกค้า" : editing ? "แก้ไขข้อมูลลูกค้า" : "เพิ่มลูกค้าใหม่"}
        description={
          viewOnly
            ? `Mode: View · Customer Id #${editing?.code}`
            : editing
              ? `Mode: Edit Data · Customer Id #${editing.code}`
              : "Mode: Add New · รหัสลูกค้าจะถูกสร้างอัตโนมัติ"
        }
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {viewOnly ? "ปิด" : "ยกเลิก"}
            </Button>
            {!viewOnly && (
              <Button size="sm" onClick={save} disabled={saving}>
                บันทึกข้อมูล
              </Button>
            )}
          </>
        }
      >
        <fieldset disabled={viewOnly} className="contents">
        <CustomerFields
          form={form}
          setForm={setForm}
          editing={editing}
          extra={
            viewOnly && editing ? (
              <>
                <Field label="วันที่สร้าง">
                  <Input readOnly value={editing.createdDate || "—"} className="num" />
                </Field>
                <Field label="สร้างโดย">
                  <Input readOnly value={editing.createdBy || "—"} />
                </Field>
              </>
            ) : null
          }
        />
        {conflicts && <div className="mt-4"><ConflictNotice conflicts={conflicts} onPick={(code) => { const hit = CUSTOMERS.find((c) => c.code === code); if (hit) openForm(hit); }} /></div>}
        </fieldset>
      </Modal>
    </>
  );
}
