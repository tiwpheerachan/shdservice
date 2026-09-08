"use client";

import * as React from "react";
import { Search, User, Loader2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Person = {
  id: string;
  name: string;
  email: string;
  department?: string;
  title?: string;
  avatar?: string;
};

/**
 * พิมพ์ชื่อแล้วเลือกคน — ดึงจาก central directory ผ่าน /api/directory/search
 * (API key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น) เลือกจากรายชื่อจริง ไม่ต้องพิมพ์อีเมลเอง
 */
export function PeoplePicker({
  value,
  onChange,
  placeholder = "พิมพ์ชื่อพนักงานเพื่อค้นหา…",
  className,
}: {
  value?: Person | null;
  onChange: (p: Person | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Person[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // close on outside click
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // debounced search
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/directory/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = await r.json();
        setItems(Array.isArray(data.items) ? data.items : []);
        setError(data.error ?? null);
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("ค้นหาไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const pick = (p: Person) => {
    onChange(p);
    setOpen(false);
    setQ("");
  };

  // selected chip
  if (value) {
    return (
      <div
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2.5",
          className
        )}
      >
        {value.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value.avatar}
            alt={value.name}
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-2xs font-semibold text-primary">
            {value.name.slice(0, 2).toUpperCase() || <User className="h-3 w-3" />}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">
          {value.name}
          {value.email && (
            <span className="ml-1.5 text-2xs text-muted-foreground">{value.email}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="ล้างการเลือก"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && items[active]) { e.preventDefault(); pick(items[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-pop">
          {loading && items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">กำลังค้นหา…</p>
          ) : error ? (
            <p className="px-3 py-3 text-xs text-danger">
              {error === "CENTRAL_API_KEY is not configured on the server"
                ? "ยังไม่ได้ตั้งค่า CENTRAL_API_KEY บนเซิร์ฟเวอร์"
                : "ค้นหาไม่สำเร็จ — ลองใหม่อีกครั้ง"}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">ไม่พบพนักงานที่ตรงกับ “{q}”</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {items.map((p, i) => (
                <li key={p.id || i}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(p)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
                      i === active ? "bg-accent" : "hover:bg-accent/60"
                    )}
                  >
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.avatar}
                        alt={p.name}
                        className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
                      />
                    ) : (
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground">
                        {p.name.slice(0, 2).toUpperCase() || <User className="h-3.5 w-3.5" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[p.title, p.department, p.email].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {i === active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
