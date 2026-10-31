'use client';

import { useAccess } from '@/lib/use-access';
import { MODULE_LABELS, type Module } from '@/lib/modules';

/** the job screens — a job list is readable from any one of them (READ_ACCESS.jobs in src/server/resources.ts) */
export const JOB_SCREENS: readonly Module[] = ['Job Management', 'Job Assign', 'Job Repair', 'Job Closing'];

/** KPIs need only the special right Report; the table needs the module's view (any of `read`), Excel the export module's view + Export — a missing one shows a hint, never a load error or a 403 on click */
export function useReportAccess(read: readonly Module[] | null, exportModule: Module) {
  const { can } = useAccess();
  const canTable = !read?.length || read.some((m) => can(m, 'view'));
  const menu = read?.[0];
  return {
    canTable,
    canExport: can(exportModule, 'view'),
    emptyText:
      canTable || !menu
        ? undefined
        : `ต้องมีสิทธิ์ดู ${MODULE_LABELS[menu as keyof typeof MODULE_LABELS] ?? menu} ด้วย`,
  };
}

/** The KPI tiles — or, when they failed (e.g. Report revoked while the page was open), one tile saying why:
 *  the old numbers never stay on screen after a ค้นหา that was refused. */
export function kpisOr<T extends { label: string; value: string }>(error: string | null, kpis: T[]) {
  return error ? [{ label: 'ตัวเลขสรุป', value: 'โหลดไม่สำเร็จ', tone: 'danger' as const, sub: error }] : kpis;
}
