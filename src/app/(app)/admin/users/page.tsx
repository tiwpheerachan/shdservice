'use client';

import * as React from 'react';
import { Plus, Clock, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { ROLES } from '@/data/options';
import type { User } from '@/data/types';
import { useUsers, useRoles } from '@/data/db';
import { exportXlsx } from '@/lib/api';
import { useFilterDraft } from '@/lib/use-filter-draft';
import { ExportButton } from '@/components/shared/export-button';
import { useAccess } from '@/lib/use-access';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import { PENDING_ROLE } from '@/lib/access';
import { UserFilterBar, type UserFilter } from './user-filter-bar';
import { userColumns } from './user-columns';
import { useUserActions } from './use-user-actions';
import { ApproveDialog } from './approve-dialog';
import { UserDialog, useUserDialog } from './user-dialog';

export default function UsersPage() {
  // your own row: no revoke / delete / role or status change (the API refuses them with a 409)
  const { userId: myId } = useAccess();
  const isMe = (r: { id: string }) => r.id === myId;
  const [view, setView] = React.useState<'active' | 'deleted'>('active');
  const { data: USERS, loading, refetch } = useUsers(view === 'deleted' ? 'only' : 'exclude');
  // roles = user_type values from role_permission (DB), "รออนุมัติ" = no role yet
  const { data: dbRoles } = useRoles();
  // System Admin last: the dropdown keyboard-highlights the first row, and Enter there would grant full admin
  const ROLE_OPTIONS = React.useMemo(
    () =>
      dbRoles.length
        ? [
            ...dbRoles.filter((x) => x !== ADMIN_USER_TYPE),
            ...dbRoles.filter((x) => x === ADMIN_USER_TYPE),
            PENDING_ROLE,
          ]
        : ROLES,
    [dbRoles],
  );
  const pendingCount = USERS.filter((u) => u.role === PENDING_ROLE).length;

  // filter bar — applied on ค้นหา, evaluated in the browser (the whole list is loaded)
  const NO_FILTER: UserFilter = { name: '', username: '', role: '', status: '' };
  const { draft, setD, filters: filter, apply, reset: resetFilters, narrowed } = useFilterDraft<UserFilter>(NO_FILTER);
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
  // auto-refresh so users who just signed in (pending) show up without a reload — not while the tab is hidden
  React.useEffect(() => {
    if (view !== 'active') return;
    const id = setInterval(() => !document.hidden && refetch(), 25000);
    return () => clearInterval(id);
  }, [refetch, view]);

  const { openAdd, openEdit, dialog } = useUserDialog(refetch);
  const { busyId, quickSet, setActive, softSet } = useUserActions(refetch);

  // อนุมัติ asks for the role first, nothing pre-picked: a silent default role would hand people
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

  const columns = userColumns({
    view,
    busyId,
    isMe,
    onApprove: approveNow,
    onSetActive: setActive,
    onSoftSet: softSet,
    onEdit: openEdit,
  });

  return (
    <>
      <PageHeader
        title="ผู้ใช้ระบบ"
        description="เพิ่มผู้ใช้จากไดเรกทอรี Lark และกำหนดสิทธิ์การเข้าถึงตามบทบาท"
        actions={
          <>
            <ExportButton
              run={() => exportXlsx('users', { ...filter, deleted: view === 'deleted' ? 'only' : 'exclude' })}
            />
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

      <UserFilterBar draft={draft} setD={setD} onSearch={apply} onReset={resetFilters} roleOptions={ROLE_OPTIONS} />

      <DataTable
        narrowed={narrowed}
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

      <ApproveDialog
        approving={approving}
        role={approveRole}
        onRoleChange={setApproveRole}
        onClose={() => setApproving(null)}
        onConfirm={confirmApprove}
        busyId={busyId}
        roleOptions={ROLE_OPTIONS}
      />

      <UserDialog {...dialog} roleOptions={ROLE_OPTIONS} isMe={isMe} />
    </>
  );
}
