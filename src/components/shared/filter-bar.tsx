"use client";

import * as React from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  onSearch,
  onReset,
  className,
  title = "ค้นหาข้อมูลโดย",
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
  return (
    <div className={cn("surface overflow-hidden no-print", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-border bg-muted/35 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="h-4 w-4 text-primary" />
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {open ? "ซ่อนตัวกรอง" : "แสดงตัวกรอง"}
        </span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {children}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button size="sm" onClick={onSearch}>
                <Search className="h-3.5 w-3.5" />
                ค้นหา
              </Button>
              <Button size="sm" variant="outline" onClick={onReset}>
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
