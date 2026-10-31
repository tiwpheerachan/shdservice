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
import { useApi, useAuditModules, useRoles, type AuditRow } from '@/data/db';
import { Identity, type AuditLogRow } from './identity';
import { exportXlsx } from '@/lib/api';
import { useServerTable } from '@/lib/use-server-table';
import { NO_FILTER, PAGE_SIZE, listKey } from './filters';
import { fieldLabel, fieldValue } from '@/lib/field-labels';
import { moduleLabel } from '@/lib/modules';
import { ExportButton } from '@/components/shared/export-button';
import { WithEmails } from '@/components/shared/email';
/** the server maps rows written under pre-0006 entity names (audit.ts LEGACY_ENTITY) */
const isSaleOrder = (entity: string) => entity === 'sale_order';
/** the server reads a legacy sale-order deny / send-back (logged APPROVE) as STATUS */
const actionOf = (r: Pick<AuditRow, 'action'>) => r.action;
/** a sale order's DELETE is its cancel */
const actionLabel = (r: Pick<AuditRow, 'action' | 'entity' | 'changes'>) =>
  r.action === 'DELETE' && isSaleOrder(r.entity) ? 'ยกเลิก' : (ACTION[actionOf(r)]?.label ?? r.action);

const ACTION: Record<string, { label: string; tone: Tone }> = {
  CREATE: { label: 'เพิ่ม', tone: 'success' },
  UPDATE: { label: 'แก้ไข', tone: 'info' },
  DELETE: { label: 'ลบ', tone: 'danger' },
  STATUS: { label: 'เปลี่ยนสถานะ', tone: 'warning' },
  APPROVE: { label: 'อนุมัติ', tone: 'primary' },
  ASSIGN: { label: 'มอบหมาย', tone: 'info' },
  ISSUE: { label: 'จ่ายสต๊อก', tone: 'warning' },
  RECEIVE: { label: 'รับเข้า', tone: 'success' },
  RETURN: { label: 'รับคืน', tone: 'success' },
  UPLOAD: { label: 'แนบไฟล์', tone: 'neutral' },
  // legacy rows only — sign-in / export / print are logged to security_log, not shown here
  LOGIN: { label: 'เข้าสู่ระบบ', tone: 'neutral' },
  LOGIN_FAILED: { label: 'เข้าสู่ระบบไม่สำเร็จ', tone: 'danger' },
  EXPORT: { label: 'ส่งออก Excel', tone: 'warning' },
};

