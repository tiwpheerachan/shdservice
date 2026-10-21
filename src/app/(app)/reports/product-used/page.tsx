'use client';

import * as React from 'react';
import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { Badge } from '@/components/ui/badge';
import { useIssuedLinesPage, useIssuedStats, useCategories, type IssuedLine } from '@/data/db';
import type { Column } from '@/components/ui/data-table';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { exportXlsx } from '@/lib/api';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';

type Row = IssuedLine;

const columns: Column<Row>[] = [
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

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today(), category: '', code: '' });
  // inventory_dt lines of WHO documents (จ่ายออกตามงานซ่อม / ใบสั่งขาย / อื่นๆ) minus รับคืนจากการเบิก — paged + KPIs on the server
  const filters = { from: f.from, to: f.to, category: f.category, code: f.code };
  // KPIs: the special right Report alone; table + Excel: the module's view too (useReportAccess)
  const access = useReportAccess(null, 'Report');
  const { data: sum, error: sumError } = useIssuedStats({ ...filters, q: table.q });
  const {
    rows,
    total,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useIssuedLinesPage({ ...pageArgs, ...filters });
  const { data: CATEGORIES, ...categoriesLookup } = useCategories();
  const S = sum[0];
  const qty = S?.qty ?? 0;
  const value = S?.value ?? 0;
  const top = S?.top ?? '—';
  return (
    <ReportView
      title="รายงานการเบิกจ่ายอะไหล่"
      description="อะไหล่ที่ถูกเบิกใช้ในงานซ่อม ใบสั่งขาย และจ่ายออกอื่นๆ (หักที่รับคืนเข้าสต๊อก) พร้อมมูลค่ารวม"
      filters={[
        { kind: 'date', key: 'from', label: 'วันที่ (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่ (ถึง)', value: f.to },
        {
          kind: 'select',
          key: 'category',
          label: 'หมวดหมู่',
          options: ['ทั้งหมด', ...CATEGORIES.map((c) => c.name)],
          lookup: categoriesLookup,
        },
        { kind: 'text', key: 'code', label: 'รหัสอะไหล่', placeholder: 'P02534' },
      ]}
      onApply={setF}
      onExport={
        access.canExport
          ? () => exportXlsx('issued_lines', { ...filters, q: table.q, file: 'report-product-used' })
          : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'รายการเคลื่อนไหว', value: int(S?.lines ?? 0), tone: 'primary' },
        { label: 'จำนวนที่เบิกสุทธิ (หักรับคืน)', value: `${int(qty)} ชิ้น` },
        {
          label: 'มูลค่าสุทธิ (ราคา ณ วันเบิก)',
          value: baht(value),
          sub: S?.todayPriced ? `* ${int(S.todayPriced)} รายการไม่มีราคาที่บันทึกไว้ ใช้ราคาปัจจุบัน` : undefined,
        },
        { label: 'อะไหล่ที่ใช้บ่อยสุด', value: top },
      ])}
      columns={columns}
      rows={rows}
      loading={loading}
      error={access.canTable ? loadError : null}
      emptyText={access.emptyText}
      onRetry={retryLoad}
      rowKey={(r, i) => `${r.doc}-${r.code}-${i}`}
      server={{ ...server, total }}
    />
  );
}
