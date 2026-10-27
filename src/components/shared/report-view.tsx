'use client';

import * as React from 'react';
import { Download, Printer, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from './page-header';
import { FilterBar } from './filter-bar';
import { DataTable, type Column, type ServerTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Field, type Lookup } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { SearchSelect, strOptions } from './search-select';
import { ExportButton } from './export-button';
import { cn } from '@/lib/utils';
import { invalidateLists } from '@/data/db';

export type ReportFilter =
  | { kind: 'text'; key?: string; label: string; placeholder?: string; value?: string }
  | { kind: 'date'; key?: string; label: string; value?: string }
  /** `lookup`: the hook the options come from — a failed load says so under the dropdown */
  | { kind: 'select'; key?: string; label: string; options: string[]; value?: string; lookup?: Lookup | Lookup[] };

/** values keyed by filter `key` (or label); "ทั้งหมด" (and the old "Select All" / "ALL" labels) → "" */
export type ReportValues = Record<string, string>;
const ALL = new Set(['ทั้งหมด', '- - Select All - -', '- - Select ALL - -', 'ALL']);

const keyOf = (f: ReportFilter) => f.key ?? f.label;

/** each filter's starting value: its `value`, else a select's first option, else "" */
function defaultsOf(filters: ReportFilter[]): ReportValues {
  const v: ReportValues = {};
  for (const f of filters) v[keyOf(f)] = f.value ?? (f.kind === 'select' ? (f.options[0] ?? '') : '');
  return v;
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
  /** download the whole report (same filters) as .xlsx */
  onExport?: () => Promise<unknown>;
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
  if (seenKey !== defaultsKey) {
    setSeenKey(defaultsKey);
    setValues(defaultsOf(filters));
  }
  const clean = (v: ReportValues) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ALL.has(x) ? '' : x]));

  const toneMap = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              พิมพ์รายงาน
            </Button>
            {onExport && <ExportButton run={onExport} label="Excel" icon={FileSpreadsheet} />}
            <Button size="sm" onClick={() => window.print()} title="เปิดหน้าต่างพิมพ์ — เลือก 'บันทึกเป็น PDF'">
              <Download className="h-3.5 w-3.5" />
              PDF
            </Button>
          </>
        }
      />

      <FilterBar
        title="เงื่อนไขการออกรายงาน"
        onSearch={() => {
          onApply?.(clean(values));
          // the same filters keep the same keys, so nothing would refetch: read them again (a revoked Report → its 403)
          invalidateLists();
        }}
        onReset={() => {
          setValues(initial);
          onApply?.(clean(initial));
        }}
      >
        {filters.map((f) => {
          const k = keyOf(f);
          const v = values[k] ?? '';
          const set = (x: string) => setValues((s) => ({ ...s, [k]: x }));
          return (
            <Field key={f.label} label={f.label} lookup={f.kind === 'select' ? f.lookup : undefined}>
              {f.kind === 'text' && (
                <Input placeholder={f.placeholder} value={v} onChange={(e) => set(e.target.value)} />
              )}
              {f.kind === 'date' && <Input type="date" value={v} onChange={(e) => set(e.target.value)} />}
              {f.kind === 'select' &&
                (() => {
                  // options are plain strings and can repeat (two staff rows with the same name) — de-duplicate so keys stay unique
                  const opts = Array.from(new Set(f.options));
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
        server={server}
        emptyText={emptyText}
      />
    </>
  );
}
