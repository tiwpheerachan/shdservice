'use client';

import * as React from 'react';
import { Plus, ShieldCheck, Mail, Phone, Loader2, Clock, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { RowActions } from '@/components/shared/row-actions';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { PeoplePicker, type Person } from '@/components/shared/people-picker';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ROLES, type User } from '@/data/mock';
import { useUsers, useRoles } from '@/data/db';
import { errMsg, exportXlsx, postJson } from '@/lib/api';
import { useFormErrors, useClearOnChange } from '@/lib/use-form-errors';
import { userSchema } from '@/lib/validation/admin';
import { isFilterActive } from '@/lib/utils';
import { ExportButton } from '@/components/shared/export-button';
import { useAccess } from '@/lib/use-access';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import { PENDING_ROLE } from '@/lib/access';

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

export default function UsersPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  // your own row: no revoke / delete / role or status change (the API refuses them with a 409)
  const { userId: myId } = useAccess();
  const isMe = (r: { id: string }) => r.id === String(myId);
  const [view, setView] = React.useState<'active' | 'deleted'>('active');
  const { data: USERS, loading, refetch } = useUsers(view === 'deleted' ? 'only' : 'exclude');
  // roles = user_type values from app_config (DB), "รออนุมัติ" = no role yet
  const { data: dbRoles } = useRoles();
  // System Admin last: the dropdown keyboard-highlights the first row, and Enter there granted full admin
  const ROLE_OPTIONS = React.useMemo(
    () =>
      dbRoles.length
        ? [
            ...dbRoles.filter((x) => x !== ADMIN_USER_TYPE),
            ...dbRoles.filter((x) => x === ADMIN_USER_TYPE),
            'รออนุมัติ',
          ]
        : ROLES,
    [dbRoles],
  );
  const pendingCount = USERS.filter((u) => u.role === 'รออนุมัติ').length;

  // filter bar — applied on ค้นหา, evaluated in the browser (the whole list is loaded)
  type UserFilter = { name: string; username: string; role: string; status: '' | 'Active' | 'Inactive' };
  const NO_FILTER: UserFilter = { name: '', username: '', role: '', status: '' };
  const [draft, setDraft] = React.useState<UserFilter>(NO_FILTER);
  const [filter, setFilter] = React.useState<UserFilter>(NO_FILTER);
  const VISIBLE = React.useMemo(() => {
    const has = (v: string | null | undefined, t: string) =>
      !t.trim() || (v ?? '').toLowerCase().includes(t.trim().toLowerCase());
    return USERS.filter(
      (u) =>
        has(u.name, filter.name) &&
        has(u.username, filter.username) &&
        (!filter.role || u.role === filter.role) &&
        (!filter.status || u.status === filter.status),
    );
  }, [USERS, filter]);
  // auto-refresh so users who just signed in (pending) show up without a reload
  React.useEffect(() => {
    if (view !== 'active') return;
    const id = setInterval(() => refetch(), 25000);
    return () => clearInterval(id);
  }, [refetch, view]);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<UserForm>(EMPTY);
  const [saving, setSaving] = React.useState(false);

  const fe = useFormErrors();
  useClearOnChange(fe.clear, form);
  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // the stored username / phone of the user being edited: an unchanged legacy value still saves
  const [prev, setPrev] = React.useState<{ username?: string; phone?: string; role?: string } | null>(null);
  const openAdd = () => {
    setPrev(null);
    setForm(EMPTY);
    fe.setErrors({});
    setEditing(false);
    setOpen(true);
  };

  const toForm = (r: User): UserForm => ({
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

  const openEdit = (r: User) => {
    setPrev({ username: r.username, phone: r.phone, role: r.role });
    setForm(toForm(r));
    fe.setErrors({});
    setEditing(true);
    setOpen(true);
  };

  // อนุมัติ asks for the role first, nothing pre-picked: a silent default role handed people
  // menus they should not have
  const [approving, setApproving] = React.useState<User | null>(null);
  const [approveRole, setApproveRole] = React.useState('');
  const approveNow = (r: User) => {
    setApproveRole('');
    setApproving(r);
  };
  const confirmApprove = async () => {
    if (!approving || !approveRole) return;
    if (await quickSet(approving, { role: approveRole, status: 'Active' }, 'อนุมัติแล้ว')) setApproving(null);
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

  // a 401 refreshes the session and retries once, then goes to /login (api.ts) — a valid write is
  // never silently lost to an expiring cookie; field errors come back as ApiError details
  const postUser = (body: Record<string, unknown>) => postJson<{ created?: boolean }>('/api/admin/users', body);

  const save = async () => {
    if (fe.report(fe.run(userSchema(prev), form))) return; // the API checks the same
    setSaving(true);
    try {
      const data = await postUser(form);
      push({
        kind: 'success',
        title: data.created ? 'เพิ่มผู้ใช้งานแล้ว' : 'บันทึกการแก้ไขแล้ว',
        desc: `${form.name} · ${form.role}`,
      });
      setOpen(false);
      refetch();
    } catch (e) {
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // Quick inline actions (revoke / restore) — write straight to the DB and refetch.
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const quickSet = async (r: User, patch: Partial<UserForm>, okTitle: string) => {
    setBusyId(r.id);
    try {
      await postUser({ ...toForm(r), ...patch });
      push({ kind: 'success', title: okTitle, desc: r.name });
      refetch();
      return true;
    } catch (e) {
      push({
        kind: 'error',
        title: 'ทำรายการไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // ถอนสิทธิ์ / คืนสิทธิ์ — one click used to act at once; ask first, naming the person
  const setActive = async (r: User, active: boolean) => {
    const ok = await confirm({
      tone: active ? 'default' : 'danger',
      title: active ? `คืนสิทธิ์ ${r.name}?` : `ถอนสิทธิ์ ${r.name}?`,
      description: active
        ? `${r.name} (${r.role}) จะกลับมาเข้าระบบได้ตามสิทธิ์ของบทบาทนี้`
        : `${r.name} (${r.role}) จะเข้าระบบไม่ได้จนกว่าจะคืนสิทธิ์ — ข้อมูลและงานเก่ายังอยู่ครบ`,
      confirmLabel: active ? 'คืนสิทธิ์' : 'ถอนสิทธิ์',
    });
    if (ok) await quickSet(r, { status: active ? 'Active' : 'Inactive' }, active ? 'คืนสิทธิ์แล้ว' : 'ถอนสิทธิ์แล้ว');
  };

  // Soft delete / restore via the generic records endpoint (401-resilient).
  const softSet = async (r: User, deleted: boolean) => {
    if (deleted) {
      const ok = await confirm({
        tone: 'danger',
        title: `ลบผู้ใช้ ${r.name}?`,
        description: (
          <>
            {r.name} ({r.role}) จะเข้าระบบไม่ได้และหายจากรายชื่อพนักงานในทุกฟอร์ม งานเก่าที่เคยทำยังแสดงชื่อได้ตามเดิม
            <br />
            กู้คืนได้จากแท็บ "รายการที่ลบ" — ถ้าแค่พักการใช้งาน ให้กด ถอนสิทธิ์ แทน
          </>
        ),
        confirmLabel: 'ลบผู้ใช้',
      });
      if (!ok) return;
    } else {
      // the server restores INACTIVE (a revoked account must not come back open by itself) — say so first
      const ok = await confirm({
        title: `กู้คืนผู้ใช้ ${r.name}?`,
        description: `${r.name} จะกลับมาอยู่ในรายชื่อแบบ Inactive — ยังเข้าระบบไม่ได้ ถ้าจะให้ใช้งานต่อ กด คืนสิทธิ์ ที่แถวนั้นอีกครั้ง`,
        confirmLabel: 'กู้คืน',
      });
      if (!ok) return;
    }
    setBusyId(r.id);
    try {
      await postJson('/api/admin/records', { table: 'users', id: r.id, deleted });
      push({
        kind: 'success',
        title: deleted ? 'ย้ายไปรายการที่ลบแล้ว' : 'กู้คืนแล้ว (ยังปิดการใช้งาน)',
        desc: r.name,
      });
      refetch();
    } catch (e) {
      push({
        kind: 'error',
        title: 'ทำรายการไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<User>[] = [
    {
      key: 'no',
      header: '#',
      width: '52px',
      align: 'center',
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'name',
      header: 'ชื่อผู้ใช้งาน',
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          {r.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.avatar}
              alt={r.name}
              loading="lazy"
              decoding="async"
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-2xs font-semibold text-primary">
              {r.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="num truncate text-2xs text-muted-foreground">{r.username}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'ประเภทผู้ใช้งาน / สิทธิ์',
      cell: (r) =>
        r.role === 'รออนุมัติ' ? (
          <Badge tone="warning" dot>
            {r.role}
          </Badge>
        ) : (
          <Badge tone="primary">{r.role}</Badge>
        ),
    },
    // at 1280px (with the sidebar) every column did not fit and pushed Action off-screen:
    // หน่วยงาน / ติดต่อ show only on wider screens (both stay in the edit dialog)
    { key: 'branch', header: 'สาขา / หน่วยงาน', hideBelow: 'xl' },
    {
      key: 'email',
      header: 'ติดต่อ',
      hideBelow: '2xl',
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
      key: 'lastLogin',
      header: 'เข้าใช้งานล่าสุด',
      hideBelow: 'md',
      cell: (r) => <span className="num text-xs">{r.lastLogin || '—'}</span>,
    },
    {
      key: 'status',
      header: 'สถานะ',
      width: '100px',
      // a pending sign-up (no role yet) is Active in the table but cannot use anything — say so
      cell: (r) =>
        r.role === 'รออนุมัติ' ? (
          <Badge tone="warning" dot>
            รออนุมัติ
          </Badge>
        ) : (
          <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
            {r.status}
          </Badge>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '180px',
      align: 'center',
      sortable: false,
      cell: (r) =>
        view === 'deleted' ? (
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
          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            {r.role === 'รออนุมัติ' ? (
              <button
                disabled={busyId === r.id}
                onClick={() => approveNow(r)}
                className="rounded-md bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                อนุมัติ
              </button>
            ) : isMe(r) ? (
              <span className="px-1 text-2xs text-muted-foreground">บัญชีของคุณ</span>
            ) : r.status === 'Active' ? (
              <button
                disabled={busyId === r.id}
                onClick={() => setActive(r, false)}
                className="rounded-md border border-danger/30 px-2.5 py-1 text-2xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
              >
                ถอนสิทธิ์
              </button>
            ) : (
              <button
                disabled={busyId === r.id}
                onClick={() => setActive(r, true)}
                className="rounded-md border border-success/30 px-2.5 py-1 text-2xs font-medium text-success transition-colors hover:bg-success-soft disabled:opacity-50"
              >
                คืนสิทธิ์
              </button>
            )}
            <RowActions onEdit={() => openEdit(r)} onDelete={isMe(r) ? undefined : () => softSet(r, true)} />
          </div>
        ),
    },
  ];

  const resetFilters = () => {
    setDraft(NO_FILTER);
    setFilter(NO_FILTER);
  };

  return (
    <>
      <PageHeader
        title="ผู้ใช้ระบบ"
        description="เพิ่มผู้ใช้จากไดเรกทอรี Lark และกำหนดสิทธิ์การเข้าถึงตามบทบาท"
        actions={
          <>
            <ExportButton run={() => exportXlsx('users', { deleted: view === 'deleted' ? 'only' : 'exclude' })} />
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มผู้ใช้งาน
            </Button>
          </>
        }
      />

      <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
        {(['active', 'deleted'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              'rounded-md px-3.5 py-1.5 font-medium transition-colors ' +
              (view === v ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')
            }
          >
            {v === 'active' ? 'ผู้ใช้งาน' : 'รายการที่ลบ'}
          </button>
        ))}
      </div>

      {view === 'active' && pendingCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
          <Clock className="h-4 w-4 shrink-0 text-warning" />
          <span className="text-sm font-medium text-warning">มี {pendingCount} บัญชีรอการอนุมัติ</span>
          <span className="text-2xs text-warning/80">กด “อนุมัติ” ที่แถวนั้นเพื่อกำหนดบทบาทและเปิดสิทธิ์ใช้งาน</span>
          <button
            onClick={() => refetch()}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-warning/30 px-2.5 py-1 text-2xs font-medium text-warning transition-colors hover:bg-warning/10"
          >
            <RefreshCw className="h-3 w-3" />
            รีเฟรช
          </button>
        </div>
      )}

      <FilterBar
        onSearch={() => {
          setFilter(draft);
        }}
        onReset={resetFilters}
      >
        <Field label="ชื่อ-สกุล ผู้ใช้ระบบ">
          <Input
            placeholder="พิมพ์บางส่วนของชื่อ"
            value={draft.name}
            onChange={(e) => setDraft((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Username">
          <Input
            placeholder="username"
            className="num"
            value={draft.username}
            onChange={(e) => setDraft((f) => ({ ...f, username: e.target.value }))}
          />
        </Field>
        <Field label="ประเภทผู้ใช้งาน">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.role}
            onChange={(v) => setDraft((f) => ({ ...f, role: v }))}
            options={strOptions(ROLE_OPTIONS)}
          />
        </Field>
        <Field label="สถานะ">
          <Select
            value={draft.status}
            onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value as UserFilter['status'] }))}
          >
            <option value="">ทั้งหมด</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        narrowed={isFilterActive(filter, NO_FILTER)}
        onClearFilters={resetFilters}
        searchable={false}
        columns={columns}
        rows={VISIBLE}
        loading={loading}
        rowKey={(r) => r.id}
        footerNote={
          filter !== NO_FILTER && VISIBLE.length !== USERS.length ? <span>· กรองจาก {USERS.length} คน</span> : undefined
        }
      />

      <Modal
        open={!!approving}
        onClose={() => setApproving(null)}
        title={`อนุมัติ ${approving?.name ?? ''}`}
        description="เลือกบทบาทที่จะใช้ — สิทธิ์เมนูทั้งหมดมาจากบทบาทนี้"
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setApproving(null)} disabled={busyId === approving?.id}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={confirmApprove} disabled={!approveRole || busyId === approving?.id}>
              {busyId === approving?.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              อนุมัติ
            </Button>
          </>
        }
      >
        <Field label="ประเภทผู้ใช้งาน / สิทธิ์" required>
          <SearchSelect
            placeholder="- - เลือกบทบาท - -"
            value={approveRole}
            onChange={setApproveRole}
            options={strOptions(ROLE_OPTIONS.filter((x) => x !== 'รออนุมัติ'))}
          />
        </Field>
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'แก้ไขผู้ใช้ระบบ' : 'เพิ่มผู้ใช้ระบบ'}
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? 'บันทึกข้อมูล' : 'เพิ่มผู้ใช้งาน'}
            </Button>
          </>
        }
      >
        {!editing && (
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
            <Field
              label="ค้นหาพนักงานจากไดเรกทอรี Lark"
              hint="เลือกจากรายชื่อจริง แล้วระบบจะเติมชื่อ อีเมล และหน่วยงานให้อัตโนมัติ"
            >
              <PeoplePicker value={null} onChange={pickPerson} placeholder="พิมพ์ชื่อพนักงาน SHD เพื่อค้นหา…" />
            </Field>
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
              <p className="truncate text-sm font-medium">{form.name || '—'}</p>
              <p className="truncate text-2xs text-muted-foreground">{form.email || 'ยังไม่ได้เลือกพนักงาน'}</p>
            </div>
          </div>
        )}

        <FieldGrid cols={2}>
          <Field label="ชื่อ-สกุล" required error={fe.errors.name}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {/* your own email / username: sign-in finds the account by email — changing it locks you out */}
          <Field
            label="อีเมล"
            error={fe.errors.email}
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
            error={fe.errors.username}
            hint={isMe(form) ? 'เปลี่ยน Username ของตัวเองไม่ได้' : undefined}
          >
            <Input
              maxLength={50}
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              disabled={isMe(form)}
            />
          </Field>
          <Field label="รหัสพนักงาน / Lark ID" error={fe.errors.code}>
            <Input maxLength={50} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="—" />
          </Field>
          <Field
            label="ประเภทผู้ใช้งาน / สิทธิ์"
            required
            error={fe.errors.role}
            hint={isMe(form) ? 'เปลี่ยนบทบาทของตัวเองไม่ได้' : 'กำหนดบทบาทเพื่อคุมสิทธิ์เมนูที่เข้าถึงได้'}
          >
            <SearchSelect
              placeholder="- - เลือกบทบาท - -"
              value={form.role}
              onChange={(v) => set('role', v)}
              // "รออนุมัติ" is not a role to give (อนุมัติ picks one; the API refuses it) — only a pending user keeps it
              options={strOptions(ROLE_OPTIONS.filter((x) => x !== PENDING_ROLE || prev?.role === PENDING_ROLE))}
              disabled={isMe(form)}
            />
          </Field>
          <Field label="สาขา / หน่วยงาน" error={fe.errors.branch}>
            <Input maxLength={100} value={form.branch} onChange={(e) => set('branch', e.target.value)} />
          </Field>
          <Field label="เบอร์โทรศัพท์" error={fe.errors.phone}>
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
    </>
  );
}
