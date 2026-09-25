"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { StatusBadge } from "@/components/ui/badge";
import { type Job } from "@/data/mock";
import { api, qs } from "@/lib/api";
import { cn, SEARCH_MIN_CHARS, SEARCH_MIN_HINT } from "@/lib/utils";

/**
 * Which jobs the dropdown offers — each job screen narrows the list to what it
 * can act on. Typing a full job no (J2612164) always loads that job regardless
 * of scope, so nothing that used to work through the GO button is blocked.
 */
export type JobSearchScope = "all" | "unassigned" | "open" | "closable";

const SCOPE: Record<JobSearchScope, { params: Record<string, string | number>; hint: string }> = {
  all: { params: {}, hint: "" },
  unassigned: { params: { unassigned: 1 }, hint: "แสดงเฉพาะงานที่รอรับมอบหมาย" },
  open: { params: { open: 1 }, hint: "แสดงเฉพาะงานที่ยังไม่ปิด" },
  closable: { params: { closable: 1 }, hint: "แสดงเฉพาะงานที่ซ่อมเสร็จ / รอลงเลขพัสดุ / รอลูกค้ามารับ" },
};

// full job no = profile prefix (J, HJ, …) + yy + 5 digits
const JOB_NO = /^[A-Z]{1,6}\d{7}$/;

export function JobSearch({
  id,
  value,
  onPick,
  scope = "all",
  className,
}: {
  id?: string;
  /** currently loaded job no — shown in the trigger */
  value?: string;
  /** called with the chosen job no (upper-cased); the page loads it the same way GO used to */
  onPick: (jobNo: string) => void | Promise<unknown>;
  scope?: JobSearchScope;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<Job[]>([]);
  const [loading, setLoading] = React.useState(false);
  const seq = React.useRef(0);
  const { params, hint } = SCOPE[scope];

  // debounced server search — same matcher as the job list (job no / customer code·name·phone /
  // reference no / IMEI / serial / model), newest first, max 10 rows
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < SEARCH_MIN_CHARS) { setRows([]); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ rows: Job[] }>(`/api/data/jobs${qs({ paged: 1, pageSize: 10, q: term, sort: "openDate", dir: "desc", ...params })}`)
        .then((d) => { if (my === seq.current) setRows(d.rows.slice(0, 10)); })
        .catch(() => { if (my === seq.current) setRows([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope]);

  const pick = (no: string) => {
    setOpen(false);
    setQ("");
    void onPick(no.trim().toUpperCase());
  };

  // a full job no picks itself as soon as the lookup confirms it (or, when it is outside this
  // screen's scope, on Enter — the page then loads it directly and reports what it finds)
  React.useEffect(() => {
    const term = q.trim().toUpperCase();
    if (JOB_NO.test(term) && rows.some((r) => r.no === term)) pick(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const term = q.trim();
  const exactOutside = JOB_NO.test(term.toUpperCase()) && !loading && !rows.some((r) => r.no === term.toUpperCase());

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-56 items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20",
            value ? "num font-medium text-foreground" : "text-muted-foreground",
            className
          )}
        >
          <span className="flex-1 truncate">{value || "เลขงาน / ลูกค้า / เบอร์ / Serial…"}</span>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[520px] max-w-[calc(100vw-2rem)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              onKeyDown={(e) => { if (e.key === "Enter" && exactOutside) { e.preventDefault(); pick(term); } }}
              placeholder="พิมพ์เลขงาน ชื่อลูกค้า เบอร์โทร Serial / IMEI หรือรุ่น…"
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="ล้าง">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1.5">
            {term.length < SEARCH_MIN_CHARS && (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                {SEARCH_MIN_HINT} — เลขงาน ชื่อ/รหัส/เบอร์ลูกค้า Serial, IMEI หรือรุ่น
              </p>
            )}
            {term.length >= SEARCH_MIN_CHARS && !loading && rows.length === 0 && !exactOutside && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">ไม่พบงานที่ตรงกับ "{term}"{hint ? ` (${hint})` : ""}</p>
            )}
            {exactOutside && rows.length === 0 && (
              <CommandPrimitive.Item
                value={`__exact__${term}`}
                onSelect={() => pick(term)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-hidden select-none data-[selected=true]:bg-accent"
              >
                <span className="num font-medium">{term.toUpperCase()}</span>
                <span className="text-xs text-muted-foreground">— เรียกงานนี้ตรง ๆ{hint ? ` (ไม่อยู่ในรายการ: ${hint})` : ""}</span>
              </CommandPrimitive.Item>
            )}
            {rows.map((j) => (
              <CommandPrimitive.Item
                key={j.no}
                value={j.no}
                onSelect={() => pick(j.no)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <span className="num w-[76px] shrink-0 font-medium">{j.no}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{j.customer}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {j.brandModel || "—"}
                    {j.serial ? ` · S/N ${j.serial}` : j.imei ? ` · IMEI ${j.imei}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <StatusBadge status={j.status} />
                  <span className="num mt-0.5 block text-2xs text-muted-foreground">{j.openDate}</span>
                </span>
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
          {hint && <p className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">{hint} · พิมพ์เลขงานเต็ม (เช่น J2612164) เพื่อเรียกงานอื่น</p>}
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
