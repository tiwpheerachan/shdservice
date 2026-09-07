"use client";

import * as React from "react";
import { Download, Printer, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "./page-header";
import { FilterBar } from "./filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type ReportFilter =
  | { kind: "text"; label: string; placeholder?: string }
  | { kind: "date"; label: string; value?: string }
  | { kind: "select"; label: string; options: string[] };

export function ReportView<T extends Record<string, unknown>>({
  title,
  description,
  filters,
  kpis,
  columns,
  rows,
  rowKey,
  loading = false,
}: {
  title: string;
  description: string;
  filters: ReportFilter[];
  kpis: { label: string; value: string; tone?: "primary" | "success" | "warning" | "danger" }[];
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T, i: number) => string;
  loading?: boolean;
}) {
  const { push } = useToast();

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
              onClick={() => push({ kind: "success", title: "กำลังส่งออกไฟล์ Excel" })}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </Button>
            <Button
              size="sm"
              onClick={() => push({ kind: "success", title: "กำลังสร้างไฟล์ PDF" })}
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </Button>
          </>
        }
      />

      <FilterBar
        title="เงื่อนไขการออกรายงาน"
        onSearch={() => push({ kind: "info", title: "ประมวลผลรายงานแล้ว" })}
      >
        {filters.map((f) => (
          <Field key={f.label} label={f.label}>
            {f.kind === "text" && <Input placeholder={f.placeholder} />}
            {f.kind === "date" && <Input type="date" defaultValue={f.value} />}
            {f.kind === "select" && (
              <Select>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            )}
          </Field>
        ))}
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

      <DataTable columns={columns} rows={rows} loading={loading} rowKey={rowKey} searchPlaceholder="ค้นหาในรายงาน…" />
    </>
  );
}
