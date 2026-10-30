'use client';

import { Mail, Phone } from 'lucide-react';
import { RowActions } from '@/components/shared/row-actions';
import type { Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import type { User } from '@/data/types';
import { PENDING_ROLE } from '@/lib/access';
import { Email } from '@/components/shared/email';

/** the role chip — a pending sign-up (no role yet) shows as a warning */
function RoleBadge({ role }: { role: string }) {
  return role === PENDING_ROLE ? (
    <Badge tone="warning" dot>
      {role}
    </Badge>
  ) : (
    <Badge tone="primary">{role}</Badge>
  );
}

// a pending sign-up (no role yet) is Active in the table but cannot use anything — say so;
// the trash view says ลบแล้ว like the master pages (uiStatus reads DELETED as Inactive)
function StatusBadge({ r, deleted }: { r: User; deleted: boolean }) {
  return deleted ? (
    <Badge tone="neutral">ลบแล้ว</Badge>
  ) : r.role === PENDING_ROLE ? (
    <Badge tone="warning" dot>
      รออนุมัติ
    </Badge>
  ) : (
    <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
      {r.status}
    </Badge>
  );
}

export function userColumns({
  view,
  busyId,
  isMe,
  onApprove,
  onSetActive,
  onSoftSet,
  onEdit,
}: {
  view: 'active' | 'deleted';
  busyId: string | null;
  isMe: (r: { id: string }) => boolean;
  onApprove: (r: User) => void;
  onSetActive: (r: User, active: boolean) => void;
  onSoftSet: (r: User, deleted: boolean) => void;
  onEdit: (r: User) => void;
}): Column<User>[] {
  return [
    {
      key: 'no',
      header: '#',
      width: '52px',
      align: 'center',
      sortable: false,
      hideBelow: 'sm', // phones: name + role + action
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'name',
      header: 'ชื่อผู้ใช้งาน',
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          {r.avatar ? (
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
            {/* a phone: the role and status columns are hidden — shown here, so Action fits beside the name */}
            <div className="mt-1 flex flex-wrap items-center gap-1 sm:hidden">
              <RoleBadge role={r.role} />
              {/* a pending sign-up: its role badge already says it */}
              {(view === 'deleted' || r.role !== PENDING_ROLE) && <StatusBadge r={r} deleted={view === 'deleted'} />}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'ประเภทผู้ใช้งาน / สิทธิ์',
      hideBelow: 'sm',
      cell: (r) => <RoleBadge role={r.role} />,
    },
    // at 1280px (with the sidebar) every column does not fit and pushes Action off-screen:
    // หน่วยงาน / ติดต่อ show only on wider screens (both stay in the edit dialog)
    { key: 'branch', header: 'สาขา / หน่วยงาน', hideBelow: 'xl' },
    {
      key: 'email',
      header: 'ติดต่อ',
      hideBelow: '2xl',
      cell: (r) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> <Email value={r.email} />
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
      hideBelow: 'sm', // a pending sign-up still shows: its action is "อนุมัติ"
      cell: (r) => <StatusBadge r={r} deleted={view === 'deleted'} />,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'center',
      sortable: false,
      cell: (r) =>
        view === 'deleted' ? (
          <div className="flex items-center justify-center">
            <button
              disabled={busyId === r.id}
              onClick={() => onSoftSet(r, false)}
              className="rounded-md border border-success/30 px-2.5 py-1 text-2xs font-medium text-success transition-colors hover:bg-success-soft disabled:opacity-50"
            >
              กู้คืน
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
            {r.role === PENDING_ROLE ? (
              <button
                disabled={busyId === r.id}
                onClick={() => onApprove(r)}
                className="rounded-md bg-primary px-2.5 py-1 text-2xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                อนุมัติ
              </button>
            ) : isMe(r) ? (
              <span className="px-1 text-2xs text-muted-foreground">บัญชีของคุณ</span>
            ) : r.status === 'Active' ? (
              <button
                disabled={busyId === r.id}
                onClick={() => onSetActive(r, false)}
                className="rounded-md border border-danger/30 px-2.5 py-1 text-2xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
              >
                ถอนสิทธิ์
              </button>
            ) : (
              <button
                disabled={busyId === r.id}
                onClick={() => onSetActive(r, true)}
                className="rounded-md border border-success/30 px-2.5 py-1 text-2xs font-medium text-success transition-colors hover:bg-success-soft disabled:opacity-50"
              >
                คืนสิทธิ์
              </button>
            )}
            <RowActions onEdit={() => onEdit(r)} onDelete={isMe(r) ? undefined : () => onSoftSet(r, true)} />
          </div>
        ),
    },
  ];
}
