'use client';

import * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { CHANNELS } from '@/data/options';
import type { Job } from '@/data/types';
import { useJobsPage, useJobSummary, useJobTypes } from '@/data/db';
import type { Column } from '@/components/ui/data-table';
import { int } from '@/lib/utils';
import { exportXlsx } from '@/lib/api';
import { kpisOr, useReportAccess, JOB_SCREENS } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { brandModelColumn, COL_MIN_WIDTH } from '@/components/shared/table-columns';
import { START, queryOf } from './filters';

const columns: Column<Job>[] = [
  { key: 'no', header: 'เลขที่งาน', width: '130px', cell: (r) => <span className="num font-medium">{r.no}</span> },
  {
    key: 'openDate',
    header: 'วันที่เปิดงาน',
    width: '140px',
    cell: (r) => <span className="num text-xs">{r.openDate}</span>,
  },
  {
    key: 'customer',
    header: 'ลูกค้า',
    minWidth: COL_MIN_WIDTH.customer,
    cell: (r) => <span className="line-clamp-1 max-w-[220px]">{r.customer}</span>,
  },
  { key: 'so', header: 'เลขคำสั่งซื้อ', hideBelow: 'lg', cell: (r) => <span className="num text-xs">{r.so}</span> },
  brandModelColumn(),
  {
    key: 'jobType',
    header: 'ประเภทงาน',
    hideBelow: 'xl',
    cell: (r) => (
      <Badge tone="primary" wrap>
        {r.jobType}
      </Badge>
    ),
  },
  { key: 'owner', header: 'ผู้รับผิดชอบ', hideBelow: 'lg' },
  {
    key: 'status',
    header: 'สถานะงาน',
    minWidth: COL_MIN_WIDTH.status,
    cell: (r) => <StatusBadge status={r.status} group={r.statusGroup} wrap />,
  },
];

export default function Page() {
  const { filters: f, setFilters: setF, table, pageArgs, server } = useServerTable<ReportValues>(START());
  const filters = queryOf(f);
  // KPIs over the whole range (1 query) + one page of rows
  // KPIs: the special right Report alone; table + Excel: the module's view too (useReportAccess)
  const access = useReportAccess(JOB_SCREENS, 'Job Management');
  const { data: sum, error: sumError } = useJobSummary({ ...filters, q: table.q });
  const { rows: JOBS, total, loading, error: loadError, refetch: retryLoad } = useJobsPage({ ...pageArgs, ...filters });
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const S = sum[0];
  const newJobs = S?.fresh ?? 0;
  const days = Math.max(
    1,
    Math.round((new Date(f.to ?? '').getTime() - new Date(f.from ?? '').getTime()) / 86400000) + 1,
  );
  const topChannel = S?.topChannel ?? '—';
  return (
    <ReportView
      title="รายงานการเปิดงานซ่อม"
      description="สรุปงานที่เปิดใหม่ในระบบตามช่วงเวลาที่กำหนด"
      filters={[
        { kind: 'date', key: 'from', label: 'วันที่เปิดงาน (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่เปิดงาน (ถึง)', value: f.to },
        {
          kind: 'select',
          key: 'type',
          label: 'ประเภทงาน',
          options: ['ทั้งหมด', ...JOB_TYPES.map((j) => j.name)],
          lookup: jobTypesLookup,
        },
        { kind: 'select', key: 'channel', label: 'ช่องทางการขาย', options: ['ทั้งหมด', ...CHANNELS] },
      ]}
      onApply={setF}
      onExport={
        access.canExport
          ? () =>
              exportXlsx('jobs', {
                ...filters,
                q: table.q,
                sort: pageArgs.sort,
                dir: pageArgs.dir,
                file: 'report-open-job',
              })
          : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'งานที่เปิดทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
        { label: 'งานใหม่ (ยังไม่เริ่ม)', value: int(newJobs), tone: 'warning' },
        { label: 'เฉลี่ยต่อวัน', value: ((S?.total ?? 0) / days).toFixed(1) },
        { label: 'ช่องทางการขายหลัก', value: topChannel },
      ])}
      columns={columns}
      rows={JOBS}
      loading={loading}
      error={access.canTable ? loadError : null}
      emptyText={access.emptyText}
      onRetry={retryLoad}
      rowKey={(r) => r.no}
      server={{ ...server, total }}
    />
  );
}