export default function AuditPage() {
  const { data: MODULES, ...modulesLookup } = useAuditModules();
  const { data: ROLES, ...rolesLookup } = useRoles();
  const { draft, setD, filters, apply, reset, narrowed, table, pageArgs, server } = useServerTable(NO_FILTER, {
    pageSize: PAGE_SIZE,
  });
  const {
    data,
    loading,
    error: loadError,
    mutate,
  } = useApi<{ rows: AuditLogRow[]; total: number }>(listKey({ ...pageArgs, ...filters }), {
    keepPrevious: true,
  });
  const rows = loadError ? [] : (data?.rows ?? []);
  const total = loadError ? 0 : (data?.total ?? 0);
  const retryLoad = () => void mutate();
  const [detail, setDetail] = React.useState<AuditLogRow | null>(null);

  const columns: Column<AuditLogRow>[] = [
    { key: 'at', header: 'เวลา', cell: (r) => <span className="num text-xs">{r.at}</span> },
    {
      key: 'user',
      header: 'ผู้ใช้',
      cell: (r) => <span className="line-clamp-1">{r.user ? <WithEmails text={r.user} /> : '—'}</span>,
    },
    { key: 'role', header: 'ตำแหน่ง', hideBelow: 'lg', width: '130px', cell: (r) => r.role || '—' },
    {
      key: 'action',
      header: 'การกระทำ',
      width: '120px',
      cell: (r) => (
        <Badge tone={ACTION[actionOf(r)]?.tone ?? 'neutral'} dot>
          {actionLabel(r)}
        </Badge>
      ),
    },
    { key: 'module', header: 'โมดูล', hideBelow: 'lg', width: '160px', cell: (r) => moduleLabel(r.module) },
    {
      key: 'key',
      header: 'เลขที่ / รหัส',
      width: '130px',
      hideBelow: 'sm', // phones: เวลา / ผู้ใช้ / การกระทำ only, or the user name gets squeezed
      cell: (r) => (
        <span className="num font-medium">
          <WithEmails text={r.no || r.key} />
        </span>
      ),
    },
    {
      key: 'summary',
      header: 'รายละเอียด',
      sortable: false,
      hideBelow: 'sm',
      cell: (r) => (
        <span className="line-clamp-2">
          <WithEmails text={r.summary} />
        </span>
      ),
    },
    {
      key: 'changes',
      header: 'ค่าที่เปลี่ยน',
      sortable: false,
      hideBelow: 'sm',
      width: '110px',
      align: 'center',
      cell: (r) => (
        <Button variant="ghost" size="sm" data-changes={r.changes ? '' : undefined} onClick={() => setDetail(r)}>
          {r.changes ? `${Object.keys(r.changes).length} ฟิลด์` : 'ดู'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ประวัติการใช้งาน (Audit Log)"
        description="ข้อมูลระบบ » ใครทำอะไร กับรายการไหน เมื่อไร — บันทึกทุกการเพิ่ม/แก้ไข/ลบ/เปลี่ยนสถานะ/อนุมัติ/จ่ายสต๊อก และการเข้าสู่ระบบ"
        actions={<ExportButton run={() => exportXlsx('audit_log', { ...filters })} />}
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
        <Field label="โมดูล" lookup={modulesLookup}>
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.module}
            onChange={(v) => setD('module', v)}
            options={MODULES.map((m) => ({ value: m, label: moduleLabel(m), sub: m }))}
          />
        </Field>
        <Field label="การกระทำ">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.action}
            onChange={(v) => setD('action', v)}
            options={Object.entries(ACTION).map(([k, v]) => ({ value: k, label: v.label, sub: k }))}
          />
        </Field>
        <Field label="เลขที่ / รหัส">
          <Input
            placeholder="J2612088 / Q2600462 / P00012"
            className="num"
            value={draft.no}
            onChange={(e) => setD('no', e.target.value.trim())}
          />
        </Field>
        <Field label="ตาราง">
          <Input
            placeholder="job / quotation / customer"
            value={draft.entity}
            onChange={(e) => setD('entity', e.target.value.trim())}
          />
        </Field>
        <Field label="รายละเอียด / ชื่อผู้ใช้">
          <Input
            placeholder="ข้อความในรายละเอียด หรือชื่อผู้ใช้"
            value={draft.q}
            onChange={(e) => setD('q', e.target.value)}
          />
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={loading}
        error={loadError}
        onRetry={retryLoad}
        // the table's own page size must match the first query's, or it asks for 25 right after the 50
        pageSize={table.pageSize}
        server={{ ...server, total }}
        emptyText="ยังไม่มีประวัติในช่วงที่เลือก"
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${actionLabel(detail)} · ${detail.no || detail.key}` : ''}
        description={detail ? `${detail.at} · ${detail.user || '—'} · ${detail.summary}` : undefined}
        size="lg"
      >
        {detail && <Identity r={detail} />}
        {detail?.reason && <p className="mt-3 text-sm">เหตุผล: {detail.reason}</p>}
        {detail?.changes && (
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">ฟิลด์</th>
                  <th className="px-3 py-2 text-left">ค่าเดิม</th>
                  <th className="px-3 py-2 text-left">ค่าใหม่</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(detail.changes).map(([k, [a, b]]) => (
                  <tr key={k} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2 font-medium" title={k}>
                      {fieldLabel(k)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground break-all">{fieldValue(a)}</td>
                    <td className="px-3 py-2 break-all">{fieldValue(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
