'use client';

import * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { StatusBadge } from '@/components/ui/badge';
import type { Job } from '@/data/types';
import { useJobsPage, useJobSummary, useSymptoms, useStaff, useJobTypes } from '@/data/db';
import type { Column } from '@/components/ui/data-table';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { exportXlsx } from '@/lib/api';
import { useServerTable } from '@/lib/use-server-table';
import { brandModelColumn, COL_MIN_WIDTH, DateTimeCell } from '@/components/shared/table-columns';

const columns: Column<Job>[] = [
  { key: 'no', header: 'เลขที่งาน', width: '130px', cell: (r) => <span className="num font-medium">{r.no}</span> },
  {
    key: 'repairedDate',
    header: 'วันที่ซ่อม',
    width: '110px',
    cell: (r) => <DateTimeCell value={r.repairedDate} />,
  },
  {
    key: 'customer',
    header: 'ลูกค้า',
    minWidth: COL_MIN_WIDTH.customer,
    cell: (r) => (
      <span className="line-clamp-1 max-w-[200px]" title={r.customer}>
        {r.customer}
      </span>
    ),
  },
  brandModelColumn(),
  {
    key: 'imei',
    header: 'Serial / IMEI',
    hideBelow: 'xl',
    cell: (r) => <span className="num text-xs">{r.imei || r.serial}</span>,
  },
  { key: 'owner', header: 'ช่างผู้รับผิดชอบ', hideBelow: 'lg' },
  {
    key: 'amount',
    header: 'ค่าอะไหล่+บริการ',
    align: 'right',
    width: '140px',
    value: (r) => r.amount,
    cell: (r) => baht(r.amount),
  },
  {
    key: 'status',
    header: 'สถานะงาน',
    minWidth: COL_MIN_WIDTH.status,
    cell: (r) => <StatusBadge status={r.status} group={r.statusGroup} wrap />,
  },
];

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({
    from: daysAgo(30),
    to: today(),
    type: '',
    engineer: '',
    symptom: '',
  });
  const { data: STAFF, ...staffLookup } = useStaff('engineer');
  // by id like the sale-order report: names carry stray spaces and may repeat
  const engineerId = STAFF.find((s) => s.name === f.engineer)?.id;
  // "วันที่ซ่อม" = job_repaired_date
  const filters = {
    from: f.from,
    to: f.to,
    dateBy: 'repaired',
    type: f.type,
    engineer: engineerId ? String(engineerId) : f.engineer,
    symptom: f.symptom,
  };
  const { data: sum } = useJobSummary({ ...filters, q: table.q });
  const {
    rows: JOBS,
    total: totalRows,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useJobsPage({ ...pageArgs, ...filters });
  const { data: SYMPTOMS, ...symptomsLookup } = useSymptoms();
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const S = sum[0];
  const count = S?.total ?? 0;
  const done = S?.done ?? 0;
  const total = S?.amount ?? 0;
  const doneRate = count ? ((done / count) * 100).toFixed(1) : '0';
  return (
    <ReportView
      title="รายงานการซ่อม"
      description="รายละเอียดผลการซ่อม อะไหล่ที่ใช้ และช่างผู้รับผิดชอบ"
      filters={[
        { kind: 'date', key: 'from', label: 'วันที่ซ่อม (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่ซ่อม (ถึง)', value: f.to },
        {
          kind: 'select',
          key: 'type',
          label: 'ประเภทงาน',
          options: ['ทั้งหมด', ...JOB_TYPES.map((j) => j.name)],
          lookup: jobTypesLookup,
        },
        {
          kind: 'select',
          key: 'engineer',
          label: 'ช่างผู้รับผิดชอบ',
          options: ['ทั้งหมด', ...STAFF.map((s) => s.name)],
          lookup: staffLookup,
        },
        {
          kind: 'select',
          key: 'symptom',
          label: 'อาการเสีย',
          options: ['ทั้งหมด', ...SYMPTOMS.map((s) => s.name)],
          lookup: symptomsLookup,
        },
      ]}
      onApply={setF}
      onExport={() => exportXlsx('jobs', { ...filters, q: table.q })}
      kpis={[
        { label: 'งานที่ดำเนินการ', value: int(count), tone: 'primary' },
        { label: 'ซ่อมสำเร็จ', value: int(done), tone: 'success' },
        { label: 'มูลค่างานซ่อมรวม', value: baht(total) },
        { label: 'อัตราซ่อมสำเร็จ', value: `${doneRate}%`, tone: 'success' },
      ]}
      columns={columns}
      rows={JOBS}
      loading={loading}
      error={loadError}
      onRetry={retryLoad}
      rowKey={(r) => r.no}
      server={{ ...server, total: totalRows }}
    />
  );
}
