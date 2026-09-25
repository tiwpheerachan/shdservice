"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronsUpDown, Search, Star, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { cn } from "@/lib/utils";
import { int } from "@/lib/utils";

export type SymptomOption = { id: number; name: string; count?: number };

/**
 * อาการเสีย — searchable multi-select (cmdk inside a Popover).
 *  - `value` is an ordered list of symptom NAMES; the FIRST one is อาการหลัก
 *    (what job.product_symptom_id stores), the rest go to job_symptom.
 *  - options come pre-sorted by how often they are used; `suggested` (top symptoms
 *    of the chosen model) is shown as its own group on top.
 *  - `multiple={false}` turns it into a single-select (ช่างระบุอาการที่ตรวจพบ).
 */
export function SymptomPicker({
  value,
  onChange,
  options,
  suggested = [],
  suggestedLabel = "อาการที่พบบ่อยของรุ่นนี้",
  multiple = true,
  disabled = false,
  placeholder = "พิมพ์ค้นหาอาการเสีย… เช่น แบต, จอ, ชาร์จ",
}: {
  value: string[];
  onChange: (names: string[]) => void;
  options: SymptomOption[];
  suggested?: SymptomOption[];
  suggestedLabel?: string;
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const selected = new Set(value);

  const toggle = (name: string) => {
    if (!multiple) {
      onChange(selected.has(name) ? [] : [name]);
      setOpen(false);
      return;
    }
    onChange(selected.has(name) ? value.filter((v) => v !== name) : [...value, name]);
  };
  const remove = (name: string) => onChange(value.filter((v) => v !== name));
  const makePrimary = (name: string) => onChange([name, ...value.filter((v) => v !== name)]);

  const suggestedNames = new Set(suggested.map((s) => s.name));
  // cmdk filters on `value`; we do our own contains-match so Thai partial words work predictably
  const match = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());
  const restOptions = options.filter((o) => !suggestedNames.has(o.name) && match(o.name));
  const sugOptions = suggested.filter((o) => match(o.name));

  // plain render function (NOT a nested component): a component defined inside render
  // gets a new identity every render, so cmdk items remount between pointerdown and
  // click and mouse selection never fires
  const renderItem = (o: SymptomOption, keyPrefix = "") => {
    const on = selected.has(o.name);
    return (
      <CommandPrimitive.Item
        key={`${keyPrefix}${o.id}`}
        value={o.name}
        onSelect={() => toggle(o.name)}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none",
          "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
        )}
      >
        <span
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border",
            on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"
          )}
        >
          {on && <Check className="h-3 w-3" />}
        </span>
        <span className="flex-1 truncate">{o.name}</span>
        {o.count !== undefined && <span className="num text-2xs text-muted-foreground">{int(o.count)} งาน</span>}
      </CommandPrimitive.Item>
    );
  };

  return (
    <div className="space-y-2">
      {/* selected chips (multi only) — first = อาการหลัก; single mode shows the value in the trigger */}
      {multiple && value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name, i) => (
            <span
              key={name}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                i === 0 && multiple ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
              )}
            >
              {multiple &&
                (i === 0 ? (
                  <Star className="h-3 w-3 fill-current" aria-label="อาการหลัก" />
                ) : (
                  !disabled && (
                    <button type="button" onClick={() => makePrimary(name)} title="ตั้งเป็นอาการหลัก" className="rounded-full text-muted-foreground hover:text-primary">
                      <Star className="h-3 w-3" />
                    </button>
                  )
                ))}
              {name}
              {!disabled && (
                <button type="button" onClick={() => remove(name)} aria-label={`เอา ${name} ออก`} className="ml-0.5 rounded-full opacity-70 hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-muted-foreground",
              "transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20",
              "disabled:cursor-not-allowed disabled:bg-muted"
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">
              {!multiple && value[0] ? <span className="text-foreground">{value[0]}</span> : placeholder}
            </span>
            {multiple && value.length > 0 && <span className="num text-2xs">{value.length} อาการ</span>}
            {!multiple && value[0] && !disabled && (
              <span
                role="button"
                aria-label="ล้างค่า"
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
                className="rounded-full p-0.5 opacity-70 hover:bg-accent hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder={placeholder}
                className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
              />
              {multiple && <span className="num shrink-0 text-2xs text-muted-foreground">{value.length} เลือกแล้ว</span>}
            </div>
            <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1.5">
              {sugOptions.length === 0 && restOptions.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">ไม่พบอาการเสีย "{q}" — ระบุใน "อาการเสีย (อื่นๆ)" แทน</p>
              )}
              {sugOptions.length > 0 && (
                <CommandPrimitive.Group heading={suggestedLabel} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-primary">
                  {sugOptions.map((o) => renderItem(o, "s-"))}
                </CommandPrimitive.Group>
              )}
              {restOptions.length > 0 && (
                <CommandPrimitive.Group heading={sugOptions.length ? "ทั้งหมด (เรียงตามที่ใช้บ่อย)" : undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
                  {restOptions.map((o) => renderItem(o))}
                </CommandPrimitive.Group>
              )}
            </CommandPrimitive.List>
            {multiple && (
              <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
                <span>Enter = เลือก/ยกเลิก · ★ ตัวแรก = อาการหลัก</span>
                <button type="button" onClick={() => setOpen(false)} className="font-medium text-primary hover:underline">เสร็จ</button>
              </div>
            )}
          </CommandPrimitive>
        </PopoverContent>
      </Popover>
    </div>
  );
}
