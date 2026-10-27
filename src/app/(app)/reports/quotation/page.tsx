'use client';

import * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { Badge } from '@/components/ui/badge';
import { QUOTATION_STATUS_OPTIONS } from '@/data/options';
import type { Quotation } from '@/data/types';
import { useQuotationsPage, useQuotationStatuses, useQuotationSummary } from '@/data/db';
import type { Column } from '@/components/ui/data-table';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { exportXlsx } from '@/lib/api';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { QUOTATION_TONE as TONE } from '@/components/shared/quotation-form';

const columns: Column<Quotation>[] = [
  {
    key: 'no',
    header: 'เลขที่ใบเสนอราคา',
    width: '150px',
    cell: (r) => <span className="num font-medium">{r.no}</span>,
  },
  { key: 'date', header: 'วันที่', width: '110px', cell: (r) => <span className="num text-xs">{r.date}</span> },
  {
    key: 'type',
    header: 'ประเภท',
    hideBelow: 'lg',
    cell: (r) => <Badge tone={r.type.includes('VIP') ? 'primary' : 'neutral'}>{r.type}</Badge>,
  },
  { key: 'customer', header: 'ลูกค้า', cell: (r) => <span className="line-clamp-1 max-w-[200px]">{r.customer}</span> },
  {
    key: 'jobRef',
    header: 'อ้างถึงงานซ่อม',
    hideBelow: 'md',
    cell: (r) => <span className="num text-xs">{r.jobRef}</span>,
  },
  {
    key: 'amount',
    header: 'จำนวนเงิน',
    align: 'right',
    width: '120px',
    value: (r) => r.amount,
    cell: (r) => baht(r.amount),
  },
  {
    key: 'status',
    header: 'สถานะ',
    width: '150px',
    cell: (r) => (
      <Badge tone={TONE[r.status] ?? 'neutral'} dot>
        {r.status}
      </Badge>
    ),
  },
];

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today(), type: '', status: '' });
  const filters = { from: f.from, to: f.to, status: f.status, type: f.type };
  // KPIs: the special right Report alone; table + Excel: the module's view too (useReportAccess)
  const access = useReportAccess(['Quotation'], 'Quotation');
  const { data: sum, error: sumError } = useQuotationSummary({ ...filters, q: table.q });
  const { data: STATUSES } = useQuotationStatuses();
  const {
    rows: QUOTATIONS,
    total: totalRows,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useQuotationsPage({ ...pageArgs, ...filters });
  const S = sum[0];
  const total = S?.amount ?? 0;
  const approvedTotal = S?.agreedAmount ?? 0;
  return (
    <ReportView
      title="รายงานการเสนอราคา"
      description="สรุปใบเสนอราคา อัตราการอนุมัติ และมูลค่ารวม"
      filters={[
        { kind: 'date', key: 'from', label: 'วันที่สร้าง (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่สร้าง (ถึง)', value: f.to },
        { kind: 'select', key: 'type', label: 'ประเภท', options: ['ทั้งหมด', 'Type A (Normal)', 'Type B (VIP)'] },
        {
          kind: 'select',
          key: 'status',
          label: 'สถานะ',
          options: ['ทั้งหมด', ...(STATUSES.length ? STATUSES.map((x) => x.name) : QUOTATION_STATUS_OPTIONS)],
        },
      ]}
      onApply={setF}
      onExport={
        access.canExport
          ? () => exportXlsx('quotations', { ...filters, q: table.q, file: 'report-quotation' })
          : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'ใบเสนอราคาทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
        { label: 'ลูกค้าตกลงซ่อม', value: int(S?.agreed ?? 0), tone: 'success' },
        {
          label: 'มูลค่ารวม',
          value: baht(total),
          sub: S?.cancelledAmount ? `ไม่รวมใบที่ยกเลิก ${baht(S.cancelledAmount)}` : undefined,
        },
        { label: 'มูลค่าที่ตกลง', value: baht(approvedTotal), tone: 'success' },
      ])}
      columns={columns}
      rows={QUOTATIONS}
      loading={loading}
      error={access.canTable ? loadError : null}
      emptyText={access.emptyText}
      onRetry={retryLoad}
      rowKey={(r) => r.no}
      server={{ ...server, total: totalRows }}
    />
  );
}
