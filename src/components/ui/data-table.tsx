"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Select } from "./input";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  /** value used for sorting / searching */
  value?: (row: T) => string | number;
  cell?: (row: T, index: number) => React.ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  className?: string;
  sortable?: boolean;
  hideBelow?: "sm" | "md" | "lg" | "xl";
};

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  searchable = true,
  searchPlaceholder = "ค้นหา…",
  pageSize: initialPageSize = 25,
  emptyText = "ไม่พบข้อมูล",
  emptyHint,
  dense = false,
  toolbar,
  footerNote,
  className,
  loading = false,
  rowClassName,
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
}) {
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    null
  );
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);

  const getVal = React.useCallback(
    (row: T, col: Column<T>) => {
      if (col.value) return col.value(row);
      const v = row[col.key];
      return typeof v === "number" ? v : v == null ? "" : String(v);
    },
    []
  );

  const filtered = React.useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      columns.some((c) => String(getVal(r, c)).toLowerCase().includes(needle))
    );
  }, [q, rows, columns, getVal]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getVal(a, col);
      const bv = getVal(b, col);
      let r: number;
      if (typeof av === "number" && typeof bv === "number") r = av - bv;
      else r = String(av).localeCompare(String(bv), "th");
      return sort.dir === "asc" ? r : -r;
    });
    return copy;
  }, [filtered, sort, columns, getVal]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const view = sorted.slice((current - 1) * pageSize, current * pageSize);

  React.useEffect(() => setPage(1), [q, pageSize, rows]);

  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key !== key
        ? { key, dir: "asc" }
        : s.dir === "asc"
          ? { key, dir: "desc" }
          : null
    );

  const cellPad = dense ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className={cn("surface overflow-hidden", className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          {searchable ? (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-8 text-xs"
              />
            </div>
          ) : (
            <div />
          )}
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}

      <div className="table-scroll rounded-none">
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
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground",
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                          ? "text-center"
                          : "text-left",
                      c.hideBelow && HIDE[c.hideBelow],
                      c.className
                    )}
                  >
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
                          c.align === "right" && "flex-row-reverse",
                          active && "text-primary"
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === "asc" ? (
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
            {view.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-14 text-center">
                  {loading ? (
                    <>
                      <div
                        className="mx-auto mb-2 h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
                        aria-hidden
                      />
                      <p className="text-sm font-medium text-muted-foreground">
                        กำลังโหลดข้อมูล…
                      </p>
                    </>
                  ) : (
                    <>
                      <Inbox className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {emptyText}
                      </p>
                      {emptyHint && (
                        <p className="mt-1 text-xs text-muted-foreground/80">
                          {emptyHint}
                        </p>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              view.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className={cn(
                    "border-b border-border/70 transition-colors last:border-0 hover:bg-accent/60",
                    rowClassName?.(row, i)
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        cellPad,
                        "align-middle",
                        c.align === "right"
                          ? "text-right num"
                          : c.align === "center"
                            ? "text-center"
                            : "text-left",
                        c.hideBelow && HIDE[c.hideBelow],
                        c.className
                      )}
                    >
                      {c.cell
                        ? c.cell(row, (current - 1) * pageSize + i)
                        : String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="num">
            แสดง {sorted.length === 0 ? 0 : (current - 1) * pageSize + 1}–
            {Math.min(current * pageSize, sorted.length)} จาก {sorted.length} รายการ
          </span>
          {footerNote}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 w-24 text-xs"
            aria-label="จำนวนต่อหน้า"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} รายการ
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current === 1}
              className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="ก่อนหน้า"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="num min-w-[70px] text-center">
              หน้า {current} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={current === totalPages}
              className="rounded-md border border-border p-1.5 transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
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
