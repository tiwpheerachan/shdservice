'use client';

import * as React from 'react';
import { Printer, FileSpreadsheet, FileText, FileDown } from 'lucide-react';
import { flushSync } from 'react-dom';
import { PageHeader } from './page-header';
import { FilterBar } from './filter-bar';
import { DataTable, type Column, type ServerTable, type ServerTableState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Field, type Lookup } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { SearchSelect, strOptions } from './search-select';
import { ExportButton } from './export-button';
import { cn, int } from '@/lib/utils';
import { invalidateLists } from '@/data/db';
import { BUSINESS_TZ } from '@/lib/dates';

export type ReportFilter =
  | { kind: 'text'; key?: string; label: string; placeholder?: string; value?: string }
  | { kind: 'date'; key?: string; label: string; value?: string }
  /** `lookup`: the hook the options come from — a failed load says so under the dropdown. `options` as a function
   *  of the draft values = a dependent list (รุ่น of the chosen ยี่ห้อ): a value the new list lacks goes back to its first */
  | {
      kind: 'select';
      key?: string;
      label: string;
      options: string[] | ((draft: ReportValues) => string[]);
      value?: string;
      lookup?: Lookup | Lookup[];
    };

/** values keyed by filter `key` (or label); "ทั้งหมด" (and the old "Select All" / "ALL" labels) → "" */
export type ReportValues = Record<string, string>;
const ALL = new Set(['ทั้งหมด', '- - Select All - -', '- - Select ALL - -', 'ALL']);

const keyOf = (f: ReportFilter) => f.key ?? f.label;

const optionsOf = (f: Extract<ReportFilter, { kind: 'select' }>, draft: ReportValues) =>
  typeof f.options === 'function' ? f.options(draft) : f.options;

/** each filter's starting value: its `value`, else a select's first option, else "" */
function defaultsOf(filters: ReportFilter[]): ReportValues {
  const v: ReportValues = {};
  for (const f of filters) v[keyOf(f)] = f.value ?? (f.kind === 'select' ? (optionsOf(f, {})[0] ?? '') : '');
  return v;
}

const thDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

/** the applied conditions in words for the printout: a date pair "(ตั้งแต่)" + "(ถึง)" reads as one range, a
 *  select / text only when it narrows ("วันที่ปิดงาน 1 ต.ค. 2569 – 27 ต.ค. 2569 · วิธีการส่งคืน: ส่งทางขนส่ง") */
function conditionsOf(filters: ReportFilter[], v: ReportValues): string {
  const out: string[] = [];
  const baseOf = (label: string) => label.replace(/\s*\((ตั้งแต่|ถึง)\)$/, '');
  filters.forEach((f, i) => {
    const x = v[keyOf(f)] ?? '';
    if (!x || ALL.has(x)) return;
    if (f.kind !== 'date') return void out.push(`${f.label}: ${x}`);
    // the "(ตั้งแต่)" just before (already the last entry) and this "(ถึง)" read as one range
    const p = filters[i - 1];
    const px = p ? (v[keyOf(p)] ?? '') : '';
    if (p?.kind === 'date' && px && baseOf(p.label) === baseOf(f.label))
      out[out.length - 1] = `${baseOf(f.label)} ${thDate(px)} – ${thDate(x)}`;
    else out.push(`${f.label} ${thDate(x)}`);
  });
  return out.join(' · ');
}

