"use client";

import * as React from "react";
import { Plus, Truck, Upload, ExternalLink } from "lucide-react";
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

/** โปรไฟล์บริษัทขนส่ง — logo + tracking URL shown to customers on /track */
type Profile = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  logoPath: string;
  logoUrl: string;
  trackUrl: string;
  isActive: boolean;
  sortOrder: number;
};
type FormValues = Omit<Profile, "id" | "logoPath" | "logoUrl"> & { id?: number };
const EMPTY: FormValues = { code: "", nameTh: "", nameEn: "", trackUrl: "", isActive: true, sortOrder: 0 };

export default function ShippingProfilesPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = React.useState<Profile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [form, setForm] = React.useState<FormValues>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [pendingLogo, setPendingLogo] = React.useState<File | null>(null);
  const pendingUrl = React.useMemo(() => (pendingLogo ? URL.createObjectURL(pendingLogo) : ""), [pendingLogo]);
  React.useEffect(() => () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl); }, [pendingUrl]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ rows: Profile[] }>("/api/admin/shipping-profiles");
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
    setPendingLogo(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const d = await postJson<{ row: Profile }>("/api/admin/shipping-profiles", { ...form, id: editing?.id });
      if (pendingLogo) {
        try {
          await uploadFile("shipper-logo", String(d.row.id), pendingLogo);
          setPendingLogo(null);
        } catch (e) {
          push({ kind: "error", title: "บันทึกแล้ว แต่อัปโหลดโลโก้ไม่สำเร็จ", desc: errMsg(e) });
        }
      }
      push({ kind: "success", title: "บันทึกแล้ว", desc: `${d.row.code} · ${d.row.nameTh}` });
      await load();
      setOpen(false);
    } catch (e) {
      push({ kind: "error", title: "บันทึกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!editing) {
      setPendingLogo(file);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      await uploadFile("shipper-logo", String(editing.id), file);
      push({ kind: "success", title: "อัปโหลดโลโก้แล้ว" });
      await load();
      const fresh = (await api<{ rows: Profile[] }>("/api/admin/shipping-profiles")).rows.find((r) => r.id === editing.id);
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
      title: `ลบ ${r.code} — ${r.nameTh}?`,
      description: "จะหายจากตัวเลือกในหน้าปิดงาน · งานที่ส่งด้วยเจ้านี้ไปแล้วยังแสดงโลโก้และลิงก์ติดตามได้เหมือนเดิม",
      confirmLabel: "ลบ",
    });
    if (!ok) return;
    try {
      await del(`/api/admin/shipping-profiles?id=${r.id}`);
      push({ kind: "success", title: "ลบแล้ว", desc: r.code });
      void load();
    } catch (e) {
      push({ kind: "error", title: "ลบไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const columns: Column<Profile>[] = [
    { key: "sortOrder", header: "#", width: "60px", align: "center", cell: (r) => <span className="num">{r.sortOrder}</span> },
    {
      key: "code",
      header: "บริษัทขนส่ง",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-12 place-items-center overflow-hidden rounded bg-white ring-1 ring-border">
            {r.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.logoUrl} alt="" loading="lazy" decoding="async" className="max-h-6 max-w-[44px] object-contain" />
            ) : (
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span>
            <span className="font-medium">{r.code}</span>
            <span className="block text-xs text-muted-foreground">{r.nameTh}</span>
          </span>
        </div>
      ),
    },
    {
      key: "trackUrl",
      header: "ลิงก์ติดตาม",
      hideBelow: "md",
      cell: (r) =>
        r.trackUrl ? (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3 shrink-0" />
            {r.trackUrl}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">— ไม่มีลิงก์ (แสดงแค่เลขพัสดุ)</span>
        ),
    },
    {
      key: "isActive",
      header: "สถานะ",
      width: "110px",
      cell: (r) => (
        <Badge tone={r.isActive ? "success" : "neutral"} dot>
          {r.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Action",
      width: "90px",
      align: "center",
      sortable: false,
      cell: (r) => <RowActions onEdit={() => openForm(r)} onDelete={() => remove(r)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="โปรไฟล์บริษัทขนส่ง"
        description="บริษัทขนส่งที่ใช้ส่งเครื่องคืนลูกค้า — โลโก้และลิงก์ติดตามที่แสดงในหน้าติดตามสถานะของลูกค้า"
        actions={
          <Button size="sm" onClick={() => openForm(null)}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มบริษัทขนส่ง
          </Button>
        }
      />

      <DataTable searchable={false} columns={columns} rows={rows} loading={loading} rowKey={(r) => String(r.id)} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "แก้ไขบริษัทขนส่ง" : "เพิ่มบริษัทขนส่ง"}
        description="กรอกข้อมูลให้ครบถ้วน ช่องที่มี * จำเป็นต้องระบุ"
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
          <Field label="รหัส" required hint="ตัวย่อ เช่น FLASH, JNT">
            <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} className="num" />
          </Field>
          <Field label="ลำดับแสดง">
            <Input type="number" value={String(form.sortOrder)} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} className="num" />
          </Field>
          <Field label="ชื่อ (ไทย)" required>
            <Input value={form.nameTh} onChange={(e) => set("nameTh", e.target.value)} />
          </Field>
          <Field label="ชื่อ (อังกฤษ)">
            <Input value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
          </Field>

          <Field
            label="ลิงก์ติดตามของขนส่ง"
            wide
            hint="ใส่ {no} ตรงตำแหน่งเลขพัสดุ เช่น https://www.flashexpress.com/fle/tracking?se={no} — เว้นว่างได้ ลูกค้าจะเห็นแค่เลขพัสดุ"
          >
            <Input value={form.trackUrl} onChange={(e) => set("trackUrl", e.target.value)} placeholder="https://…/track?no={no}" />
          </Field>

          <Field label="ตัวเลือก" wide>
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> เปิดใช้งาน (แสดงในตัวเลือกหน้าปิดงาน)
            </label>
          </Field>

          <Field label="โลโก้" wide hint={editing ? "PNG/JPG พื้นขาวหรือโปร่งใส แนะนำสูงอย่างน้อย 120px" : pendingLogo ? `จะอัปโหลด ${pendingLogo.name} เมื่อกดบันทึก` : "เลือกไฟล์ได้เลย ระบบจะอัปโหลดให้เมื่อกดบันทึก"}>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-28 place-items-center rounded-md border border-border bg-white">
                {editing?.logoUrl || pendingUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pendingUrl || editing?.logoUrl} alt="" className="max-h-10 max-w-[100px] object-contain" />
                ) : (
                  <Truck className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
              <Button variant="outline" size="sm" type="button" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                {editing ? "อัปโหลดโลโก้" : pendingLogo ? "เปลี่ยนไฟล์" : "เลือกโลโก้"}
              </Button>
            </div>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
