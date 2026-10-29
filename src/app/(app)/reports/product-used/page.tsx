'use client';

import type * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { Badge } from '@/components/ui/badge';
import {
  useIssuedLinesPage,
  useIssuedStats,
  useCategories,
  useReportRows,
  type IssuedLine,
  type PageParams,
} from '@/data/db';
import type { Column, ServerTable } from '@/components/ui/data-table';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { reportExport, useReportColumns } from '../report-table';
import type { ReportRow } from '../report-specs';

/** แบบเบิกจ่ายสุทธิ: inventory_dt lines of WHO documents minus รับคืนจากการเบิก (the earlier screen) */
const netColumns: Column<IssuedLine>[] = [
  { key: 'doc', header: 'Document No.', width: '130px', cell: (r) => <span className="num font-medium">{r.doc}</span> },
  { key: 'date', header: 'วันที่', width: '140px', cell: (r) => <span className="num text-xs">{r.date}</span> },
  { key: 'type', header: 'ประเภทเอกสาร', hideBelow: 'lg', cell: (r) => <Badge tone="info">{r.type}</Badge> },
  { key: 'code', header: 'รหัสอะไหล่', width: '110px', cell: (r) => <span className="num">{r.code}</span> },
  { key: 'item', header: 'ชื่ออะไหล่', cell: (r) => <span className="line-clamp-1 max-w-[300px]">{r.item}</span> },
  { key: 'qty', header: 'จำนวน', align: 'right', width: '90px', value: (r) => r.qty },
  {
    key: 'value',
    header: 'มูลค่า (ราคา ณ วันเบิก)',
    align: 'right',
    width: '140px',
    value: (r) => r.value,
    cell: (r) => (
      <span title={r.priceBasis}>
        {baht(r.value)}
        {r.priceBasis === 'ราคาปัจจุบัน' && <span className="text-muted-foreground">*</span>}
      </span>
    ),
  },
  { key: 'by', header: 'ผู้ทำรายการ', hideBelow: 'xl' },
];

const LOG = 'อ้างอิงงานซ่อม (เบิก / ขอคืน / จ่ายแล้ว)';
const NET = 'เบิกจ่ายสุทธิ (เอกสารสต๊อก)';
/** job_order_spare_part_status (legacy table, fixed) */
const ORDER_STATUSES = ['เบิก', 'ขอคืน', 'จ่ายแล้ว', 'ยกเลิก', 'คืนแล้ว'];

type Common = Omit<
  React.ComponentProps<typeof ReportView<IssuedLine>>,
  'columns' | 'rows' | 'rowKey' | 'loading' | 'error' | 'onRetry' | 'server' | 'onExport'
> & {
  pageArgs: PageParams;
  server: Omit<ServerTable, 'total'>;
  canTable: boolean;
  canExport: boolean;
  q: string;
};

/** แบบอ้างอิงงานซ่อม: the job part log — each mode its own component, so only the shown one is read */
function LogReport({ pageArgs, server, canTable, canExport, q, f, ...view }: Common & { f: ReportValues }) {
  const filters = { from: f.from, to: f.to, code: f.code, name: f.name, jobNo: f.jobNo, status: f.status };
  const { rows, total, loading, error, refetch } = useReportRows('product_used', { ...pageArgs, ...filters });
  const columns = useReportColumns('product_used');
  return (
    <ReportView<ReportRow>
      {...view}
      onExport={canExport ? reportExport('report_product_used', { ...filters, q }, 'report-product-used') : undefined}
      columns={columns}
      rows={rows}
      rowKey={(r) => String(r.idx)}
      loading={loading}
      error={canTable ? error : null}
      onRetry={refetch}
      server={{ ...server, total }}
    />
  );
}

function NetReport({ pageArgs, server, canTable, canExport, q, f, ...view }: Common & { f: ReportValues }) {
  const filters = { from: f.from, to: f.to, category: f.category, code: f.code };
  const { rows, total, loading, error, refetch } = useIssuedLinesPage({ ...pageArgs, ...filters });
  return (
    <ReportView<IssuedLine>
      {...view}
      onExport={canExport ? reportExport('issued_lines', { ...filters, q }, 'report-product-used') : undefined}
      columns={netColumns}
      rows={rows}
      rowKey={(r, i) => `${r.doc}-${r.code}-${i}`}
      loading={loading}
      error={canTable ? error : null}
      onRetry={refetch}
      server={{ ...server, total }}
    />
  );
}

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today() });
  // KPIs: the special right Report alone (the net issue over the range); table + exports: Report too
  const access = useReportAccess(null, 'Report');
  const { data: sum, error: sumError } = useIssuedStats({
    from: f.from,
    to: f.to,
    category: f.category,
    code: f.code,
    q: table.q,
  });
  const { data: CATEGORIES, ...categoriesLookup } = useCategories();
  const S = sum[0];
  const props: Common & { f: ReportValues } = {
    f,
    pageArgs,
    server,
    q: table.q,
    canTable: access.canTable,
    canExport: access.canExport,
    emptyText: access.emptyText,
    title: 'รายงานการเบิกจ่ายอะไหล่',
    description:
      'แบบอ้างอิงงานซ่อม: ทุกบรรทัดที่เบิก / ขอคืน / จ่าย / คืนของงานซ่อม (ตามรายงานเดิม) · แบบเบิกจ่ายสุทธิ: เอกสารจ่ายออกหักรับคืน พร้อมมูลค่า',
    filters: [
      { kind: 'select', key: 'mode', label: 'รูปแบบรายงาน', options: [LOG, NET] },
      { kind: 'date', key: 'from', label: 'วันที่ (ตั้งแต่)', value: f.from },
      { kind: 'date', key: 'to', label: 'วันที่ (ถึง)', value: f.to },
      { kind: 'text', key: 'code', label: 'รหัสอะไหล่ (ระบบ / ผู้ผลิต)', placeholder: 'P02534' },
      { kind: 'text', key: 'name', label: 'ชื่ออะไหล่ (แบบอ้างอิงงานซ่อม)' },
      { kind: 'text', key: 'jobNo', label: 'เลขที่งานซ่อม (แบบอ้างอิงงานซ่อม)', placeholder: 'J2612164' },
      { kind: 'select', key: 'status', label: 'สถานะ (แบบอ้างอิงงานซ่อม)', options: ['ทั้งหมด', ...ORDER_STATUSES] },
      {
        kind: 'select',
        key: 'category',
        label: 'หมวดหมู่ (แบบเบิกจ่ายสุทธิ)',
        options: ['ทั้งหมด', ...CATEGORIES.map((c) => c.name)],
        lookup: categoriesLookup,
      },
    ],
    onApply: setF,
    kpis: kpisOr(sumError, [
      { label: 'รายการเคลื่อนไหว (สุทธิ)', value: int(S?.lines ?? 0), tone: 'primary' },
      { label: 'จำนวนที่เบิกสุทธิ (หักรับคืน)', value: `${int(S?.qty ?? 0)} ชิ้น` },
      {
        label: 'มูลค่าสุทธิ (ราคา ณ วันเบิก)',
        value: baht(S?.value ?? 0),
        sub: S?.todayPriced ? `* ${int(S.todayPriced)} รายการไม่มีราคาที่บันทึกไว้ ใช้ราคาปัจจุบัน` : undefined,
      },
      { label: 'อะไหล่ที่ใช้บ่อยสุด', value: S?.top ?? '—' },
    ]),
  };
  return f.mode === NET ? <NetReport {...props} /> : <LogReport {...props} />;
}