export function ReportView<T extends Record<string, unknown>>({
  title,
  description,
  filters,
  kpis,
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  onApply,
  server,
  onExport,
  emptyText,
}: {
  title: string;
  description: string;
  filters: ReportFilter[];
  /** `sub` = a small second line under the value (e.g. what the total leaves out) */
  kpis: { label: string; value: string; tone?: 'primary' | 'success' | 'warning' | 'danger'; sub?: string }[];
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  loading?: boolean;
  /** the rows failed to load (shown in the table instead of "no data") */
  error?: string | null;
  onRetry?: () => void;
  /** called with the current filter values when the user presses ค้นหา / reset */
  onApply?: (values: ReportValues) => void;
  /** server-side paging for the report table (rows = current page) */
  server?: ServerTable;
  /** the whole report (same filters) as .xlsx, Word (.doc) or the print view saved as PDF; `cond` = the applied
   *  filters in words, for the document's header */
  onExport?: (format: 'xlsx' | 'doc' | 'pdf', cond: string) => Promise<unknown>;
  /** what the empty table says (e.g. the menu right the table needs) */
  emptyText?: string;
}) {
  // the defaults the filters declare change (a page passes new ones) → the form starts over from
  // them: adjusted while rendering (React's "state from props" pattern), not in an effect pass
  const defaultsKey = filters.map((f) => `${keyOf(f)}=${f.value ?? ''}`).join('|');
  // ล้างค่า goes back to these, the first render's defaults: pages pass the applied range as `value`, so a
  // later defaultsOf(filters) is the last search, not the report's opening range
  const [initial] = React.useState(() => defaultsOf(filters));
  const [values, setValues] = React.useState<ReportValues>(initial);
  const [seenKey, setSeenKey] = React.useState(defaultsKey);
  // only the values a page declares (the applied date range) are taken over — a select / text box keeps what
  // the user chose (QA 2026-10-27: a new range used to reset them while the table stayed filtered by them)
  if (seenKey !== defaultsKey) {
    setSeenKey(defaultsKey);
    setValues((v) => ({
      ...v,
      ...Object.fromEntries(filters.flatMap((f) => (f.value === undefined ? [] : [[keyOf(f), f.value]]))),
    }));
  }
  // what the table shows (the last ค้นหา / ล้างค่า), not the draft in the fields — for the printout
  const [applied, setApplied] = React.useState<ReportValues>(initial);
  // the table's page as DataTable reports it, and the print time (set in beforeprint — Ctrl+P prints too)
  const [paged, setPaged] = React.useState<ServerTableState | null>(null);
  const [printedAt, setPrintedAt] = React.useState('');
  React.useEffect(() => {
    const stamp = () =>
      flushSync(() =>
        setPrintedAt(
          new Date().toLocaleString('th-TH', { timeZone: BUSINESS_TZ, dateStyle: 'medium', timeStyle: 'short' }),
        ),
      );
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  const clean = (v: ReportValues) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ALL.has(x) ? '' : x]));

  const total = server?.total ?? 0;
  const pageNote =
    server && paged
      ? `หน้า ${paged.page}/${Math.max(1, Math.ceil(total / paged.pageSize))} · แถว ` +
        `${int(total && (paged.page - 1) * paged.pageSize + 1)}–${int(Math.min(paged.page * paged.pageSize, total))} จาก ${int(total)}`
      : '';

  const toneMap = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  return (
    <>
      {/* a report prints landscape (A4): every column fits — a named @page left the layout at portrait width */}
      <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              title="พิมพ์เฉพาะหน้าที่แสดงอยู่ — ต้องการทั้งรายงาน ใช้ PDF / Excel / Word"
            >
              <Printer className="h-3.5 w-3.5" />
              พิมพ์หน้านี้
            </Button>
            {onExport && (
              <>
                <ExportButton run={() => onExport('pdf', conditionsOf(filters, applied))} label="PDF" icon={FileDown} />
                <ExportButton
                  run={() => onExport('xlsx', conditionsOf(filters, applied))}
                  label="Excel"
                  icon={FileSpreadsheet}
                />
                <ExportButton
                  run={() => onExport('doc', conditionsOf(filters, applied))}
                  label="Word"
                  icon={FileText}
                />
              </>
            )}
          </>
        }
      />

      <FilterBar
        title="เงื่อนไขการออกรายงาน"
        onSearch={() => {
          setApplied(values);
          onApply?.(clean(values));
          // the same filters keep the same keys, so nothing would refetch: read them again (a revoked Report → its 403)
          invalidateLists();
        }}
        onReset={() => {
          setValues(initial);
          setApplied(initial);
          onApply?.(clean(initial));
        }}
      >
        {filters.map((f) => {
          const k = keyOf(f);
          const v = values[k] ?? '';
          const set = (x: string) =>
            setValues((s) => {
              const next = { ...s, [k]: x };
              // a dependent list (รุ่น under ยี่ห้อ) drops a choice that no longer fits
              for (const g of filters) {
                if (g.kind !== 'select' || typeof g.options !== 'function') continue;
                const opts = g.options(next);
                const gk = keyOf(g);
                if (next[gk] && !opts.includes(next[gk])) next[gk] = opts[0] ?? '';
              }
              return next;
            });
          return (
            <Field key={f.label} label={f.label} lookup={f.kind === 'select' ? f.lookup : undefined}>
              {f.kind === 'text' && (
                <Input placeholder={f.placeholder} value={v} onChange={(e) => set(e.target.value)} />
              )}
              {f.kind === 'date' && <Input type="date" value={v} onChange={(e) => set(e.target.value)} />}
              {f.kind === 'select' &&
                (() => {
                  // options are plain strings and can repeat (two staff rows with the same name) — de-duplicate so keys stay unique
                  const opts = Array.from(new Set(optionsOf(f, values)));
                  // same rule as the rest of the app: long lists are searchable, 2–5 fixed choices stay a plain select
                  return opts.length > 5 ? (
                    <SearchSelect value={v} onChange={set} options={strOptions(opts)} />
                  ) : (
                    <Select value={v} onChange={(e) => set(e.target.value)}>
                      {opts.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Select>
                  );
                })()}
            </Field>
          );
        })}
      </FilterBar>

      {/* print only, under the title the h1 already prints: what this printout covers */}
      <div className="hidden text-xs print:block">
        <p>{conditionsOf(filters, applied) || 'ทุกรายการ'}</p>
        <p className="num">{[printedAt && `พิมพ์เมื่อ ${printedAt}`, pageNote].filter(Boolean).join(' · ')}</p>
      </div>

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="surface p-4">
              <p className="truncate text-2xs text-muted-foreground">{k.label}</p>
              <p className={cn('num mt-1 text-xl font-semibold tracking-tight', k.tone && toneMap[k.tone])}>
                {k.value}
              </p>
              {k.sub && <p className="num mt-1 text-2xs text-muted-foreground">{k.sub}</p>}
            </div>
          ))}
        </div>
      )}

      <DataTable
        searchable={false}
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        rowKey={rowKey}
        server={
          server && {
            ...server,
            onChange: (s) => {
              setPaged(s);
              server.onChange(s);
            },
          }
        }
        // the pager: the printout says the page in its header; every column on paper (report-print in globals.css)
        className="report-print print:[&>div:last-child]:hidden"
        emptyText={emptyText}
      />
    </>
  );
}
