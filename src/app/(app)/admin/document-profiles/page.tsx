'use client';

import * as React from 'react';
import { Plus, Building2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { RowActions } from '@/components/shared/row-actions';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Checkbox, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { api, postJson, del, errMsg, isStale, uploadFile, useUploading } from '@/lib/api';
import { useApi } from '@/data/db';
import { useClearOnChange, useFormErrors } from '@/lib/use-form-errors';
import { useTourRestore } from '@/components/tour/tour';
import { documentProfileSchema } from '@/lib/validation/admin';

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
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** document = ออกเอกสารในนาม · pick_slip = only the header of ใบเบิกสินค้า (never in the forms' chooser) */
  purpose: 'document' | 'pick_slip';
};

type FormValues = Omit<Profile, 'id' | 'logoPath' | 'logoUrl'> & { id?: number };
const EMPTY: FormValues = {
  code: '',
  nameTh: '',
  nameEn: '',
  addressLine1: '',
  addressLine2: '',
  phone: '',
  email: '',
  taxId: '',
  bankName: '',
  bankAccountType: 'บัญชีออมทรัพย์',
  bankAccountNo: '',
  bankAccountName: '',
  isDefault: false,
  isActive: true,
  sortOrder: 0,
  purpose: 'document',
};

/**
 * โปรไฟล์ผู้ออกเอกสาร ("ออกเอกสารในนาม") — company/brand printed on quotations,
 * shipping labels, intake slips and return notes (letterhead only — document numbers are one
 * series for every profile). System Admin only (route is under /admin).
 */
export default function DocumentProfilesPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [form, setForm] = React.useState<FormValues>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploading = useUploading(); // the logo is still going up — no second one meanwhile
  // logo picked while creating (no id yet) — uploaded right after the first save
  const [pendingLogo, setPendingLogo] = React.useState<File | null>(null);
  const pendingUrl = React.useMemo(() => (pendingLogo ? URL.createObjectURL(pendingLogo) : ''), [pendingLogo]);
  React.useEffect(
    () => () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    },
    [pendingUrl],
  );

  // the list: read through swr (one request, cached); after a save `load()` re-reads it
  const { data, loading, mutate } = useApi<{ rows: Profile[] }>('/api/admin/document-profiles', {
    fresh: true,
    onError: (msg) => push({ kind: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', desc: msg }),
  });
  const rows = data?.rows ?? [];
  const load = () => mutate();

  const fe = useFormErrors(); // errors under code / name (the API checks the same schema)
  useClearOnChange(fe.clear, form);
  useTourRestore(() => form, setForm); // a บทสอน puts back what was tried in the dialog
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setForm((f) => ({ ...f, [k]: v }));
  const openForm = (p: Profile | null) => {
    setEditing(p);
    setForm(p ? { ...p } : EMPTY);
    fe.setErrors({});
    setPendingLogo(null);
    setOpen(true);
  };

  const save = async () => {
    if (fe.report(fe.run(documentProfileSchema, form))) return;
    setSaving(true);
    try {
      // `expect`: the profile as the form loaded it — another admin's save since → 409 stale, not overwritten
      const d = await postJson<{ row: Profile }>('/api/admin/document-profiles', {
        ...form,
        id: editing?.id,
        expect: editing,
      });
      let row = d.row;
      if (pendingLogo) {
        // new profile: the logo chosen before saving goes up now that there is an id
        try {
          await uploadFile('profile-logo', String(row.id), pendingLogo);
          setPendingLogo(null);
          row =
            (await api<{ rows: Profile[] }>('/api/admin/document-profiles')).rows.find((r) => r.id === d.row.id) ?? row;
        } catch (e) {
          push({ kind: 'error', title: 'บันทึกโปรไฟล์แล้ว แต่อัปโหลดโลโก้ไม่สำเร็จ', desc: errMsg(e) });
        }
      }
      push({ kind: 'success', title: 'บันทึกโปรไฟล์แล้ว', desc: `${row.code} · ${row.nameTh}` });
      setEditing(row);
      setForm({ ...row });
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
      // creating: keep the file, show a preview, upload after save
      setPendingLogo(file);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      await uploadFile('profile-logo', String(editing.id), file);
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
      title: `ลบโปรไฟล์ ${r.code} — ${r.nameTh}?`,
      description: (
        <>
          จะหายจากหน้านี้และจากช่อง "ออกเอกสารในนาม" ทุกฟอร์ม
          เอกสารที่เคยออกในนามนี้ยังพิมพ์ด้วยโลโก้/ที่อยู่ของโปรไฟล์นี้ได้ และรหัส {r.code} นำไปใช้กับโปรไฟล์ใหม่ได้
          <br />
          การกู้คืนต้องทำโดยผู้ดูแลระบบ — ถ้าแค่หยุดใช้ชั่วคราว ให้แก้ไขแล้วปิด "เปิดใช้งาน" แทน
        </>
      ),
      confirmLabel: 'ลบโปรไฟล์',
    });
    if (!ok) return;
    try {
      await del(`/api/admin/document-profiles?id=${r.id}`);
      push({ kind: 'success', title: 'ลบโปรไฟล์แล้ว', desc: `${r.code} · ${r.nameTh}` });
      void load();
    } catch (e) {
      push({ kind: 'error', title: 'ลบไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const columns: Column<Profile>[] = [
    {
      key: 'code',
      header: 'รหัส',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <img
            src={r.logoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-6 w-auto max-w-[72px] rounded bg-white object-contain ring-1 ring-border"
          />
          <span className="font-medium">{r.code}</span>
        </div>
      ),
    },
    {
      key: 'nameTh',
      header: 'บริษัท',
      cell: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-1 font-medium">{r.nameTh}</p>
          <p className="line-clamp-1 text-2xs text-muted-foreground">
            {[r.addressLine1, r.addressLine2].filter(Boolean).join(' ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'taxId',
      header: 'เลขผู้เสียภาษี',
      width: '150px',
      hideBelow: 'lg',
      cell: (r) => <span className="num">{r.taxId || '—'}</span>,
    },
    {
      key: 'isActive',
      header: 'สถานะ',
      width: '150px',
      hideBelow: 'sm', // phones: code + company + action (Active / ค่าเริ่มต้น are in the edit dialog)
      cell: (r) => (
        <div className="flex gap-1">
          <Badge tone={r.isActive ? 'success' : 'neutral'} dot>
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
          {r.isDefault && <Badge tone="primary">ค่าเริ่มต้น</Badge>}
          {r.purpose === 'pick_slip' && <Badge tone="info">หัวใบเบิกสินค้า</Badge>}
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '90px',
      align: 'center',
      sortable: false,
      // SHD (id 1) is the built-in fallback — edit only
      cell: (r) => <RowActions onEdit={() => openForm(r)} onDelete={r.id === 1 ? undefined : () => remove(r)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="โปรไฟล์ผู้ออกเอกสาร"
        description="บริษัท / แบรนด์ที่ใช้ออกเอกสาร (ใบเสนอราคา ใบสั่งขาย ใบรับงาน ใบส่งคืน) — โลโก้ ที่อยู่ เลขภาษี บัญชี · เลขที่เอกสารเป็นชุดเดียวทั้งระบบ ไม่ขึ้นกับโปรไฟล์"
        actions={
          <Button size="sm" onClick={() => openForm(null)}>
            <Plus className="h-3.5 w-3.5" />
            เพิ่มโปรไฟล์
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="ค้นหารหัส / ชื่อบริษัท…"
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `แก้ไขโปรไฟล์ ${editing.code}` : 'เพิ่มโปรไฟล์ผู้ออกเอกสาร'}
        description={editing ? undefined : 'โลโก้ที่เลือกไว้อัปโหลดหลังกดบันทึก'}
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ปิด
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid>
          <Field label="รหัสโปรไฟล์" required hint="สั้น ๆ เช่น SHD, HASHTAG" error={fe.errors.code}>
            <Input
              maxLength={20}
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="SHD"
            />
          </Field>
          <Field label="ชื่อบริษัท (ไทย)" required error={fe.errors.nameTh}>
            <Input maxLength={200} value={form.nameTh} onChange={(e) => set('nameTh', e.target.value)} />
          </Field>
          <Field label="ชื่อบริษัท (อังกฤษ)" error={fe.errors.nameEn}>
            <Input maxLength={200} value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
          </Field>
          <Field label="ที่อยู่ บรรทัด 1" wide error={fe.errors.addressLine1}>
            <Input maxLength={200} value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </Field>
          <Field label="ที่อยู่ บรรทัด 2" wide error={fe.errors.addressLine2}>
            <Input maxLength={200} value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} />
          </Field>
          <Field label="โทรศัพท์" error={fe.errors.phone}>
            <Input
              inputMode="tel"
              maxLength={50}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              className="num"
            />
          </Field>
          <Field label="อีเมล" error={fe.errors.email}>
            <Input type="email" maxLength={100} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี" error={fe.errors.taxId}>
            <Input
              inputMode="numeric"
              maxLength={17}
              value={form.taxId}
              onChange={(e) => set('taxId', e.target.value)}
              className="num"
              placeholder="13 หลัก"
            />
          </Field>

          <Field label="ธนาคาร" hint="พิมพ์บนใบเสนอราคา" error={fe.errors.bankName}>
            <Input
              maxLength={100}
              value={form.bankName}
              onChange={(e) => set('bankName', e.target.value)}
              placeholder="ธ.ไทยพาณิชย์ จำกัด (มหาชน)"
            />
          </Field>
          <Field label="ประเภทบัญชี" error={fe.errors.bankAccountType}>
            <Input
              maxLength={50}
              value={form.bankAccountType}
              onChange={(e) => set('bankAccountType', e.target.value)}
            />
          </Field>
          <Field label="เลขที่บัญชี" error={fe.errors.bankAccountNo}>
            <Input
              inputMode="numeric"
              maxLength={20}
              value={form.bankAccountNo}
              onChange={(e) => set('bankAccountNo', e.target.value)}
              className="num"
            />
          </Field>
          <Field label="ชื่อบัญชี" error={fe.errors.bankAccountName}>
            <Input
              maxLength={200}
              value={form.bankAccountName}
              onChange={(e) => set('bankAccountName', e.target.value)}
            />
          </Field>

          <Field
            label="ใช้สำหรับ"
            hint={
              form.purpose === 'pick_slip'
                ? 'พิมพ์เป็นหัวใบเบิกสินค้าเท่านั้น ไม่อยู่ในช่อง "ออกเอกสารในนาม" ของฟอร์ม'
                : 'เลือกได้ในช่อง "ออกเอกสารในนาม" ของงานซ่อม ใบเสนอราคา ใบสั่งขาย'
            }
            error={fe.errors.purpose}
          >
            <Select
              value={form.purpose}
              onChange={(e) => {
                const purpose = e.target.value === 'pick_slip' ? 'pick_slip' : 'document';
                setForm((f) => ({ ...f, purpose, isDefault: purpose === 'pick_slip' ? false : f.isDefault }));
              }}
            >
              <option value="document">ออกเอกสาร (ออกเอกสารในนาม)</option>
              <option value="pick_slip">หัวใบเบิกสินค้า</option>
            </Select>
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

          <Field label="ตัวเลือก" wide group="group">
            <div className="flex flex-wrap gap-6 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.isDefault}
                  disabled={form.purpose === 'pick_slip'}
                  onChange={(e) => set('isDefault', e.target.checked)}
                />{' '}
                ค่าเริ่มต้น (ใช้เมื่อไม่ได้เลือก)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> เปิดใช้งาน
              </label>
            </div>
          </Field>

          <Field
            label="โลโก้"
            wide
            group="group"
            hint={
              editing
                ? 'SVG (คมที่สุด) หรือ PNG/JPG พื้นขาว แนะนำสูงอย่างน้อย 300px — ถ้าไม่อัปโหลดจะใช้สัญลักษณ์ SHD'
                : pendingLogo
                  ? `จะอัปโหลด ${pendingLogo.name} เมื่อกดบันทึก`
                  : 'SVG (คมที่สุด) หรือ PNG/JPG — เลือกไฟล์ได้เลย ระบบจะอัปโหลดให้เมื่อกดบันทึก · ไม่อัปโหลดจะใช้สัญลักษณ์ SHD'
            }
          >
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-40 place-items-center rounded-md border border-border bg-white">
                {editing || pendingUrl ? (
                  <img src={pendingUrl || editing?.logoUrl} alt="" className="max-h-12 max-w-[150px] object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
                className="hidden"
                onChange={(e) => void onLogo(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                data-tour-block // uploads (editing) / picks a file: never during a บทสอน
              >
                <Upload className="h-3.5 w-3.5" />
                {editing ? 'อัปโหลดโลโก้' : pendingLogo ? 'เปลี่ยนไฟล์' : 'เลือกโลโก้'}
              </Button>
              {!editing && pendingLogo && (
                <Button variant="ghost" size="sm" type="button" onClick={() => setPendingLogo(null)}>
                  เอาออก
                </Button>
              )}
            </div>
          </Field>
        </FieldGrid>
      </Modal>
    </>
  );
}
