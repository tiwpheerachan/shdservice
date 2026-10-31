'use client';

import { ReportView, type ReportValues } from '@/components/shared/report-view';
import { useProductStats, useCategories, useManufacturers, useColors, useReportRows } from '@/data/db';
import { useBrandModels } from '../use-brand-models';
import { baht, int } from '@/lib/utils';
import { kpisOr, useReportAccess } from '../report-access';
import { useServerTable } from '@/lib/use-server-table';
import { reportExport, useReportColumns } from '../report-table';
import { modelsOfBrand, ONHAND_ALL_COLORS } from '../report-specs';

const STOCK: Record<string, string> = { 'มีของ (เกิน 3 ชิ้น)': 'in', 'ใกล้หมด (1–3 ชิ้น)': 'low', หมดสต๊อก: 'out' };
// not "ทั้งหมด": ReportView reads that as left out (→ ใช้งาน)
const STATUS: Record<string, string> = { ใช้งาน: 'Active', ไม่ใช้งาน: 'Inactive', ทุกสถานะ: '' };

export default function Page() {
  const { data: CATEGORIES, ...categoriesLookup } = useCategories();
  const { data: MANUFACTURERS, ...brandsLookup } = useManufacturers('exclude'); // filter: INACTIVE brands still own products
  const { data: COLORS, ...colorsLookup } = useColors('exclude');
  const { MODELS, modelsLookup, wantModels } = useBrandModels();
  const { filters: f, setFilters: setF, table, pageArgs, server } = useServerTable<ReportValues>({});
  const modelLabel = (m: { code: string; name: string }) => `${m.name} · ${m.code}`;
  // ACTIVE parts unless สถานะ says otherwise
  const filters = {
    sysCode: f.sysCode,
    mfgCode: f.mfgCode,
    name: f.name,
    status: STATUS[f.status ?? ''] ?? 'Active',
    category: f.category,
    brand: f.brand,
    model: MODELS.find((m) => modelLabel(m) === f.model)?.code ?? '',
    stock: STOCK[f.stock ?? ''] ?? '',
  };
  const report = { ...filters, color: f.color, allColors: f.color ? (ONHAND_ALL_COLORS[f.allColors ?? ''] ?? '') : '' };
  // KPIs: the special right Report alone; table: Report too, exports: Product (useReportAccess)
  const access = useReportAccess(null, 'Product');
  const { data: sum, error: sumError } = useProductStats({ ...filters, q: table.q });
  const { rows, total, loading, error, refetch } = useReportRows('product_onhand', { ...pageArgs, ...report });
  const columns = useReportColumns('product_onhand');
  const S = sum[0];
  return (
    <ReportView
      title="รายงานอะไหล่คงเหลือ"
      description="ยอดคงเหลือปัจจุบัน (รับเข้า / ใช้ไป / จอง / คงเหลือ) ราคา และที่เก็บ — คอลัมน์และเงื่อนไขตามรายงานเดิม"
      filters={[
        { kind: 'text', key: 'sysCode', label: 'รหัส (ระบบ)', placeholder: 'P02534' },
        { kind: 'text', key: 'mfgCode', label: 'รหัส (ผู้ผลิต)' },
        { kind: 'text', key: 'name', label: 'ชื่ออะไหล่' },
        { kind: 'select', key: 'status', label: 'สถานะ', options: Object.keys(STATUS) },
        {
          kind: 'select',
          key: 'category',
          label: 'หมวดหมู่',
          options: ['ทั้งหมด', ...CATEGORIES.map((c) => c.name)],
          lookup: categoriesLookup,
        },
        {
          kind: 'select',
          key: 'brand',
          label: 'ยี่ห้อ',
          options: ['ทั้งหมด', ...MANUFACTURERS.map((m) => m.name)],
          lookup: brandsLookup,
        },
        {
          kind: 'select',
          key: 'model',
          label: 'รุ่น',
          options: (d) => ['ทั้งหมด', ...modelsOfBrand(MODELS, d.brand).map(modelLabel)],
          onWant: wantModels,
          lookup: modelsLookup,
        },
        {
          kind: 'select',
          key: 'color',
          label: 'สี',
          options: ['ทั้งหมด', ...COLORS.map((c) => c.name)],
          lookup: colorsLookup,
        },
        {
          kind: 'select',
          key: 'allColors',
          label: 'อะไหล่ที่ใช้ได้กับทุกสี (เมื่อเลือกสี)',
          options: Object.keys(ONHAND_ALL_COLORS), // ไม่รวม first: the legacy checkbox starts unticked
        },
        { kind: 'select', key: 'stock', label: 'สถานะสต๊อก', options: ['ทั้งหมด', ...Object.keys(STOCK)] },
      ]}
      onApply={setF}
      onExport={
        access.canExport
          ? reportExport('report_product_onhand', { ...report, q: table.q }, 'report-product-onhand')
          : undefined
      }
      kpis={kpisOr(sumError, [
        // productStats sums max(0, คงเหลือ) — a negative line in the table is not subtracted here
        {
          label: 'จำนวนคงเหลือรวม',
          value: `${int(S?.qty ?? 0)} ชิ้น`,
          tone: 'primary',
          sub: 'ไม่นับรายการที่คงเหลือติดลบ · ไม่กรองตามสี',
        },
        {
          label: 'มูลค่าสต๊อกรวม',
          value: baht(S?.value ?? 0),
          tone: 'success',
          sub: S?.noPrice ? `${int(S.noPrice)} รายการมีสต๊อกแต่ไม่มีราคา (ไม่รวมในมูลค่า)` : undefined,
        },
        { label: 'ใกล้หมด (1–3 ชิ้น)', value: int(S?.low ?? 0), tone: 'warning' },
        { label: 'หมดสต๊อก', value: int(S?.out ?? 0), tone: 'danger' },
      ])}
      columns={columns}
      rows={rows}
      loading={loading}
      error={access.canTable ? error : null}
      emptyText={access.emptyText}
      onRetry={refetch}
      rowKey={(r) => String(r.code || r.idx)}
      server={{ ...server, total }}
    />
  );
}
