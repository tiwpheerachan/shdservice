'use client';

import * as React from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
  SearchX,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { cn, SEARCH_MIN_CHARS, SEARCH_MIN_HINT } from '@/lib/utils';
import { Input, Select } from './input';
import { Skeleton } from './skeleton';
import { Button } from './button';
import { PAGE_SIZES } from '@/data/keys';

/** the page-size choices (also what a ?size= in a shared job-list link may be) */
export { PAGE_SIZES };

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  /** value used for sorting / searching */
  value?: (row: T) => string | number;
  cell?: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  /** the column never gets narrower than this (e.g. text that should not wrap to 4 lines) */
  minWidth?: string;
  /** a long header ("หมายเลขใบเสนอราคา") may take 2 lines — the column then sizes to its values */
  headerWrap?: boolean;
  className?: string;
  sortable?: boolean;
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
};

/**
 * Server mode: when `server` is given the table stops filtering / sorting /
 * slicing `rows` itself. `rows` is the current page from the API, `total` the
 * full count, and every change of page / page size / search text / sort is
 * reported through `onChange` so the caller can refetch. Visuals are identical.
 */
export type ServerTableState = {
  page: number;
  pageSize: number;
  q: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
};
export type ServerTable = {
  total: number;
  onChange: (state: ServerTableState) => void;
  /** change it (e.g. the applied filters as a string) to jump back to page 1 */
  resetKey?: string;
  /** where the table starts (read once, on mount) — e.g. page + sort from the URL so a refresh keeps them */
  initial?: { page?: number; sort?: ServerTableState['sort'] };
};

// sm: the screen. md–xl: the table's own width (@container below) — the 268px sidebar appears at a
// 1024px screen and leaves the table ~700px, less than a 768 tablet's ~734px; a 1280px screen leaves ~960px.
// So an md column waits for a 720px-wide table (a 768 tablet keeps it), lg for 896px, xl for 1152px.
const HIDE: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden @min-[45rem]:table-cell',
  lg: 'hidden @4xl:table-cell',
  xl: 'hidden @6xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
};

