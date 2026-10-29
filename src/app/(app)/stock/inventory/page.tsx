'use client';

import * as React from 'react';
import { Eye } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataTable, type Column, TableScroll } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { STOCK_MOVE_TYPES } from '@/data/options';
import type { Movement } from '@/data/types';
import { useApi, useMovementsPage } from '@/data/db';
import { int } from '@/lib/utils';
import { useServerTable } from '@/lib/use-server-table';
import { exportXlsx } from '@/lib/api';
import { ExportButton } from '@/components/shared/export-button';

type LineRow = { code: string; name: string; qty: number; unit: string; supplier: string; ref: string };
type Filters = { from: string; to: string; type: string; code: string; doc: string; ref: string };
const NO_FILTER: Filters = { from: '', to: '', type: '', code: '', doc: '', ref: '' };

const DOC_TYPES = STOCK_MOVE_TYPES;

function typeTone(type: string): Tone {
  if (/รับเข้า|รับคืน/.test(type)) return 'success';
  if (/จ่าย|เบิก/.test(type)) return 'warning';
  if (/โอน/.test(type)) return 'info';
  return 'neutral';
}

export default function InventoryPage() {
  const { push } = useToast();
  // inventory_hd (20k rows) — server-side paging; filters + table search run on the server
  const { draft, setD, filters, apply, reset, narrowed, table, pageArgs, server } = useServerTable(NO_FILTER);
  const {
    rows: MOVEMENTS,
    total,
    loading,
    error: loadError,
    refetch: retryLoad,
  } = useMovementsPage({
    ...pageArgs,
    from: filters.from,
    to: filters.to,
    type: filters.type,
    code: filters.code,
    doc: filters.doc,
    ref: filters.ref,
  });

  const [viewDoc, setViewDoc] = React.useState<Movement | null>(null);
  // the lines of the document being viewed — read fresh each time a document is opened
  const docLines = useApi<{ rows: LineRow[] }>(
    viewDoc ? `/api/stock/movements/${encodeURIComponent(viewDoc.doc)}` : null,
    {
      fresh: true,
      onError: (msg) => push({ kind: 'error', title: 'โหลดรายการไม่สำเร็จ', desc: msg }),
    },
  );
  const lines = React.useMemo(() => docLines.data?.rows ?? [], [docLines.data]);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const columns: Column<Movement>[] = [
    {
      key: 'no',
      header: '#',
      width: '52px',
      hideBelow: 'sm', // phones: document no. (+ type / ref / date under it) + View
      align: 'center',
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'doc',
      header: 'Document No.',
      width: '130px',
      cell: (r) => (
        <>
          <span className="num font-medium">{r.doc}</span>
          {/* a phone: the type / ref / date columns are hidden — shown here, so View fits beside it */}
          <div className="mt-1 flex flex-wrap items-center gap-1 sm:hidden">
            <Badge tone={typeTone(r.type)}>{r.type}</Badge>
            <span className="num text-2xs text-muted-foreground">
              {r.ref && <span className="text-primary">{r.ref} · </span>}
              {r.date}
            </span>
          </div>
        </>
      ),
    },
    {
      key: 'type',
      header: 'ประเภทเอกสาร',
      hideBelow: 'sm',
      cell: (r) => <Badge tone={typeTone(r.type)}>{r.type}</Badge>,
    },
    {
      key: 'ref',
      header: 'อ้างอิงถึง',
      width: '120px',
      hideBelow: 'sm',
      cell: (r) => <span className="num text-primary">{r.ref || '—'}</span>,
    },
    {
      key: 'date',
      header: 'วันที่',
      width: '140px',
      hideBelow: 'sm',
      cell: (r) => <span className="num text-xs">{r.date}</span>,
    },
    { key: 'by', header: 'โดย', hideBelow: 'md' },
    { key: 'from', header: 'From-Location', hideBelow: 'lg' },
    { key: 'to', header: 'To-Location', hideBelow: 'lg' },
    {
      key: 'remark',
      header: 'Remark',
      hideBelow: 'xl',
      cell: (r) => <span className="text-muted-foreground">{r.remark || '—'}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      width: '90px',
      align: 'center',
      sortable: false,
      cell: (r) => (
        <Button size="sm" variant="outline" onClick={() => setViewDoc(r)}>
          <Eye className="h-3.5 w-3.5" />
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ประวัติการเคลื่อนไหวเข้า-ออก"
        description="Stock Module » ประวัติการเคลื่อนไหวเข้า-ออก ของอะไหล่ทั้งหมด"
        actions={
          <ExportButton
            run={() =>
              exportXlsx('movements', {
                q: table.q,
                from: filters.from,
                to: filters.to,
                type: filters.type,
                code: filters.code,
                doc: filters.doc,
                ref: filters.ref,
              })
            }
          />
        }
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="วันที่สร้างเอกสาร (ตั้งแต่)">
          <Input type="date" value={draft.from} onChange={(e) => setD('from', e.target.value)} />
        </Field>
        <Field label="วันที่สร้างเอกสาร (ถึง)">
          <Input type="date" value={draft.to} onChange={(e) => setD('to', e.target.value)} />
        </Field>
        <Field label="ประเภทเอกสาร">
          <Select value={draft.type} onChange={(e) => setD('type', e.target.value)}>
            <option value="">ทั้งหมด</option>
            {DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="รหัส / ชื่ออะไหล่">
          <Input
            placeholder="P02534 หรือ ชื่ออะไหล่"
            className="num"
            value={draft.code}
            onChange={(e) => setD('code', e.target.value)}
          />
        </Field>
        <Field label="หมายเลขเอกสาร">
          <Input
            placeholder="WHO2602139"
            className="num"
            value={draft.doc}
            onChange={(e) => setD('doc', e.target.value)}
          />
        </Field>
        <Field label="อ้างอิงเอกสาร">
          <Input
            placeholder="J2611143 / SO2600730"
            className="num"
            value={draft.ref}
            onChange={(e) => setD('ref', e.target.value)}
          />
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={MOVEMENTS}
        loading={loading}
        error={loadError}
        onRetry={retryLoad}
        rowKey={(r) => r.doc}
        server={{ ...server, total }}
      />

      {/* document line-items modal */}
      <Modal
        open={!!viewDoc}
        onClose={() => setViewDoc(null)}
        size="xl"
        title="รายละเอียดเอกสารเคลื่อนไหว"
        description={viewDoc ? `${viewDoc.doc} · ${viewDoc.type}` : undefined}
        footer={
          <Button variant="outline" size="sm" onClick={() => setViewDoc(null)}>
            ปิด
          </Button>
        }
      >
        {viewDoc && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border">
              <TableScroll label="รายการในเอกสาร">
                {/* a phone: รหัส (ชื่อ under it) / จำนวน / หน่วย — the document no. is in the title, the rest wider up */}
                <table className="w-full text-sm sm:min-w-[860px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="hidden w-10 px-3 py-2 text-center sm:table-cell">#</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">Document No.</th>
                      <th className="px-3 py-2 text-left">รหัส</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">ชื่อ</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">Supplier</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">LotNo.</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">InvNo.</th>
                      <th className="px-3 py-2 text-right">จำนวน</th>
                      <th className="px-3 py-2 text-left">หน่วย</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/70 last:border-0">
                        <td className="num hidden px-3 py-2 text-center text-muted-foreground sm:table-cell">
                          {i + 1}
                        </td>
                        <td className="num hidden px-3 py-2 sm:table-cell">{viewDoc.doc}</td>
                        <td className="num px-3 py-2 font-medium">
                          {l.code}
                          <span className="block font-normal sm:hidden">{l.name}</span>
                        </td>
                        <td className="hidden px-3 py-2 sm:table-cell">
                          <span className="line-clamp-1 max-w-[320px]">{l.name}</span>
                        </td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{l.supplier || '—'}</td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">—</td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{l.ref || '—'}</td>
                        <td className="num px-3 py-2 text-right">{int(l.qty)}</td>
                        <td className="px-3 py-2">{l.unit}</td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">—</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {/* a hidden cell takes no column: the phone's Total spans 1, the wide one 7 */}
                    <tr className="border-t border-border bg-muted/60 font-semibold">
                      <td colSpan={7} className="hidden px-3 py-2 text-right sm:table-cell">
                        Total
                      </td>
                      <td className="px-3 py-2 text-right sm:hidden">Total</td>
                      <td className="num px-3 py-2 text-right text-primary">{int(totalQty)}</td>
                      <td />
                      <td className="hidden sm:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </TableScroll>
            </div>
            <p className="text-xs text-muted-foreground">หมายเหตุ: {viewDoc.remark || '—'}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
