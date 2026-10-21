'use client';

import * as React from 'react';
import { Plus, Truck, Upload, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { RowActions } from '@/components/shared/row-actions';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Checkbox } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { postJson, del, errMsg, isStale, uploadFile, useUploading } from '@/lib/api';
import { useApi } from '@/data/db';
import { useClearOnChange, useFormErrors } from '@/lib/use-form-errors';
import { shippingProfileSchema } from '@/lib/validation/admin';

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
type FormValues = Omit<Profile, 'id' | 'logoPath' | 'logoUrl'> & { id?: number };
const EMPTY: FormValues = { code: '', nameTh: '', nameEn: '', trackUrl: '', isActive: true, sortOrder: 0 };

export default function ShippingProfilesPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [form, setForm] = React.useState<FormValues>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploading = useUploading(); // the logo is still going up — no second one meanwhile
  const [pendingLogo, setPendingLogo] = React.useState<File | null>(null);
  const pendingUrl = React.useMemo(() => (pendingLogo ? URL.createObjectURL(pendingLogo) : ''), [pendingLogo]);
  React.useEffect(
    () => () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    },
    [pendingUrl],
  );

  // the list: read through swr (one request, cached); after a save `load()` re-reads it
  const { data, loading, mutate } = useApi<{ rows: Profile[] }>('/api/admin/shipping-profiles', {
    fresh: true,
    onError: (msg) => push({ kind: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', desc: msg }),
  });
  const rows = data?.rows ?? [];
  const load = () => mutate();

  const fe = useFormErrors(); // errors under code / name (the API checks the same schema)
  useClearOnChange(fe.clear, form);
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setForm((f) => ({ ...f, [k]: v }));
  const openForm = (p: Profile | null) => {
    setEditing(p);
    setForm(p ? { ...p } : EMPTY);
    fe.setErrors({});
    setPendingLogo(null);
    setOpen(true);
  };

  const save = async () => {
    if (fe.report(fe.run(shippingProfileSchema, form))) return;
    setSaving(true);
    try {
      // `expect`: the profile as the form loaded it — another admin's save since → 409 stale, not overwritten
      const d = await postJson<{ row: Profile }>('/api/admin/shipping-profiles', {
        ...form,
        id: editing?.id,
        expect: editing,
      });
      if (pendingLogo) {
        try {
          await uploadFile('shipper-logo', String(d.row.id), pendingLogo);
          setPendingLogo(null);
        } catch (e) {
          push({ kind: 'error', title: 'บันทึกแล้ว แต่อัปโหลดโลโก้ไม่สำเร็จ', desc: errMsg(e) });
        }
      }
      push({ kind: 'success', title: 'บันทึกแล้ว', desc: `${d.row.code} · ${d.row.nameTh}` });
      await load();
      setOpen(false);
    } catch (e) {
      if (isStale(e) && editing) {
        // another admin saved this profile since the form loaded it: show it as stored now, the toast says why
        const fresh = (await load())?.rows.find((r) => r.id === editing.id);
        if (fresh) openForm(fresh);
      }
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!editing) {
      setPendingLogo(file);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      await uploadFile('shipper-logo', String(editing.id), file);
      push({ kind: 'success', title: 'อัปโหลดโลโก้แล้ว' });
      const fresh = (await load())?.rows.find((r) => r.id === editing.id);
      // only the logo: the rest of `editing` is what this open form loaded — the save's stale check compares
      // against it, so taking the whole fresh row would let this form overwrite another admin's change unseen
      if (fresh) setEditing((e) => (e ? { ...e, logoPath: fresh.logoPath, logoUrl: fresh.logoUrl } : e));
    } catch (e) {
      push({ kind: 'error', title: 'อัปโหลดไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (r: Profile) => {
    const ok = await confirm({
      tone: 'danger',
      title: `ลบ ${r.code} — ${r.nameTh}?`,
      description: 'จะหายจากตัวเลือกในหน้าปิดงาน · งานที่ส่งด้วยเจ้านี้ไปแล้วยังแสดงโลโก้และลิงก์ติดตามได้เหมือนเดิม',
      confirmLabel: 'ลบ',
    });
    if (!ok) return;
    try {
      await del(`/api/admin/shipping-profiles?id=${r.id}`);
      push({ kind: 'success', title: 'ลบแล้ว', desc: r.code });
      void load();
    } catch (e) {
      push({ kind: 'error', title: 'ลบไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const columns: Column<Profile>[] = [
    {
      key: 'sortOrder',
      header: '#',
      width: '60px',
      align: 'center',
      cell: (r) => <span className="num">{r.sortOrder}</span>,
    },
    {
      key: 'code',
      header: 'บริษัทขนส่ง',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-12 place-items-center overflow-hidden rounded bg-white ring-1 ring-border">
            {r.logoUrl ? (
              <img
                src={r.logoUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-6 max-w-[44px] object-contain"
              />
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
      key: 'trackUrl',
      header: 'ลิงก์ติดตาม',
      hideBelow: 'md',
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
      key: 'isActive',
      header: 'สถานะ',
      width: '110px',
      cell: (r) => (
        <Badge tone={r.isActive ? 'success' : 'neutral'} dot>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '90px',
      align: 'center',
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
        title={editing ? 'แก้ไขบริษัทขนส่ง' : 'เพิ่มบริษัทขนส่ง'}
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
          <Field label="รหัส" required hint="ตัวย่อ เช่น FLASH, JNT" error={fe.errors.code}>
            <Input
              maxLength={20}
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              className="num"
            />
          </Field>
          <Field label="ลำดับแสดง" error={fe.errors.sortOrder}>
            <Input
              type="number"
              min={0}
              max={999}
              step={1}
              value={String(form.sortOrder)}
              onChange={(e) => set('sortOrder', Number(e.target.value) || 0)}
              className="num"
            />
          </Field>
          <Field label="ชื่อ (ไทย)" required error={fe.errors.nameTh}>
            <Input maxLength={200} value={form.nameTh} onChange={(e) => set('nameTh', e.target.value)} />
          </Field>
          <Field label="ชื่อ (อังกฤษ)" error={fe.errors.nameEn}>
            <Input maxLength={200} value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
          </Field>

          <Field
            label="ลิงก์ติดตามของขนส่ง"
            wide
            error={fe.errors.trackUrl}
            hint="ใส่ {no} ตรงตำแหน่งเลขพัสดุ เช่น https://www.flashexpress.com/fle/tracking?se={no} — เว้นว่างได้ ลูกค้าจะเห็นแค่เลขพัสดุ"
          >
            <Input
              maxLength={300}
              value={form.trackUrl}
              onChange={(e) => set('trackUrl', e.target.value)}
              placeholder="https://…/track?no={no}"
            />
          </Field>

          <Field label="ตัวเลือก" wide group="group">
            <label className="flex items-center gap-2 pt-1 text-sm">
              <Checkbox checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> เปิดใช้งาน
              (แสดงในตัวเลือกหน้าปิดงาน)
            </label>
          </Field>

          <Field
            label="โลโก้"
            wide
            group="group"
            hint={
              editing
                ? 'PNG/JPG พื้นขาวหรือโปร่งใส แนะนำสูงอย่างน้อย 120px'
                : pendingLogo
                  ? `จะอัปโหลด ${pendingLogo.name} เมื่อกดบันทึก`
                  : 'เลือกไฟล์ได้เลย ระบบจะอัปโหลดให้เมื่อกดบันทึก'
            }
          >
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-28 place-items-center rounded-md border border-border bg-white">
                {editing?.logoUrl || pendingUrl ? (
                  <img src={pendingUrl || editing?.logoUrl} alt="" className="max-h-10 max-w-[100px] object-contain" />
                ) : (
                  <Truck className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onLogo(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {editing ? 'อัปโหลดโลโก้' : pendingLogo ? 'เปลี่ยนไฟล์' : 'เลือกโลโก้'}
              </Button>
            </div>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
