"use client";

import * as React from "react";
import { Plus, Building2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { RowActions } from "@/components/shared/row-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { api, postJson, del, errMsg, uploadFile } from "@/lib/api";

type Profile = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  taxId: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNo: string;
  bankAccountName: string;
  logoPath: string;
  logoUrl: string;
  prefixJob: string;
  prefixQuotation: string;
  prefixSaleOrder: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

type FormValues = Omit<Profile, "id" | "logoPath" | "logoUrl"> & { id?: number };
const EMPTY: FormValues = {
  code: "",
  nameTh: "",
  nameEn: "",
  addressLine1: "",
  addressLine2: "",
  phone: "",
  email: "",
  taxId: "",
  bankName: "",
  bankAccountType: "บัญชีออมทรัพย์",
  bankAccountNo: "",
  bankAccountName: "",
  prefixJob: "",
  prefixQuotation: "",
  prefixSaleOrder: "",
  isDefault: false,
  isActive: true,
  sortOrder: 0,
};

/**
 * โปรไฟล์ผู้ออกเอกสาร ("ออกเอกสารในนาม") — company/brand printed on quotations,
 * shipping labels, intake slips and return notes, each with its own document-number
 * prefixes. System Admin only (route is under /admin).
 */
export default function DocumentProfilesPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = React.useState<Profile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [form, setForm] = React.useState<FormValues>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ rows: Profile[] }>("/api/admin/document-profiles");
      setRows(d.rows);
    } catch (e) {
      push({ kind: "error", title: "โหลดข้อมูลไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setLoading(false);
    }
  }, [push]);
  React.useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setForm((f) => ({ ...f, [k]: v }));
  const openForm = (p: Profile | null) => {
    setEditing(p);
    setForm(p ? { ...p } : EMPTY);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const d = await postJson<{ row: Profile }>("/api/admin/document-profiles", { ...form, id: editing?.id });
      push({ kind: "success", title: "บันทึกโปรไฟล์แล้ว", desc: `${d.row.code} · ${d.row.nameTh}` });
      setEditing(d.row);
      setForm({ ...d.row });
      await load();
      if (!editing) return; // stay open so the logo can be uploaded right away
      setOpen(false);
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file || !editing) return;
    try {
      await uploadFile("profile-logo", String(editing.id), file);
      push({ kind: "success", title: "อัปโหลดโลโก้แล้ว" });
      await load();
      const fresh = (await api<{ rows: Profile[] }>("/api/admin/document-profiles")).rows.find((r) => r.id === editing.id);
      if (fresh) setEditing(fresh);
    } catch (e) {
      push({ kind: "error", title: "อัปโหลดไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (r: Profile) => {
    const ok = await confirm({
      tone: "danger",
      title: `ลบโปรไฟล์ ${r.code} — ${r.nameTh}?`,
      description: (
        <>
          จะหายจากหน้านี้และจากช่อง "ออกเอกสารในนาม" ทุกฟอร์ม เอกสารที่เคยออกในนามนี้ยังพิมพ์ด้วยโลโก้/ที่อยู่เดิมได้ และ prefix เลขเอกสารของโปรไฟล์นี้จะถูกจองไว้ นำกลับมาใช้กับโปรไฟล์อื่นไม่ได้
          <br />
          การกู้คืนต้องทำโดยผู้ดูแลระบบ — ถ้าแค่หยุดใช้ชั่วคราว ให้แก้ไขแล้วปิด "เปิดใช้งาน" แทน
        </>
      ),
      confirmLabel: "ลบโปรไฟล์",
    });
    if (!ok) return;
    try {
      await del(`/api/admin/document-profiles?id=${r.id}`);
      push({ kind: "success", title: "ลบโปรไฟล์แล้ว", desc: `${r.code} · ${r.nameTh}` });
      void load();
    } catch (e) {
      push({ kind: "error", title: "ลบไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const columns: Column<Profile>[] = [
    {
      key: "code",
      header: "รหัส",
      width: "160px",
      cell: (r) => (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.logoUrl} alt="" loading="lazy" decoding="async" className="h-6 w-auto max-w-[72px] rounded bg-white object-contain ring-1 ring-border" />
          <span className="font-medium">{r.code}</span>
        </div>
      ),
    },
    {
      key: "nameTh",
      header: "บริษัท",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.nameTh}</p>
          <p className="truncate text-2xs text-muted-foreground">{[r.addressLine1, r.addressLine2].filter(Boolean).join(" ") || "—"}</p>
        </div>
      ),
    },
    {
      key: "prefixes",
      header: "เลขที่เอกสาร",
      width: "200px",
      sortable: false,
      cell: (r) => (
        <span className="num text-xs">
          งาน {r.prefixJob}· ใบเสนอราคา {r.prefixQuotation}· ใบสั่งขาย {r.prefixSaleOrder}
        </span>
      ),
    },
    { key: "taxId", header: "เลขผู้เสียภาษี", width: "150px", hideBelow: "lg", cell: (r) => <span className="num">{r.taxId || "—"}</span> },
    {
      key: "isActive",
      header: "สถานะ",
      width: "150px",
      cell: (r) => (
        <div className="flex gap-1">
          <Badge tone={r.isActive ? "success" : "neutral"} dot>{r.isActive ? "Active" : "Inactive"}</Badge>
          {r.isDefault && <Badge tone="primary">ค่าเริ่มต้น</Badge>}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "90px",
      align: "center",
      sortable: false,
      // SHD (id 1) is the built-in fallback — edit only
      cell: (r) => <RowActions onEdit={() => openForm(r)} onDelete={r.id === 1 ? undefined : () => remove(r)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="โปรไฟล์ผู้ออกเอกสาร"
        description="บริษัท / แบรนด์ที่ใช้ออกเอกสาร (ใบเสนอราคา ใบสั่งขาย ใบรับงาน ใบส่งคืน) — โลโก้ ที่อยู่ เลขภาษี บัญชี และชุดเลขที่เอกสาร"
        actions={
          <Button size="sm" onClick={() => openForm(null)}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มโปรไฟล์
          </Button>
        }
      />

      <DataTable columns={columns} rows={rows} loading={loading} rowKey={(r) => String(r.id)} searchPlaceholder="ค้นหารหัส / ชื่อบริษัท…" />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `แก้ไขโปรไฟล์ ${editing.code}` : "เพิ่มโปรไฟล์ผู้ออกเอกสาร"}
        description={editing ? `Mode: Edit · #${editing.id}` : "บันทึกก่อน แล้วค่อยอัปโหลดโลโก้"}
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>ปิด</Button>
            <Button size="sm" onClick={save} disabled={saving}>บันทึกข้อมูล</Button>
          </>
        }
      >
        <FieldGrid>
          <Field label="รหัสโปรไฟล์" required hint="สั้น ๆ เช่น SHD, HASHTAG">
            <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="SHD" />
          </Field>
          <Field label="ชื่อบริษัท (ไทย)" required>
            <Input value={form.nameTh} onChange={(e) => set("nameTh", e.target.value)} />
          </Field>
          <Field label="ชื่อบริษัท (อังกฤษ)">
            <Input value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
          </Field>
          <Field label="ที่อยู่ บรรทัด 1" wide>
            <Input value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
          </Field>
          <Field label="ที่อยู่ บรรทัด 2" wide>
            <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
          </Field>
          <Field label="โทรศัพท์">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="num" />
          </Field>
          <Field label="อีเมล">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} className="num" placeholder="13 หลัก" />
          </Field>

          <Field label="ธนาคาร" hint="พิมพ์บนใบเสนอราคา">
            <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="ธ.ไทยพาณิชย์ จำกัด (มหาชน)" />
          </Field>
          <Field label="ประเภทบัญชี">
            <Input value={form.bankAccountType} onChange={(e) => set("bankAccountType", e.target.value)} />
          </Field>
          <Field label="เลขที่บัญชี">
            <Input value={form.bankAccountNo} onChange={(e) => set("bankAccountNo", e.target.value)} className="num" />
          </Field>
          <Field label="ชื่อบัญชี">
            <Input value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} />
          </Field>

          <Field label="Prefix เลขงานซ่อม" required hint={editing ? "เปลี่ยนไม่ได้เมื่อออกเลขแล้ว" : "A–Z 1–6 ตัว ห้ามซ้ำกับโปรไฟล์อื่น"}>
            <Input value={form.prefixJob} onChange={(e) => set("prefixJob", e.target.value.toUpperCase())} placeholder="J" className="num" />
          </Field>
          <Field label="Prefix ใบเสนอราคา" required>
            <Input value={form.prefixQuotation} onChange={(e) => set("prefixQuotation", e.target.value.toUpperCase())} placeholder="Q" className="num" />
          </Field>
          <Field label="Prefix ใบสั่งขาย" required>
            <Input value={form.prefixSaleOrder} onChange={(e) => set("prefixSaleOrder", e.target.value.toUpperCase())} placeholder="SO" className="num" />
          </Field>
          <Field label="ลำดับแสดง">
            <Input type="number" value={String(form.sortOrder)} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} className="num" />
          </Field>

          <Field label="ตัวเลือก" wide>
            <div className="flex flex-wrap gap-6 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} /> ค่าเริ่มต้น (ใช้เมื่อไม่ได้เลือก)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> เปิดใช้งาน
              </label>
            </div>
          </Field>

          <Field label="โลโก้" wide hint={editing ? "PNG/JPG พื้นขาว แนะนำสูงอย่างน้อย 300px — ถ้าไม่อัปโหลดจะใช้สัญลักษณ์ SHD" : "บันทึกโปรไฟล์ก่อนจึงจะอัปโหลดโลโก้ได้"}>
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-40 place-items-center rounded-md border border-border bg-white">
                {editing ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={editing.logoUrl} alt="" className="max-h-12 max-w-[150px] object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
              <Button variant="outline" size="sm" type="button" disabled={!editing} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                อัปโหลดโลโก้
              </Button>
            </div>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
