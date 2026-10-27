'use client';

import * as React from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PeoplePicker, type Person } from '@/components/shared/people-picker';
import { useToast } from '@/components/ui/toast';
import type { User } from '@/data/types';
import { errMsg, isStale, postJson } from '@/lib/api';
import { useFormErrors, useClearOnChange } from '@/lib/use-form-errors';
import { userSchema } from '@/lib/validation/admin';
import { PENDING_ROLE } from '@/lib/access';
import { useTourRestore } from '@/components/tour/tour';

export type UserForm = {
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
  id: '',
  code: '',
  name: '',
  username: '',
  role: '', // nothing pre-picked: the first role is System Admin
  branch: '',
  email: '',
  phone: '',
  status: 'Active',
  avatar: '',
};

export const toForm = (r: User): UserForm => ({
  id: r.id,
  code: r.code ?? '',
  name: r.name ?? '',
  username: r.username ?? '',
  role: r.role ?? '',
  branch: r.branch ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  status: r.status ?? 'Active',
  avatar: r.avatar ?? '',
});

// a 401 refreshes the session and retries once, then goes to /login (api.ts) — a valid write is
// never silently lost to an expiring cookie; field errors come back as ApiError details
export const postUser = (body: Record<string, unknown>) => postJson<{ created?: boolean }>('/api/admin/users', body);

