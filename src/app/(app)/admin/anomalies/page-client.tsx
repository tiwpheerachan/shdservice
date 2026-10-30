'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable, type Column, type ServerTableState } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { useApi } from '@/data/db';
import { FIRST_PAGE } from '@/data/keys';
import { exportXlsx, qs } from '@/lib/api';
import { ExportButton } from '@/components/shared/export-button';
import type { Anomaly, AnomalyPage } from '@/server/services/anomalies';

const PAGE_SIZE = 50;

/**
 * ค่าที่ไม่สมเหตุสมผล — the bell's System Admin section in full, one server page at a time (GET
 * /api/alerts/anomalies/list: category filtered in SQL, ≤ 100 rows). Report only: each row links to its record.
 * ponytail: no Excel export — the export pipeline (server/export.ts) has no resource for it; add one there if asked.
 */
export default function AnomaliesPage({ category: initial }: { category: string }) {
  const [category, setCategory] = React.useState(initial);
  const [table, setTable] = React.useState<ServerTableState>({ ...FIRST_PAGE, pageSize: PAGE_SIZE });
  const { data, error, loading, mutate } = useApi<AnomalyPage>(
    `/api/alerts/anomalies/list${qs({ page: table.page, pageSize: table.pageSize, category })}`,
    { keepPrevious: true },
  );
  const labels = new Map(data?.categories.map((c) => [c.key as string, c.label]));

  const columns: Column<Anomaly>[] = [
    {
      key: 'category',
      header: 'ประเภท',
      width: '240px',
      sortable: false,
      cell: (r) => labels.get(r.category) ?? r.category,
    },
    {
      key: 'ref',
      header: 'เลขที่ / รหัส',
      width: '150px',
      sortable: false,
      cell: (r) => (
        <Link prefetch={false} href={r.href} className="num font-medium text-primary hover:underline">
          {r.ref || '—'}
        </Link>
      ),
    },
    { key: 'message', header: 'รายละเอียด', sortable: false, cell: (r) => r.message },
  ];

  return (
    <>
      <PageHeader
        title="ค่าที่ไม่สมเหตุสมผล"
        description="ยอดเงิน/จำนวนที่บันทึกไว้ไม่ตรงกับสูตรของระบบ — แจ้งเพื่อตรวจสอบเท่านั้น ระบบไม่แก้ค่าให้ (ตรวจใหม่ทุก 5 นาที)"
        actions={<ExportButton run={() => exportXlsx('anomalies', category ? { category } : {})} />}
      />
      <div className="mb-3 max-w-sm">
        <Field label="ประเภท">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">ทั้งหมด ({(data?.total ?? 0).toLocaleString('en-US')})</option>
            {data?.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count.toLocaleString('en-US')})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <DataTable
        label="ค่าที่ไม่สมเหตุสมผล"
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r, i) => `${r.category}-${r.href}-${i}`}
        searchable={false}
        pageSize={PAGE_SIZE}
        server={{ total: data?.matched ?? 0, onChange: setTable, resetKey: category }}
        loading={loading}
        error={error}
        onRetry={() => void mutate()}
        emptyText="ไม่พบค่าที่ไม่สมเหตุสมผล"
        narrowed={!!category}
        onClearFilters={() => setCategory('')}
      />
    </>
  );
}
