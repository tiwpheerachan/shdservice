"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { ALL_LINKS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const results = React.useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = n
      ? ALL_LINKS.filter(
          (l) =>
            l.title.toLowerCase().includes(n) || l.group.toLowerCase().includes(n)
        )
      : ALL_LINKS;
    return list.slice(0, 12);
  }, [q]);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  React.useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh] no-print">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-pop animate-scale-in">
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && results[idx]) {
                go(results[idx].href);
              } else if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
            placeholder="ค้นหาเมนู… (เช่น เปิดงานใหม่, อะไหล่, รายงาน)"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              ไม่พบเมนูที่ตรงกับคำค้น
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={r.href}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(r.href)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                i === idx ? "bg-primary-soft text-primary" : "hover:bg-accent"
              )}
            >
              <span className="truncate">
                <span className="font-medium">{r.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {r.groupNo}. {r.group}
                </span>
              </span>
              {i === idx && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
