'use client';

import * as React from 'react';
import { ReportView, type ReportFilter, type ReportValues } from '@/components/shared/report-view';
import {
  useJobStatuses,
  useJobSummary,
  useJobTypeDetails,
  useJobTypes,
  useManufacturers,
  useModels,
  useReportRows,
  useStaff,
  type JobSummary,
} from '@/data/db';
import { useServerTable } from '@/lib/use-server-table';
import { kpisOr, useReportAccess, JOB_SCREENS } from './report-access';
import { reportExport, useReportColumns } from './report-table';
import {
  JOB_BOUNCE,
  JOB_STATUS_GROUPS as GROUPS,
  JOB_WARRANTY as WARRANTY,
  jobReportQuery,
  modelsOfBrand,
  type ReportKey,
} from './report-specs';

type Kpi = Parameters<typeof kpisOr>[1][number];

/**
 * รายงานการเปิดงาน / การซ่อม / การปิดงาน: the legacy filters (each AND-ed), the KPIs over the whole range, and the
 * legacy row-level table — the same query for the screen, Excel, Word and PDF.
 */
export function JobReport({
  report,
  title,
  description,
  start,
  dates,
  fixed = {},
  extra = [],
  statusGroup,
  kpis,
  file,
}: {
  report: ReportKey;
  title: string;
  description: string;
  /** the opening filters (date range …) */
  start: ReportValues;
  /** the date the range applies to: label → dateBy (one entry = no picker) */
  dates: Record<string, string>;
  /** sent with every query (e.g. close: statusGroup=Finished) */
  fixed?: Record<string, string>;
  /** the report's own filters beyond the legacy ones (kept from the earlier screen) — each key sent as chosen */
  extra?: ReportFilter[];
  /** only this group's statuses in the status filter (close: Finished), no group entries */
  statusGroup?: string;
  kpis: (s: JobSummary | undefined, f: ReportValues) => Kpi[];
  file: string;
}) {
  const { filters: f, setFilters: setF, table, pageArgs, server } = useServerTable<ReportValues>(start);
  const { data: STAFF, ...staffLookup } = useStaff();
  const { data: ENGINEERS, ...engineersLookup } = useStaff('engineer');
  const { data: STATUSES, ...statusesLookup } = useJobStatuses();
  const { data: JOB_TYPES, ...jobTypesLookup } = useJobTypes();
  const { data: DETAILS, ...detailsLookup } = useJobTypeDetails();
  const { data: BRANDS, ...brandsLookup } = useManufacturers('exclude');
  const { data: MODELS, ...modelsLookup } = useModels('exclude');
  const dateKeys = Object.keys(dates);
  const dateLabel = dateKeys.length === 1 ? dateKeys[0] : 'วันที่';
  const query = jobReportQuery(
    { ...f, dateBy: dates[f.dateBy ?? ''] ?? Object.values(dates)[0] ?? '' },
    {
      // by id: names carry stray spaces and may repeat
      staff: (n) => [...STAFF, ...ENGINEERS].find((s) => s.name === n)?.id,
      status: (n) => STATUSES.find((s) => s.name.trim() === n)?.id,
    },
    { ...Object.fromEntries(extra.map((x) => [x.key, f[x.key ?? ''] ?? ''])), ...fixed },
  );
  // KPIs: the special right Report alone; table + exports: the module's view too (useReportAccess)
  const access = useReportAccess(JOB_SCREENS, 'Job Management');
  const { data: sum, error: sumError } = useJobSummary({ ...query, q: table.q });
  const { rows, total, loading, error, refetch } = useReportRows(report, { ...pageArgs, ...query });
  const columns = useReportColumns(report);
  const statuses = STATUSES.filter((s) => s.id !== 0 && (!statusGroup || s.group === statusGroup)).map((s) =>
    s.name.trim(),
  );
  const filters: ReportFilter[] = [
    ...(dateKeys.length > 1
      ? [{ kind: 'select' as const, key: 'dateBy', label: 'ค้นหาตามวันที่', options: dateKeys }]
      : []),
    { kind: 'date', key: 'from', label: `${dateLabel} (ตั้งแต่)`, value: f.from },
    { kind: 'date', key: 'to', label: `${dateLabel} (ถึง)`, value: f.to },
    { kind: 'text', key: 'no', label: 'เลขที่งาน', placeholder: 'J2612164' },
    { kind: 'text', key: 'customerCode', label: 'รหัสลูกค้า', placeholder: 'C00001' },
    { kind: 'text', key: 'imei', label: 'IMEI No. / Serial' },
    { kind: 'text', key: 'tracking', label: 'เลขพัสดุจากลูกค้า' },
    { kind: 'select', key: 'warranty', label: 'Warranty', options: ['ทั้งหมด', ...Object.keys(WARRANTY)] },
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
    },
    { kind: 'select', key: 'bounce', label: 'งานซ่อมซ้ำ', options: ['ทั้งหมด', ...Object.keys(JOB_BOUNCE)] },
    {
      kind: 'select',
      key: 'type',
      label: 'ประเภทงานซ่อม',
      options: ['ทั้งหมด', ...JOB_TYPES.map((j) => j.name)],
      lookup: jobTypesLookup,
    },
    { kind: 'select', key: 'typeDetail', label: 'งานย่อย', options: ['ทั้งหมด', ...DETAILS], lookup: detailsLookup },
    { kind: 'select', key: 'cost', label: 'ค่าใช้จ่าย', options: ['ทั้งหมด', 'มีค่าใช้จ่าย', 'ไม่มีค่าใช้จ่าย'] },
    {
      kind: 'select',
      key: 'createdBy',
      label: 'พนง.เปิดงาน',
      options: ['ทั้งหมด', ...STAFF.map((s) => s.name)],
      lookup: staffLookup,
    },
    {
      kind: 'select',
      key: 'engineer',
      label: 'พนง.ช่างซ่อม',
      options: ['ทั้งหมด', ...ENGINEERS.map((s) => s.name)],
      lookup: engineersLookup,
    },
    {
      kind: 'select',
      key: 'status',
      label: 'สถานะงาน',
      options: ['ทั้งหมด', ...(statusGroup ? [] : Object.keys(GROUPS)), ...statuses],
      lookup: statusesLookup,
    },
    ...extra,
  ];
  return (
    <ReportView
      title={title}
      description={description}
      filters={filters}
      onApply={setF}
      onExport={access.canExport ? reportExport(`report_${report}`, { ...query, q: table.q }, file) : undefined}
      kpis={kpisOr(sumError, kpis(sum[0], f))}
      columns={columns}
      rows={rows}
      loading={loading}
      error={access.canTable ? error : null}
      emptyText={access.emptyText}
      onRetry={refetch}
      rowKey={(r) => String(r.no)}
      server={{ ...server, total }}
    />
  );
}
