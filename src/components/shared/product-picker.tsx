"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, Package, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Badge } from "@/components/ui/badge";
import { type Product } from "@/data/mock";
import { baht, cn } from "@/lib/utils";

/** The fields the picker needs — `useProducts()` (lite rows) already carries them. */
export type PickableProduct = Pick<Product, "sysCode" | "mfgCode" | "name" | "onhand" | "price" | "brand" | "category">;

/** Non-stock lines a form may offer (e.g. SVD0001 ค่าขนส่ง) — pinned above the search results. */
export type ExtraItem = { code: string; name: string; price?: number };

/** What `onPick` hands back — `product` is set for stock items, absent for extras. */
export type PickedItem<T extends PickableProduct> = { code: string; name: string; price?: number; product?: T };

const MAX_ROWS = 60;

/**
 * Word search over code / vendor part no / name / brand / category: every typed
 * word must appear somewhere (any order), exact code or part-no matches first,
 * then code prefix, then name prefix, then the rest in code order.
 */
export function matchProducts<T extends PickableProduct>(products: T[], q: string, limit = MAX_ROWS): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return products.slice(0, limit);
  const full = words.join(" ");
  const scored: { p: T; s: number }[] = [];
  for (const p of products) {
    const code = p.sysCode.toLowerCase();
    const mfg = (p.mfgCode ?? "").toLowerCase();
    const name = p.name.toLowerCase();
    const hay = `${code} ${mfg} ${name} ${(p.brand ?? "").toLowerCase()} ${(p.category ?? "").toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const s = code === full || mfg === full ? 0 : code.startsWith(full) || mfg.startsWith(full) ? 1 : name.startsWith(full) ? 2 : 3;
    scored.push({ p, s });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, limit).map((x) => x.p);
}

export function ProductPicker<T extends PickableProduct>({
  products,
  value,
  onPick,
  extras,
  fallbackName,
  placeholder = "ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…",
  size = "md",
  className,
  align = "start",
  clearable = false,
  id,
}: {
  products: T[];
  /** selected sysCode (or an extra's code); empty = nothing chosen */
  value?: string;
  /** `null` when cleared */
  onPick: (item: PickedItem<T> | null) => void;
  extras?: ExtraItem[];
  /** name to show when `value` is not in `products` any more (inactive product on an old document) */
  fallbackName?: string;
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
  align?: "start" | "end";
  clearable?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const term = q.trim();

  const rows = React.useMemo(() => matchProducts(products, q), [products, q]);
  const extraRows = React.useMemo(() => {
    if (!extras?.length) return [];
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    return extras.filter((e) => words.every((w) => `${e.code} ${e.name}`.toLowerCase().includes(w)));
  }, [extras, term]);

  const selected = value ? products.find((p) => p.sysCode === value) : undefined;
  const selectedExtra = !selected && value ? extras?.find((e) => e.code === value) : undefined;
  const label = selected?.name ?? selectedExtra?.name ?? fallbackName ?? "";

  const pick = (item: PickedItem<T> | null) => {
    onPick(item);
    setOpen(false);
    setQ("");
  };
  const pickProduct = (p: T) => pick({ code: p.sysCode, name: p.name, price: p.price, product: p });
  const pickExtra = (e: ExtraItem) => pick({ code: e.code, name: e.name, price: e.price });

  const itemCls = "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20",
            size === "sm" ? "h-8 text-xs" : "h-9 text-sm",
            className
          )}
        >
          {value ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="num shrink-0 font-medium">{value}</span>
              <span className="truncate text-muted-foreground">{label}</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{placeholder}</span>
            </span>
          )}
          {clearable && value ? (
            <span
              role="button"
              aria-label="ล้าง"
              onClick={(e) => { e.stopPropagation(); pick(null); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[560px] max-w-[calc(100vw-2rem)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="พิมพ์ชื่ออะไหล่ รหัส เลข part ยี่ห้อ หรือหมวด (หลายคำได้)…"
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="ล้างคำค้น">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1.5">
            {extraRows.length > 0 && (
              <CommandPrimitive.Group heading="บริการ" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                {extraRows.map((e) => (
                  <CommandPrimitive.Item key={e.code} value={`extra:${e.code}`} onSelect={() => pickExtra(e)} className={itemCls}>
                    <span className="num w-[72px] shrink-0 font-medium">{e.code}</span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.price !== undefined && <span className="num shrink-0 text-xs text-muted-foreground">{baht(e.price)}</span>}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {rows.length === 0 && extraRows.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {products.length === 0 ? "กำลังโหลดรายการอะไหล่…" : `ไม่พบอะไหล่ที่ตรงกับ "${term}"`}
              </p>
            )}
            {rows.length > 0 && (
              <CommandPrimitive.Group
                heading={term ? `อะไหล่ (${rows.length}${rows.length === MAX_ROWS ? "+" : ""} รายการ)` : "อะไหล่ — พิมพ์เพื่อค้นหา"}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {rows.map((p) => (
                  <CommandPrimitive.Item key={p.sysCode} value={p.sysCode} onSelect={() => pickProduct(p)} className={itemCls}>
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        <span className="num">{p.sysCode}</span>
                        {p.mfgCode ? <> · <span className="num">{p.mfgCode}</span></> : null}
                        {p.brand ? ` · ${p.brand}` : ""}
                        {p.category && p.category !== "ยังไม่ระบุ" ? ` · ${p.category}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-xs font-medium">{baht(p.price)}</span>
                      {p.onhand > 0 ? (
                        <span className="num block text-2xs text-muted-foreground">คงเหลือ {p.onhand}</span>
                      ) : (
                        <Badge tone="danger" className="mt-0.5 px-1.5">หมด</Badge>
                      )}
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
