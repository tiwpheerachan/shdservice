'use client';

import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { QUOTATION_STATUS_OPTIONS } from '@/data/options';
import { useManufacturers, useQuotationStatuses, useQuotationSummary, useReportRows } from '@/data/db';
import { useBrandModels } from '../use-brand-models';
import { baht, int } from '@/lib/utils';
import { daysAgo, today } from '@/lib/dates';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { reportExport, useReportColumns } from '../report-table';
import { modelsOfBrand } from '../report-specs';

const MODES = { 'แบบ Summary': 'quotation', 'แบบ Detail Part': 'quotation_detail' } as const;

export default function Page() {
  const {
    filters: f,
    setFilters: setF,
    table,
    pageArgs,
    server,
  } = useServerTable<ReportValues>({ from: daysAgo(30), to: today() });
  const report = MODES[f.mode as keyof typeof MODES] ?? 'quotation';
  const filters = {
    no: f.no,
    customer: f.customer,
    jobNo: f.jobNo?.trim(),
    imei: f.imei,
    warranty: f.warranty,
    jobFrom: f.jobFrom,
    jobTo: f.jobTo,
    brand: f.brand,
    model: f.model,
    from: f.from,
    to: f.to,
    type: f.type,
    agreedFrom: f.agreedFrom,
    agreedTo: f.agreedTo,
    status: f.status,
  };
  // KPIs: the special right Report alone; table + exports: the module's view too (useReportAccess)
  const access = useReportAccess(['Quotation'], 'Quotation');
  const { data: sum, error: sumError } = useQuotationSummary({ ...filters, q: table.q });
  const { data: STATUSES } = useQuotationStatuses();
  const { data: BRANDS, ...brandsLookup } = useManufacturers('exclude');
  const { MODELS, modelsLookup, wantModels } = useBrandModels();
  const { rows, total, loading, error, refetch } = useReportRows(report, { ...pageArgs, ...filters });
  const columns = useReportColumns(report);
  const S = sum[0];
  return (
    <ReportView
      title="รายงานการเสนอราคา"
      description="ใบเสนอราคาแบบสรุป (Summary) หรือรายการอะไหล่ทีละบรรทัด (Detail Part) — คอลัมน์และเงื่อนไขตามรายงานเดิม"
      filters={[
        { kind: 'select', key: 'mode', label: 'รูปแบบรายงาน', options: Object.keys(MODES) },
        { kind: 'text', key: 'no', label: 'เลขที่ใบเสนอราคา' },
        { kind: 'text', key: 'customer', label: 'ชื่อลูกค้า' },
        { kind: 'text', key: 'jobNo', label: 'เลขที่งานซ่อม', placeholder: 'J2612164' },
        { kind: 'text', key: 'imei', label: 'IMEI No.' },
        { kind: 'select', key: 'warranty', label: 'Warranty', options: ['ทั้งหมด', 'IN', 'OUT'] },
        { kind: 'date', key: 'jobFrom', label: 'วันที่เปิดงานซ่อม (ตั้งแต่)' },
        { kind: 'date', key: 'jobTo', label: 'วันที่เปิดงานซ่อม (ถึง)' },
        {
          kind: 'select',
          key: 'brand',
          label: 'ยี่ห้อ',
          options: ['ทั้งหมด', ...BRANDS.map((b) => b.name)],
          lookup: brandsLookup,
        },
        {
          kind: 'select',
          key: 'model',
          label: 'รุ่น',
          options: (d) => ['ทั้งหมด', ...modelsOfBrand(MODELS, d.brand).map((m) => m.name)],
          lookup: modelsLookup,
          onWant: wantModels,
        },
        { kind: 'date', key: 'from', label: 'วันที่สร้างใบเสนอราคา (ตั้งแต่)', value: f.from },
        { kind: 'date', key: 'to', label: 'วันที่สร้างใบเสนอราคา (ถึง)', value: f.to },
        { kind: 'select', key: 'type', label: 'ประเภท', options: ['ทั้งหมด', 'Type A (Normal)', 'Type B (VIP)'] },
        { kind: 'date', key: 'agreedFrom', label: 'วันที่ตกลงซ่อม (ตั้งแต่)' },
        { kind: 'date', key: 'agreedTo', label: 'วันที่ตกลงซ่อม (ถึง)' },
        {
          kind: 'select',
          key: 'status',
          label: 'สถานะ',
          options: ['ทั้งหมด', ...(STATUSES.length ? STATUSES.map((x) => x.name) : QUOTATION_STATUS_OPTIONS)],
        },
      ]}
      onApply={setF}
      onExport={
        access.canExport ? reportExport(`report_${report}`, { ...filters, q: table.q }, 'report-quotation') : undefined
      }
      kpis={kpisOr(sumError, [
        { label: 'ใบเสนอราคาทั้งหมด', value: int(S?.total ?? 0), tone: 'primary' },
        { label: 'ลูกค้าตกลงซ่อม', value: int(S?.agreed ?? 0), tone: 'success' },
        {
          label: 'มูลค่ารวม',
          value: baht(S?.amount ?? 0),
          sub: S?.cancelledAmount ? `ไม่รวมใบที่ยกเลิก ${baht(S.cancelledAmount)}` : undefined,
        },
        { label: 'มูลค่าที่ตกลง', value: baht(S?.agreedAmount ?? 0), tone: 'success' },
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
