"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; sub?: string };

const MAX_ROWS = 100;

/** plain string list → options (value = label) */
export const strOptions = (list: readonly string[]): SearchOption[] => list.map((v) => ({ value: v, label: v }));
/** keep a saved value that is no longer in the list (inactive / legacy) selectable, so it still shows */
export const withCurrent = (opts: SearchOption[], value: string): SearchOption[] =>
  value && !opts.some((o) => o.value === value) ? [{ value, label: value, sub: "ค่าเดิม" }, ...opts] : opts;

/**
 * Searchable single select (cmdk) — a drop-in for a plain <Select> with a long list.
 * Every typed word must appear in the label or sub text; label-prefix matches first.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "- - Please Select - -",
  emptyLabel,
  searchPlaceholder = "พิมพ์เพื่อค้นหา…",
  minWidth = 280,
  disabled = false,
  id,
}: {
  options: SearchOption[];
  /** "" = nothing chosen */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** when set, a first row that clears the choice (e.g. "- - ยังไม่ระบุ - -") */
  emptyLabel?: string;
  searchPlaceholder?: string;
  /** dropdown panel min width in px (it is at least as wide as the trigger) */
  minWidth?: number;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const selected = options.find((o) => o.value === value);

  // matches = everything that fits the search; rows = what is rendered (capped for long lists)
  const matches = React.useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    const full = words.join(" ");
    return options
      .filter((o) => words.every((w) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(full)) - Number(!b.label.toLowerCase().startsWith(full)));
  }, [options, q]);
  const rows = matches.length > MAX_ROWS ? matches.slice(0, MAX_ROWS) : matches;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  const itemCls = "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate">{selected.label}</span>
              {selected.sub && <span className="shrink-0 text-2xs text-muted-foreground">{selected.sub}</span>}
            </span>
          ) : (
            <span className="flex-1 truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        style={{ minWidth }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="ล้างคำค้น">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1.5">
            {emptyLabel && !q.trim() && (
              <CommandPrimitive.Item value="__empty__" onSelect={() => pick("")} className={cn(itemCls, "text-muted-foreground")}>
                <Check className={cn("h-3.5 w-3.5 shrink-0", value ? "opacity-0" : "opacity-100")} />
                {emptyLabel}
              </CommandPrimitive.Item>
            )}
            {rows.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {options.length === 0 ? "กำลังโหลด…" : `ไม่พบรายการที่ตรงกับ "${q.trim()}"`}
              </p>
            )}
            {rows.map((o) => (
              <CommandPrimitive.Item key={o.value} value={o.value} onSelect={() => pick(o.value)} className={itemCls}>
                <Check className={cn("h-3.5 w-3.5 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.sub && <span className="shrink-0 text-2xs text-muted-foreground">{o.sub}</span>}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
          {matches.length > rows.length && (
            <p className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
              แสดง {rows.length.toLocaleString("en-US")} จาก {matches.length.toLocaleString("en-US")} รายการ — พิมพ์เพื่อค้นหาเพิ่ม
            </p>
          )}
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
