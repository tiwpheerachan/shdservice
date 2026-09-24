"use client";

import * as React from "react";
import { Download, Printer, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "./page-header";
import { FilterBar } from "./filter-bar";
import { DataTable, type Column, type ServerTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SearchSelect, strOptions } from "./search-select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type ReportFilter =
  | { kind: "text"; key?: string; label: string; placeholder?: string; value?: string }
  | { kind: "date"; key?: string; label: string; value?: string }
  | { kind: "select"; key?: string; label: string; options: string[]; value?: string };

/** values keyed by filter `key` (or label); "ทั้งหมด" (and the old "Select All" / "ALL" labels) → "" */
export type ReportValues = Record<string, string>;
const ALL = new Set(["ทั้งหมด", "- - Select All - -", "- - Select ALL - -", "ALL"]);

export function ReportView<T extends Record<string, unknown>>({
  title,
  description,
  filters,
  kpis,
  columns,
  rows,
  rowKey,
  loading = false,
  onApply,
  server,
  onExport,
}: {
  title: string;
  description: string;
  filters: ReportFilter[];
  kpis: { label: string; value: string; tone?: "primary" | "success" | "warning" | "danger" }[];
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  loading?: boolean;
  /** called with the current filter values when the user presses ค้นหา / reset */
  onApply?: (values: ReportValues) => void;
  /** server-side paging for the report table (rows = current page) */
  server?: ServerTable;
  /** download the whole report (same filters) as .xlsx */
  onExport?: () => void;
}) {
  const { push } = useToast();
  const keyOf = (f: ReportFilter) => f.key ?? f.label;
  const initial = React.useMemo(() => {
    const v: ReportValues = {};
    for (const f of filters) v[keyOf(f)] = f.value ?? (f.kind === "select" ? f.options[0] ?? "" : "");
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.map((f) => `${keyOf(f)}=${f.value ?? ""}`).join("|")]);
  const [values, setValues] = React.useState<ReportValues>(initial);
  React.useEffect(() => setValues(initial), [initial]);
  const clean = (v: ReportValues) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ALL.has(x) ? "" : x]));

  const toneMap = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => (onExport ? onExport() : push({ kind: "warning", title: "หน้านี้ยังไม่รองรับการส่งออก" }))}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </Button>
            <Button
              size="sm"
              onClick={() => window.print()}
              title="เปิดหน้าต่างพิมพ์ — เลือก 'บันทึกเป็น PDF'"
            >
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
          push({ kind: "info", title: "ประมวลผลรายงานแล้ว" });
        }}
        onReset={() => {
          setValues(initial);
          onApply?.(clean(initial));
        }}
      >
        {filters.map((f) => {
          const k = keyOf(f);
          const v = values[k] ?? "";
          const set = (x: string) => setValues((s) => ({ ...s, [k]: x }));
          return (
            <Field key={f.label} label={f.label}>
              {f.kind === "text" && <Input placeholder={f.placeholder} value={v} onChange={(e) => set(e.target.value)} />}
              {f.kind === "date" && <Input type="date" value={v} onChange={(e) => set(e.target.value)} />}
              {f.kind === "select" && (() => {
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
              <p
                className={cn(
                  "num mt-1 text-xl font-semibold tracking-tight",
                  k.tone && toneMap[k.tone]
                )}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <DataTable searchable={false} columns={columns} rows={rows} loading={loading} rowKey={rowKey} server={server} />
    </>
  );
}
