'use client';

import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { ChevronsUpDown, Loader2, Package, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/shadcn/popover';
import { Badge } from '@/components/ui/badge';
import { MAX_ROWS, matchProducts, type PickableProduct } from '@/lib/product-match';
import { baht, cn } from '@/lib/utils';
import { useFieldControl } from '@/components/ui/field';
import { useProductSearch } from '@/data/db';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** shortest word sent to the server — 1 letter would match most of the catalog */
const MIN_CHARS = 2;

/** Non-stock lines a form may offer (e.g. SVD0001 ค่าขนส่ง) — pinned above the search results. */
export type ExtraItem = { code: string; name: string; price?: number };

/** What `onPick` hands back — `product` is set for stock items, absent for extras. */
export type PickedItem = { code: string; name: string; price?: number; product?: PickableProduct };

/**
 * Part picker: searches ACTIVE products on the server as you type (debounced, never the whole catalog) and
 * ranks the answer here — every typed word must appear (code / part no / TH·EN·CN name / brand / category).
 * The server narrows by the longest word; the last answer stays on screen while the next one loads.
 */
export function ProductPicker({
  value,
  onPick,
  extras,
  fallbackName,
  placeholder = 'ค้นหา ชื่อ / รหัส / เลข part / ยี่ห้อ…',
  size = 'md',
  className,
  align = 'start',
  clearable = false,
  id,
}: {
  /** selected sysCode (or an extra's code); empty = nothing chosen */
  value?: string;
  /** `null` when cleared */
  onPick: (item: PickedItem | null) => void;
  extras?: ExtraItem[];
  /** name shown for `value` when it was not picked here (a line already on the document — its stored name) */
  fallbackName?: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  align?: 'start' | 'end';
  clearable?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldControl(id, { label: placeholder });
  const popupId = React.useId();
  const [q, setQ] = React.useState('');
  const term = q.trim();

  // the server matches the longest word against code / part no / names / brand / category (stock.ts productSearch);
  // the other words narrow the results here with the same matcher
  const settled = useDebouncedValue(term, 250);
  const serverTerm = settled.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '');
  const searchable = serverTerm.length >= MIN_CHARS;
  const found = useProductSearch(searchable ? serverTerm : '', { keepPrevious: true });
  const typedEnough = term.split(/\s+/).some((w) => w.length >= MIN_CHARS);
  const rows = React.useMemo(
    () => (typedEnough && searchable && !found.error ? matchProducts(found.data ?? [], term) : []),
    [typedEnough, searchable, found.data, found.error, term],
  );
  const loading = typedEnough && (term !== settled || found.validating);
  const extraRows = React.useMemo(() => {
    if (!extras?.length) return [];
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    return extras.filter((e) => words.every((w) => `${e.code} ${e.name}`.toLowerCase().includes(w)));
  }, [extras, term]);

  // the name of what was picked here (there is no catalog to look `value` up in)
  const [picked, setPicked] = React.useState<{ code: string; name: string } | null>(null);
  const selectedExtra = value ? extras?.find((e) => e.code === value) : undefined;
  const label =
    (value && picked?.code === value ? picked.name : undefined) ?? selectedExtra?.name ?? fallbackName ?? '';

  const pick = (item: PickedItem | null) => {
    setPicked(item);
    onPick(item);
    setOpen(false);
    setQ('');
  };
  const pickProduct = (p: PickableProduct) => pick({ code: p.sysCode, name: p.name, price: p.price, product: p });
  const pickExtra = (e: ExtraItem) => pick({ code: e.code, name: e.name, price: e.price });

  const itemCls =
    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground';

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      {/* the clear × is a sibling of the combobox (no button inside a button), laid over its right end */}
      <div className={cn('relative w-full', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            {...field}
            aria-expanded={open}
            aria-controls={open ? popupId : undefined} // the popup, only while it is rendered
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault(); // ↓ / Alt+↓ open it, as on a native select
                setOpen(true);
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20',
              size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
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
              <span className="h-3.5 w-3.5 shrink-0" /> // room for the clear button below
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        {clearable && value && (
          <button
            type="button"
            aria-label="ล้างการเลือก"
            onClick={() => pick(null)}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        id={popupId}
        aria-label={'ค้นหาอะไหล่'}
        align={align}
        className="w-[560px] max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CommandPrimitive
          label={'ค้นหาอะไหล่'}
          shouldFilter={false}
          loop
          className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="พิมพ์ชื่ออะไหล่ รหัส เลข part ยี่ห้อ หรือหมวด (หลายคำได้)…"
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="กำลังค้นหา" />
            ) : (
              q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="ล้างคำค้น"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )
            )}
          </div>
          <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1.5" aria-busy={loading}>
            {extraRows.length > 0 && (
              <CommandPrimitive.Group
                heading="บริการ"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {extraRows.map((e) => (
                  <CommandPrimitive.Item
                    key={e.code}
                    value={`extra:${e.code}`}
                    onSelect={() => pickExtra(e)}
                    className={itemCls}
                  >
                    <span className="num w-[72px] shrink-0 font-medium">{e.code}</span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.price !== undefined && (
                      <span className="num shrink-0 text-xs text-muted-foreground">{baht(e.price)}</span>
                    )}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {!typedEnough ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                พิมพ์อย่างน้อย {MIN_CHARS} ตัวอักษร — ชื่ออะไหล่ รหัส เลข part ยี่ห้อ หรือหมวด (หลายคำได้ เพื่อกรองต่อ)
              </p>
            ) : found.error && !loading ? (
              <p role="alert" className="px-3 py-5 text-center text-sm text-danger">
                ค้นหาอะไหล่ไม่สำเร็จ{' '}
                <button
                  type="button"
                  onClick={() => void found.mutate()}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  ลองใหม่
                </button>
              </p>
            ) : (
              rows.length === 0 &&
              extraRows.length === 0 && (
                <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                  {loading ? 'กำลังค้นหา…' : `ไม่พบอะไหล่ที่ตรงกับ "${term}"`}
                </p>
              )
            )}
            {rows.length > 0 && (
              <CommandPrimitive.Group
                heading={`อะไหล่ (${rows.length}${rows.length === MAX_ROWS ? '+' : ''} รายการ)`}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {rows.map((p) => (
                  <CommandPrimitive.Item
                    key={p.sysCode}
                    value={p.sysCode}
                    onSelect={() => pickProduct(p)}
                    className={itemCls}
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        <span className="num">{p.sysCode}</span>
                        {p.mfgCode ? (
                          <>
                            {' '}
                            · <span className="num">{p.mfgCode}</span>
                          </>
                        ) : null}
                        {p.brand ? ` · ${p.brand}` : ''}
                        {p.category && p.category !== 'ยังไม่ระบุ' ? ` · ${p.category}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-xs font-medium">{baht(p.price)}</span>
                      {p.onhand > 0 ? (
                        <span className="num block text-2xs text-muted-foreground">คงเหลือ {p.onhand}</span>
                      ) : (
                        <Badge tone="danger" className="mt-0.5 px-1.5">
                          หมด
                        </Badge>
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
