'use client';

import * as React from 'react';
import { Filter, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function FilterBar({
  children,
  onSearch,
  onReset,
  className,
  title = 'ค้นหาข้อมูลโดย',
  defaultOpen = true,
}: {
  children: React.ReactNode;
  onSearch?: () => void;
  onReset?: () => void;
  className?: string;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  // date boxes come in from / to pairs (in that order): a reversed pair finds nothing, so say so and do not search
  const grid = React.useRef<HTMLDivElement>(null);
  const [reversed, setReversed] = React.useState(false);
  const checkRange = () => {
    const d = [...(grid.current?.querySelectorAll<HTMLInputElement>('input[type="date"]') ?? [])].map((i) => i.value);
    const bad = d.some((from, i) => i % 2 === 0 && !!from && !!d[i + 1] && from > d[i + 1]!);
    setReversed(bad);
    return bad;
  };
  const search = () => {
    if (!checkRange()) onSearch?.();
  };
  return (
    <div className={cn('surface overflow-hidden no-print', className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-border bg-muted/35 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="h-4 w-4 text-primary" />
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'ซ่อนตัวกรอง' : 'แสดงตัวกรอง'}</span>
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 p-4">
            {/* Enter in a text / date box runs the search (not while a Thai IME is composing, and not in a
                dropdown's own search box — there Enter picks the highlighted row) */}
            <div
              ref={grid}
              className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-4"
              onChange={(e) => {
                if (e.target instanceof HTMLInputElement && e.target.type === 'date') checkRange();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.defaultPrevented) return;
                if (!(e.target instanceof HTMLInputElement) || e.target.closest('[cmdk-root]')) return;
                e.preventDefault();
                search();
              }}
            >
              {children}
            </div>
            {reversed && (
              <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button size="sm" onClick={search}>
                <Search className="h-3.5 w-3.5" />
                ค้นหา
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReversed(false);
                  onReset?.();
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                ล้างค่า
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