/** the add / edit dialog's state: open it with openAdd / openEdit, render it with <UserDialog {...dialog} /> */
export function useUserDialog(refetch: () => void) {
  const { push } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<UserForm>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  const fe = useFormErrors();
  useClearOnChange(fe.clear, form);
  useTourRestore(() => form, setForm); // a บทสอน puts back what was tried in the dialog
  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // the user being edited as loaded: an unchanged legacy username / phone still saves; name / email / role /
  // status go along as `expect` — another admin's change since → 409 stale instead of being undone
  const [prev, setPrev] = React.useState<Pick<
    User,
    'username' | 'phone' | 'role' | 'name' | 'email' | 'status'
  > | null>(null);
  const openAdd = () => {
    setPrev(null);
    setForm(EMPTY);
    fe.setErrors({});
    setEditing(false);
    setOpen(true);
  };

  const openEdit = (r: User) => {
    setPrev({ username: r.username, phone: r.phone, role: r.role, name: r.name, email: r.email, status: r.status });
    setForm(toForm(r));
    fe.setErrors({});
    setEditing(true);
    setOpen(true);
  };

  // เลือกพนักงานจาก Lark directory → เติมข้อมูลอัตโนมัติ
  const pickPerson = (p: Person | null) => {
    if (!p) return;
    setForm((f) => ({
      ...f,
      name: p.name || f.name,
      email: (p.email || f.email).toLowerCase(),
      username: p.email ? (p.email.split('@')[0] ?? p.email) : f.username,
      code: p.id || f.code,
      branch: p.department || f.branch,
      avatar: p.avatar || f.avatar,
    }));
  };

  const save = async () => {
    if (fe.report(fe.run(userSchema(prev), form))) return; // the API checks the same
    setSaving(true);
    try {
      const data = await postUser({
        ...form,
        expect: prev && { name: prev.name, email: prev.email, role: prev.role, status: prev.status },
      });
      push({
        kind: 'success',
        title: data.created ? 'เพิ่มผู้ใช้งานแล้ว' : 'บันทึกการแก้ไขแล้ว',
        desc: `${form.name} · ${form.role}`,
      });
      setOpen(false);
      refetch();
    } catch (e) {
      if (isStale(e)) refetch();
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return {
    openAdd,
    openEdit,
    dialog: {
      open,
      onClose: () => setOpen(false),
      editing,
      form,
      set,
      errors: fe.errors,
      prev,
      saving,
      save,
      pickPerson,
    },
  };
}

type UserDialogProps = ReturnType<typeof useUserDialog>['dialog'] & {
  roleOptions: string[];
  isMe: (r: { id: string }) => boolean;
};

export function UserDialog({
  open,
  onClose,
  editing,
  form,
  set,
  errors,
  prev,
  saving,
  save,
  pickPerson,
  roleOptions,
  isMe,
}: UserDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'แก้ไขผู้ใช้ระบบ' : 'เพิ่มผู้ใช้ระบบ'}
      size="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? 'บันทึกข้อมูล' : 'เพิ่มผู้ใช้งาน'}
          </Button>
        </>
      }
    >
      {!editing && <LarkDirectoryPicker onPick={pickPerson} />}

      {(form.avatar || form.name) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          {form.avatar ? (
            <img src={form.avatar} alt={form.name} className="h-12 w-12 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
              {form.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{form.name || '—'}</p>
            <p className="truncate text-2xs text-muted-foreground">{form.email || 'ยังไม่ได้เลือกพนักงาน'}</p>
          </div>
        </div>
      )}

      <FieldGrid cols={2}>
        <Field label="ชื่อ-สกุล" required error={errors.name}>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        {/* your own email / username: sign-in finds the account by email — changing it locks you out */}
        <Field
          label="อีเมล"
          error={errors.email}
          hint={isMe(form) ? 'เปลี่ยนอีเมลของตัวเองไม่ได้ (ใช้เข้าสู่ระบบ)' : undefined}
        >
          <Input
            type="email"
            maxLength={100}
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            disabled={isMe(form)}
          />
        </Field>
        <Field
          label="Username"
          error={errors.username}
          hint={isMe(form) ? 'เปลี่ยน Username ของตัวเองไม่ได้' : undefined}
        >
          <Input
            maxLength={50}
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            disabled={isMe(form)}
          />
        </Field>
        <Field label="รหัสพนักงาน / Lark ID" error={errors.code}>
          <Input maxLength={50} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="—" />
        </Field>
        <Field
          label="ประเภทผู้ใช้งาน / สิทธิ์"
          required
          error={errors.role}
          hint={isMe(form) ? 'เปลี่ยนบทบาทของตัวเองไม่ได้' : 'กำหนดบทบาทเพื่อคุมสิทธิ์เมนูที่เข้าถึงได้'}
        >
          <SearchSelect
            placeholder="- - เลือกบทบาท - -"
            value={form.role}
            onChange={(v) => set('role', v)}
            // "รออนุมัติ" is not a role to give (อนุมัติ picks one; the API refuses it) — only a pending user keeps it
            options={strOptions(roleOptions.filter((x) => x !== PENDING_ROLE || prev?.role === PENDING_ROLE))}
            disabled={isMe(form)}
          />
        </Field>
        <Field label="สาขา / หน่วยงาน" error={errors.branch}>
          <Input maxLength={100} value={form.branch} onChange={(e) => set('branch', e.target.value)} />
        </Field>
        <Field label="เบอร์โทรศัพท์" error={errors.phone}>
          <Input
            inputMode="tel"
            maxLength={15}
            placeholder="0812345678"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label="สถานะ" hint={isMe(form) ? 'เปลี่ยนสถานะของตัวเองไม่ได้' : undefined}>
          <Select value={form.status} onChange={(e) => set('status', e.target.value)} disabled={isMe(form)}>
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
  );
}

/** pick an SHD employee from the Lark directory — fills name, email and department */
function LarkDirectoryPicker({ onPick }: { onPick: (p: Person | null) => void }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
      <Field
        label="ค้นหาพนักงานจากไดเรกทอรี Lark"
        hint="เลือกจากรายชื่อจริง แล้วระบบจะเติมชื่อ อีเมล และหน่วยงานให้อัตโนมัติ"
      >
        <PeoplePicker value={null} onChange={onPick} placeholder="พิมพ์ชื่อพนักงาน SHD เพื่อค้นหา…" />
      </Field>
    </div>
  );
}