/** a table wider than a phone: the scroll box is named and focusable, so the keyboard can scroll it (WCAG 2.1.1) */
export function TableScroll({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn('table-scroll', className)}>
      {children}
    </div>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  searchable = true,
  searchPlaceholder = 'ค้นหา…',
  pageSize: initialPageSize = 25,
  emptyText = 'ไม่พบข้อมูล',
  emptyHint,
  dense = false,
  toolbar,
  footerNote,
  className,
  loading = false,
  rowClassName,
  server,
  narrowed = false,
  onClearFilters,
  error = null,
  onRetry,
  label = 'ตารางข้อมูล',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyText?: string;
  emptyHint?: string;
  dense?: boolean;
  toolbar?: React.ReactNode;
  footerNote?: React.ReactNode;
  className?: string;
  loading?: boolean;
  rowClassName?: (row: T, i: number) => string;
  server?: ServerTable;
  /** the page's filter bar narrows the rows (see isFilterActive) — an empty result then says
   *  "nothing matches" instead of `emptyText`, which describes a truly empty list */
  narrowed?: boolean;
  /** resets the page's filters (the same as its filter bar's ล้างค่า) — shown as a button on "nothing matches" */
  onClearFilters?: () => void;
  /** the rows failed to load — say so (with a retry) instead of "no data" */
  error?: string | null;
  onRetry?: () => void;
  /** names the table's scroll region */
  label?: string;
}) {
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(server?.initial?.sort ?? null);
  const [page, setPage] = React.useState(server?.initial?.page ?? 1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);

  const getVal = React.useCallback((row: T, col: Column<T>) => {
    if (col.value) return col.value(row);
    const v = row[col.key];
    return typeof v === 'number' ? v : v == null ? '' : String(v);
  }, []);

  // server mode: debounce the search box, then let the caller refetch. A term
  // shorter than SEARCH_MIN_CHARS is never sent — the box shows a hint and the
  // table keeps the unfiltered list.
  const tooShort = !!server && q.trim().length > 0 && q.trim().length < SEARCH_MIN_CHARS;
  const [dq, setDq] = React.useState('');
  React.useEffect(() => {
    if (!server) return;
    const next = tooShort ? '' : q;
    const id = setTimeout(() => setDq(next), 350);
    return () => clearTimeout(id);
  }, [q, tooShort, server]);
  const onServerChange = server?.onChange;
  React.useEffect(() => {
    if (!onServerChange) return;
    onServerChange({ page, pageSize, q: dq, sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, dq, sort, !!onServerChange]);

  const filtered = React.useMemo(() => {
    if (server) return rows;
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => columns.some((c) => String(getVal(r, c)).toLowerCase().includes(needle)));
  }, [q, rows, columns, getVal, server]);

  const sorted = React.useMemo(() => {
    if (server || !sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getVal(a, col);
      const bv = getVal(b, col);
      let r: number;
      if (typeof av === 'number' && typeof bv === 'number') r = av - bv;
      else r = String(av).localeCompare(String(bv), 'th');
      return sort.dir === 'asc' ? r : -r;
    });
    return copy;
  }, [filtered, sort, columns, getVal, server]);

  const totalCount = server ? server.total : sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const current = server ? page : Math.min(page, totalPages);
  const view = server ? rows : sorted.slice((current - 1) * pageSize, current * pageSize);

  // back to page 1 when what is listed changes — the search box and page size do it in their change
  // events; a new client data set or (server mode) new filters from the page are adjusted while
  // rendering (the old page may not exist any more)
  const listKey = server ? `s:${server.resetKey ?? ''}` : `c:${rows.length}`;
  const [listKeyFrom, setListKeyFrom] = React.useState(listKey);
  if (listKey !== listKeyFrom) {
    setListKeyFrom(listKey);
    setPage(1);
  }

  // a new order starts again at page 1, like a new search
  const toggleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
    setPage(1);
  };

  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';

  return (
    <div className={cn('surface @container overflow-hidden', className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          {searchable ? (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 pl-8"
                aria-describedby={tooShort ? 'dt-search-hint' : undefined}
              />
              {tooShort && (
                <span
                  id="dt-search-hint"
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-2xs text-muted-foreground"
                >
                  {SEARCH_MIN_HINT}
                </span>
              )}
            </div>
          ) : (
            <div />
          )}
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}

      <TableScroll label={label} className="rounded-none">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    // screen readers announce the sort state; the chevrons alone are visual only
                    aria-sort={
                      !sortable ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    style={c.width || c.minWidth ? { width: c.width, minWidth: c.minWidth } : undefined}
                    className={cn(
                      'px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground',
                      c.headerWrap ? 'leading-tight' : 'whitespace-nowrap',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className,
                    )}
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        // min-h-6: a 24px target (WCAG 2.5.8); -my-1 keeps the header row its height
                        className={cn(
                          '-my-1 inline-flex min-h-6 items-center gap-1 rounded transition-colors hover:text-foreground',
                          c.align === 'right' && 'flex-row-reverse',
                          c.headerWrap && (c.align === 'right' ? 'text-right' : 'text-left'),
                          active && 'text-primary',
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-30" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && loading ? (
              // first load: a full page of skeleton rows keeps the table's height, so nothing below it
              // (pager, footer) jumps when data lands (CLS)
              Array.from({ length: pageSize }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border/70 last:border-0" aria-busy>
                  {columns.map((c, j) => (
                    <td key={c.key} className={cn(cellPad, c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton
                        className={cn(
                          'h-3.5',
                          j === 0 ? 'w-20' : i % 2 ? 'w-3/5' : 'w-4/5',
                          c.align === 'right' && 'ml-auto',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : view.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-14 text-center">
                  {error ? (
                    <div role="alert">
                      <TriangleAlert className="mx-auto mb-2 h-7 w-7 text-destructive/70" aria-hidden />
                      <p className="text-sm font-medium text-destructive">โหลดข้อมูลไม่สำเร็จ</p>
                      <p className="mt-1 text-xs text-muted-foreground/80">{error}</p>
                      {onRetry && (
                        <Button variant="outline" size="sm" type="button" className="mt-3" onClick={onRetry}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          ลองใหม่
                        </Button>
                      )}
                    </div>
                  ) : narrowed || q.trim() ? (
                    <>
                      <SearchX className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" aria-hidden />
                      <p className="text-sm font-medium text-muted-foreground">ไม่พบรายการที่ตรงกับเงื่อนไขค้นหา</p>
                      <p className="mt-1 text-xs text-muted-foreground/80">ลองเปลี่ยนหรือล้างตัวกรอง</p>
                      {(onClearFilters || q.trim()) && (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="mt-3"
                          onClick={() => {
                            setQ('');
                            setPage(1);
                            onClearFilters?.();
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          ล้างตัวกรอง
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Inbox className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" aria-hidden />
                      <p className="text-sm font-medium text-muted-foreground">{emptyText}</p>
                      {emptyHint && <p className="mt-1 text-xs text-muted-foreground/80">{emptyHint}</p>}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              view.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className={cn(
                    'border-b border-border/70 transition-colors last:border-0 hover:bg-accent/60',
                    rowClassName?.(row, i),
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        cellPad,
                        'align-middle',
                        c.align === 'right' ? 'text-right num' : c.align === 'center' ? 'text-center' : 'text-left',
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className,
                      )}
                    >
                      {c.cell ? c.cell(row, (current - 1) * pageSize + i) : String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="num">
            แสดง {totalCount === 0 ? 0 : (current - 1) * pageSize + 1}–{Math.min(current * pageSize, totalCount)} จาก{' '}
            {totalCount.toLocaleString('en-US')} รายการ
          </span>
          {footerNote}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-8 w-32"
            aria-label="จำนวนต่อหน้า"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} รายการ
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current === 1}
              className="grid h-9 w-9 place-items-center rounded-md border border-border transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
              aria-label="ก่อนหน้า"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="num min-w-[70px] text-center">
              หน้า {current} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={current >= totalPages}
              className="grid h-9 w-9 place-items-center rounded-md border border-border transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:h-11 pointer-coarse:w-11"
              aria-label="ถัดไป"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
