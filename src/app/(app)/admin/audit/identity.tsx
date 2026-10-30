import * as React from 'react';
import type { AuditRow } from '@/data/db';

/** GET /api/audit (src/server/contract/audit.ts AuditLogRow): the actor and request as at the time */
export type AuditLogRow = AuditRow & {
  email: string | null;
  role: string | null;
  department: string | null;
  entityId: string | null;
  no: string | null;
  reason: string | null;
};

/** the identity lines of a log row (the detail modal of both log pages) */
export function Identity({ r }: { r: Omit<AuditLogRow, keyof AuditRow | 'reason'> & { user: string } }) {
  const lines: [string, string | null][] = [
    ['ผู้ใช้', [r.user, r.email].filter(Boolean).join(' · ') || null],
    ['ตำแหน่ง / แผนก (ขณะนั้น)', [r.role, r.department].filter(Boolean).join(' · ') || null],
    ['เลขที่ / id', [r.no, r.entityId].filter(Boolean).join(' · ') || null],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {lines.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v || '—'}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
