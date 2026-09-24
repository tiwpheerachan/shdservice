"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { type Model } from "@/data/mock";
import { cn } from "@/lib/utils";

const MAX_ROWS = 80;

/**
 * Options for filters that match a model by NAME (job list / assign): one option per name —
 * the same name exists under several brands — with the brand(s) as the sub text.
 */
export function modelNameOptions(models: Model[], brand = ""): { value: string; label: string; sub?: string }[] {
  const byName = new Map<string, Set<string>>();
  for (const m of brand ? models.filter((x) => x.brand === brand) : models) {
    if (!byName.has(m.name)) byName.set(m.name, new Set());
    if (m.brand) byName.get(m.name)!.add(m.brand);
  }
  return [...byName].map(([name, brands]) => {
    const b = [...brands];
    return { value: name, label: name, sub: b.length > 2 ? `${b.slice(0, 2).join(", ")} +${b.length - 2}` : b.join(", ") || undefined };
  });
}

/** every typed word must appear in code / name / brand; exact code first, then code / name prefix */
function matchModels(models: Model[], q: string): Model[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models.slice(0, MAX_ROWS);
  const full = words.join(" ");
  const scored: { m: Model; s: number }[] = [];
  for (const m of models) {
    const code = m.code.toLowerCase();
    const name = m.name.toLowerCase();
    if (!words.every((w) => `${code} ${name} ${m.brand.toLowerCase()}`.includes(w))) continue;
    scored.push({ m, s: code === full ? 0 : code.startsWith(full) ? 1 : name.startsWith(full) ? 2 : 3 });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, MAX_ROWS).map((x) => x.m);
}

/** Searchable รุ่น select (1,000+ models) — same look as ProductPicker. */
export function ModelPicker({
  models,
  value,
  onPick,
  fallbackName,
  placeholder = "- - ค้นหารุ่น - -",
  id,
}: {
  models: Model[];
  /** selected model code; empty = nothing chosen */
  value: string;
  onPick: (m: Model) => void;
  /** name to show when `value` is not in `models` (e.g. list narrowed to another brand) */
  fallbackName?: string;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const rows = React.useMemo(() => matchModels(models, q), [models, q]);
  const selected = value ? models.find((m) => m.code === value) : undefined;

  const itemCls = "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
        >
          {value ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="num shrink-0 font-medium">{value}</span>
              <span className="truncate text-muted-foreground">{selected?.name ?? fallbackName ?? ""}</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{placeholder}</span>
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[440px] max-w-[calc(100vw-2rem)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="พิมพ์รหัสรุ่น ชื่อรุ่น หรือยี่ห้อ…"
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="ล้างคำค้น">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1.5">
            {rows.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {models.length === 0 ? "กำลังโหลดรายการรุ่น…" : `ไม่พบรุ่นที่ตรงกับ "${q.trim()}"`}
              </p>
            ) : (
              rows.map((m) => (
                <CommandPrimitive.Item
                  key={m.code}
                  value={m.code}
                  onSelect={() => { onPick(m); setOpen(false); setQ(""); }}
                  className={cn(itemCls, m.code === value && "font-medium")}
                >
                  <span className="num w-[84px] shrink-0">{m.code}</span>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{m.brand}</span>
                </CommandPrimitive.Item>
              ))
            )}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
