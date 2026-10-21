'use client';

import * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { Badge } from '@/components/ui/badge';
import type { SaleOrder } from '@/data/types';
import { useSaleOrdersPage, useSaleOrderSummary, useStaff } from '@/data/db';
import type { Column } from '@/components/ui/data-table';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { exportXlsx } from '@/lib/api';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { SO_TONE as TONE } from '@/components/shared/sale-order-form';

const columns: Column<SaleOrder>[] = [
  { key: 'no', header: 'SO No.', width: '120px', cell: (r) => <span className="num font-medium">{r.no}</span> },
  { key: 'date', header: 'วันที่สั่ง', width: '110px', cell: (r) => <span className="num text-xs">{r.date}</span> },
  {
    key: 'customer',
    header: 'ชื่อลูกค้า',
    cell: (r) => <span className="line-clamp-1 max-w-[240px]">{r.customer}</span>,
  },
  { key: 'sales', header: 'พนักงานขาย', hideBelow: 'md' },
  {
    key: 'amount',
    header: 'จำนวนเงิน',
    align: 'right',
    width: '120px',
    value: (r) => r.amount,
    cell: (r) => baht(r.amount),
  },
  {
    key: 'approve',
    header: 'สถานะอนุมัติ',
    width: '170px',
    cell: (r) => (
      <Badge tone={TONE[r.approve] ?? 'neutral'} dot>
        {r.approve}
      </Badge>
    ),
  },
  {
    key: 'tracking',
    header: 'TrackingNo',
    hideBelow: 'xl',
    cell: (r) => <span className="num text-xs">{r.tracking || '—'}</span>,
  },
];

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today(), sales: '', approve: '' });
  const { data: STAFF, ...staffLookup } = useStaff('sales');
  const salesId = STAFF.find((s) => s.name === f.sales)?.id;
  const filters = { from: f.from, to: f.to, sales: salesId ?? f.sales, approve: f.approve };
  // KPIs: the special right Report alone; table + Excel: the module's view too (useReportAccess)
  const access = useReportAccess(['Sale Order', 'Product Pick Stock'], 'Sale Order');
  const { data: sum, error: sumError } = useSaleOrderSummary({ ...filters, q: table.q });
  const {
    rows: SALE_ORDERS,
    total: totalRows,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useSaleOrdersPage({ ...pageArgs, ...filters });
  const S = sum[0];
  const total = S?.amount ?? 0;
  const avg = S?.avg ?? 0;
  return (
    <ReportView
      title="รายงานการขาย"
      description="ยอดขายตามใบสั่งขาย แยกตามพนักงานขายและช่วงเวลา"
      filters={[
        { kind: 'date', key: 'from', label: 'วันที่สั่งขาย (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่สั่งขาย (ถึง)', value: f.to },
        {
          kind: 'select',
          key: 'sales',
          label: 'พนักงานขาย',
          options: ['ทั้งหมด', ...STAFF.map((u) => u.name)],
          lookup: staffLookup,
        },
        { kind: 'select', key: 'approve', label: 'สถานะอนุมัติ', options: ['ทั้งหมด', ...Object.keys(TONE)] },
      ]}
      onApply={setF}
      onExport={
        access.canExport
          ? () => exportXlsx('sale_orders', { ...filters, q: table.q, file: 'report-sale-order' })
          : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'ใบสั่งขายทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
        { label: 'อนุมัติแล้ว', value: int(S?.approved ?? 0), tone: 'success' },
        {
          label: 'ยอดขายรวม (อนุมัติแล้ว)',
          value: baht(total),
          sub: S?.notApprovedAmount ? `ไม่รวมที่ยังไม่อนุมัติ/ถูกปฏิเสธ ${baht(S.notApprovedAmount)}` : undefined,
        },
        { label: 'ยอดเฉลี่ย/ใบ (อนุมัติแล้ว)', value: baht(avg) },
      ])}
      columns={columns}
      rows={SALE_ORDERS}
      loading={loading}
      error={access.canTable ? loadError : null}
      emptyText={access.emptyText}
      onRetry={retryLoad}
      rowKey={(r) => r.no}
      server={{ ...server, total: totalRows }}
    />
  );
}
