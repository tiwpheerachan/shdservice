'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect } from '@/components/shared/search-select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useApi, useRoles } from '@/data/db';
import { useServerTable } from '@/lib/use-server-table';
import { NO_FILTER, PAGE_SIZE, listKey } from './filters';
import { moduleLabel } from '@/lib/modules';
import { exportXlsx } from '@/lib/api';
import { ExportButton } from '@/components/shared/export-button';
import { Identity } from '../audit/identity';

/** GET /api/audit/security (src/server/contract/audit.ts SecurityRow) */
type SecurityRow = {
  id: string;
  at: string;
  event: string;
  result: string;
  user: string;
  email: string | null;
  role: string | null;
  department: string | null;
  module: string | null;
  permission: string | null;
  entity: string | null;
  entityId: string | null;
  no: string | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
  detail: Record<string, unknown> | null;
};

const EVENT: Record<string, { label: string; tone: Tone }> = {
  LOGIN: { label: 'เข้าสู่ระบบ', tone: 'success' },
  LOGIN_FAILED: { label: 'เข้าสู่ระบบไม่สำเร็จ', tone: 'danger' },
  LOGOUT: { label: 'ออกจากระบบ', tone: 'neutral' },
  DENIED: { label: 'ถูกปฏิเสธ', tone: 'danger' },
  ROLE_CHANGE: { label: 'เปลี่ยนตำแหน่ง', tone: 'warning' },
  PERMISSION_CHANGE: { label: 'แก้สิทธิ์', tone: 'warning' },
  USER_STATUS: { label: 'สถานะผู้ใช้', tone: 'warning' },
  EXPORT: { label: 'ส่งออก', tone: 'info' },
  PRINT: { label: 'พิมพ์', tone: 'info' },
};
const RESULT: Record<string, { label: string; tone: Tone }> = {
  OK: { label: 'สำเร็จ', tone: 'success' },
  DENIED: { label: 'ปฏิเสธ', tone: 'danger' },
  FAILED: { label: 'ไม่สำเร็จ', tone: 'danger' },
};
/** the line a row says: its summary, or why it was refused */
const what = (r: SecurityRow) => {
  const d = r.detail ?? {};
  return String(d.summary ?? d.reason ?? d.email ?? '');
};

/** ประวัติความปลอดภัย — System Admin only (/admin is admin-only: src/lib/modules.ts ADMIN_ONLY_PREFIXES; the API checks too) */
export default function SecurityLogPage() {
  const { data: ROLES, ...rolesLookup } = useRoles();
  const { draft, setD, filters, apply, reset, narrowed, table, pageArgs, server } = useServerTable(NO_FILTER, {
    pageSize: PAGE_SIZE,
  });
  const { data, loading, error, mutate } = useApi<{ rows: SecurityRow[]; total: number }>(
    listKey({ ...pageArgs, ...filters }),
    { keepPrevious: true },
  );
  const [detail, setDetail] = React.useState<SecurityRow | null>(null);

  const columns: Column<SecurityRow>[] = [
    { key: 'at', header: 'เวลา', cell: (r) => <span className="num text-xs">{r.at}</span> },
    { key: 'user', header: 'ผู้ใช้', cell: (r) => <span className="line-clamp-1">{r.user || r.email || '—'}</span> },
    { key: 'role', header: 'ตำแหน่ง', hideBelow: 'lg', width: '130px', cell: (r) => r.role || '—' },
    {
      key: 'event',
      header: 'เหตุการณ์',
      width: '150px',
      cell: (r) => (
        <Badge tone={EVENT[r.event]?.tone ?? 'neutral'} dot>
          {EVENT[r.event]?.label ?? r.event}
        </Badge>
      ),
    },
    {
      key: 'result',
      header: 'ผล',
      width: '90px',
      cell: (r) => <Badge tone={RESULT[r.result]?.tone ?? 'neutral'}>{RESULT[r.result]?.label ?? r.result}</Badge>,
    },
    {
      key: 'module',
      header: 'โมดูล',
      sortable: false,
      hideBelow: 'lg',
      cell: (r) => (r.module ? moduleLabel(r.module) : '—'),
    },
    {
      key: 'summary',
      header: 'รายละเอียด',
      sortable: false,
      hideBelow: 'sm',
      cell: (r) => <span className="line-clamp-2">{what(r) || r.no || '—'}</span>,
    },
    {
      key: 'ip',
      header: 'IP',
      hideBelow: 'lg',
      width: '120px',
      cell: (r) => <span className="num text-xs">{r.ip || '—'}</span>,
    },
    {
      key: 'detail',
      header: '',
      sortable: false,
      width: '70px',
      align: 'center',
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
          ดู
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ประวัติความปลอดภัย (Security Log)"
        description="ข้อมูลระบบ » การเข้า / ออกจากระบบ การถูกปฏิเสธ การเปลี่ยนตำแหน่ง สิทธิ์ และสถานะผู้ใช้ การส่งออกและพิมพ์ — แก้หรือลบไม่ได้"
        actions={<ExportButton run={() => exportXlsx('security_log', { ...filters })} />}
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="วันที่ (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD('from', e.target.value)} />
        </Field>
        <Field label="วันที่ (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD('to', e.target.value)} />
        </Field>
        <Field label="ผู้ใช้">
          <Input placeholder="ชื่อ หรืออีเมล" value={draft.user} onChange={(e) => setD('user', e.target.value)} />
        </Field>
        <Field label="ตำแหน่ง (ขณะนั้น)" lookup={rolesLookup}>
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.role}
            onChange={(v) => setD('role', v)}
            options={ROLES.map((r) => ({ value: r, label: r }))}
          />
        </Field>
        <Field label="เหตุการณ์">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.event}
            onChange={(v) => setD('event', v)}
            options={Object.entries(EVENT).map(([k, v]) => ({ value: k, label: v.label, sub: k }))}
          />
        </Field>
        <Field label="ผล">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.result}
            onChange={(v) => setD('result', v)}
            options={Object.entries(RESULT).map(([k, v]) => ({ value: k, label: v.label, sub: k }))}
          />
        </Field>
        <Field label="เลขที่">
          <Input className="num" value={draft.no} onChange={(e) => setD('no', e.target.value.trim())} />
        </Field>
        <Field label="IP">
          <Input className="num" value={draft.ip} onChange={(e) => setD('ip', e.target.value.trim())} />
        </Field>
        <Field label="คำค้น">
          <Input placeholder="ชื่อ อีเมล หรือข้อความ" value={draft.q} onChange={(e) => setD('q', e.target.value)} />
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={error ? [] : (data?.rows ?? [])}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={() => void mutate()}
        pageSize={table.pageSize}
        server={{ ...server, total: error ? 0 : (data?.total ?? 0) }}
        emptyText="ยังไม่มีประวัติในช่วงที่เลือก"
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail
            ? `${EVENT[detail.event]?.label ?? detail.event} · ${RESULT[detail.result]?.label ?? detail.result}`
            : ''
        }
        description={detail ? `${detail.at} · ${what(detail)}` : undefined}
        size="lg"
      >
        {detail && <Identity r={detail} />}
        {detail?.detail && (
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
            {JSON.stringify(detail.detail, null, 2)}
          </pre>
        )}
      </Modal>
    </>
  );
}
