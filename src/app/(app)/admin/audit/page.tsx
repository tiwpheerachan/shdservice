'use client';

import * as React from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useAuditPage, useAuditModules, type AuditRow } from '@/data/db';
import { exportXlsx } from '@/lib/api';
import { useServerTable } from '@/lib/use-server-table';
import { fieldLabel } from '@/lib/field-labels';
import { ExportButton } from '@/components/shared/export-button';

// action → badge tone / Thai label
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
  LOGIN: { label: 'เข้าสู่ระบบ', tone: 'neutral' },
  EXPORT: { label: 'ส่งออก Excel', tone: 'warning' },
};

type Filters = { from: string; to: string; user: string; module: string; action: string; key: string; q: string };
const NO_FILTER: Filters = { from: '', to: '', user: '', module: '', action: '', key: '', q: '' };

const fmt = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export default function AuditPage() {
  const { data: MODULES, ...modulesLookup } = useAuditModules();
  const { draft, setD, filters, apply, reset, narrowed, table, pageArgs, server } = useServerTable(NO_FILTER, {
    pageSize: 50,
  });
  const {
    rows,
    total,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useAuditPage({
    ...pageArgs,
    ...filters, // includes q (รายละเอียด / ชื่อผู้ใช้ free text)
  });
  const [detail, setDetail] = React.useState<AuditRow | null>(null);

  const columns: Column<AuditRow>[] = [
    { key: 'at', header: 'เวลา', width: '150px', cell: (r) => <span className="num text-xs">{r.at}</span> },
    {
      key: 'user',
      header: 'ผู้ใช้',
      width: '180px',
      cell: (r) => <span className="line-clamp-1">{r.user || '—'}</span>,
    },
    {
      key: 'action',
      header: 'การกระทำ',
      width: '120px',
      cell: (r) => (
        <Badge tone={ACTION[r.action]?.tone ?? 'neutral'} dot>
          {ACTION[r.action]?.label ?? r.action}
        </Badge>
      ),
    },
    { key: 'module', header: 'โมดูล', hideBelow: 'lg', width: '160px' },
    {
      key: 'key',
      header: 'เลขที่ / รหัส',
      width: '130px',
      cell: (r) => <span className="num font-medium">{r.key}</span>,
    },
    {
      key: 'summary',
      header: 'รายละเอียด',
      sortable: false,
      cell: (r) => <span className="line-clamp-2">{r.summary}</span>,
    },
    {
      key: 'changes',
      header: 'ค่าที่เปลี่ยน',
      sortable: false,
      width: '110px',
      align: 'center',
      cell: (r) =>
        r.changes ? (
          <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
            {Object.keys(r.changes).length} ฟิลด์
          </Button>
        ) : (
          <span className="text-muted-foreground">—</span>
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
          <Input placeholder="ชื่อ หรือ user id" value={draft.user} onChange={(e) => setD('user', e.target.value)} />
        </Field>
        <Field label="โมดูล" lookup={modulesLookup}>
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.module}
            onChange={(v) => setD('module', v)}
            options={strOptions(MODULES)}
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
            value={draft.key}
            onChange={(e) => setD('key', e.target.value.trim())}
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
        title={detail ? `${ACTION[detail.action]?.label ?? detail.action} · ${detail.key}` : ''}
        description={detail ? `${detail.at} · ${detail.user || '—'} · ${detail.summary}` : undefined}
        size="lg"
      >
        {detail?.changes && (
          <div className="overflow-hidden rounded-lg border border-border">
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
                    <td className="px-3 py-2 text-muted-foreground break-all">{fmt(a)}</td>
                    <td className="px-3 py-2 break-all">{fmt(b)}</td>
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
