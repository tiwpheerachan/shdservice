'use client';

import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { useReportRows, useSaleOrderSummary, useStaff } from '@/data/db';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { SO_TONE as TONE } from '@/components/shared/sale-order-form';
import { reportExport, useReportColumns } from '../report-table';

const MODES = { 'แบบ Grouping by SO': 'sale_order', 'แบบ Detail Items Part': 'sale_order_detail' } as const;

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today() });
  const report = MODES[f.mode as keyof typeof MODES] ?? 'sale_order';
  const { data: STAFF, ...staffLookup } = useStaff();
  // สร้างโดย = who keyed the order in (document_create_by) — by id: names carry stray spaces and may repeat
  const createdBy = STAFF.find((s) => s.name === f.createdBy)?.id;
  const filters = {
    no: f.no,
    createdBy: createdBy ? String(createdBy) : '',
    from: f.from,
    to: f.to,
    customer: f.customer,
    approve: f.approve,
    code: f.code,
  };
  // KPIs: the special right Report alone; table + exports: the module's view too (useReportAccess)
  const access = useReportAccess(['Sale Order', 'Product Pick Stock'], 'Sale Order');
  const { data: sum, error: sumError } = useSaleOrderSummary({ ...filters, q: table.q });
  const { rows, total, loading, error, refetch } = useReportRows(report, { ...pageArgs, ...filters });
  const columns = useReportColumns(report);
  const S = sum[0];
  return (
    <ReportView
      title="รายงานการขาย"
      description="ใบสั่งขายแบบรวมต่อใบ (Grouping by SO) หรือรายการสินค้าทีละบรรทัด (Detail Items) — คอลัมน์และเงื่อนไขตามรายงานเดิม"
      filters={[
        { kind: 'select', key: 'mode', label: 'รูปแบบรายงาน', options: Object.keys(MODES) },
        { kind: 'text', key: 'no', label: 'เลขที่ SO' },
        {
          kind: 'select',
          key: 'createdBy',
          label: 'สร้างโดย',
          options: ['ทั้งหมด', ...STAFF.map((u) => u.name)],
          lookup: staffLookup,
        },
        { kind: 'date', key: 'from', label: 'วันที่สั่งขาย (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่สั่งขาย (ถึง)', value: f.to },
        { kind: 'text', key: 'customer', label: 'รหัส / ชื่อลูกค้า' },
        { kind: 'select', key: 'approve', label: 'สถานะอนุมัติ', options: ['ทั้งหมด', ...Object.keys(TONE)] },
        { kind: 'text', key: 'code', label: 'รายการสินค้า (รหัส)', placeholder: 'P02534' },
      ]}
      onApply={setF}
      onExport={
        access.canExport ? reportExport(`report_${report}`, { ...filters, q: table.q }, 'report-sale-order') : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'ใบสั่งขายทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
        { label: 'อนุมัติแล้ว', value: int(S?.approved ?? 0), tone: 'success' },
        {
          label: 'ยอดขายรวม (อนุมัติแล้ว)',
          value: baht(S?.amount ?? 0),
          sub: S?.notApprovedAmount ? `ไม่รวมที่ยังไม่อนุมัติ/ถูกปฏิเสธ ${baht(S.notApprovedAmount)}` : undefined,
        },
        { label: 'ยอดเฉลี่ย/ใบ (อนุมัติแล้ว)', value: baht(S?.avg ?? 0) },
      ])}
      columns={columns}
      rows={rows}
      loading={loading}
      error={access.canTable ? error : null}
      emptyText={access.emptyText}
      onRetry={refetch}
      rowKey={(r, i) => `${r.no}-${i}`}
      server={{ ...server, total }}
    />
  );
}
