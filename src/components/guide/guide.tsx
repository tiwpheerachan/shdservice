"use client";

import * as React from "react";
import { BookOpen, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccess } from "@/lib/use-access";
import { Input } from "@/components/ui/input";
import { GUIDE, type TopicGroup } from "./content";

/**
 * คู่มือการใช้งาน — หัวข้อซ้าย (ติดขอบบนขณะเลื่อน) / การ์ดเนื้อหาขวา
 * · หัวข้อที่กำลังอ่านถูกไฮไลต์ตามตำแหน่งเลื่อน (IntersectionObserver)
 * · ช่องค้นหากรองตามชื่อหัวข้อ / ชื่อกลุ่ม
 * · กลุ่มที่ติด adminOnly แสดงเฉพาะ System Admin
 * · จอเล็ก: หัวข้อกลายเป็น dropdown กระโดดไปหัวข้อ
 */
export function Guide() {
  const { isAdmin } = useAccess();
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState<string>("");
  const navRef = React.useRef<HTMLElement>(null);

  const groups = React.useMemo<TopicGroup[]>(() => {
    const visible = GUIDE.filter((g) => !g.adminOnly || isAdmin);
    const term = q.trim().toLowerCase();
    if (!term) return visible;
    return visible
      .map((g) => ({ ...g, topics: g.topics.filter((t) => t.title.toLowerCase().includes(term) || g.title.toLowerCase().includes(term)) }))
      .filter((g) => g.topics.length > 0);
  }, [isAdmin, q]);
  const total = groups.reduce((n, g) => n + g.topics.length, 0);

  // highlight the topic nearest the top of the viewport
  React.useEffect(() => {
    const els = groups.flatMap((g) => g.topics).map((t) => document.getElementById(`guide-${t.id}`)).filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id.replace(/^guide-/, ""));
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  // keep the highlighted topic visible inside the (scrolling) topic list — scroll the
  // list only, never the page
  React.useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(`[data-topic="${active}"]`);
    if (!nav || !el) return;
    const top = el.offsetTop; // nav is position:relative → offsetTop is relative to the list itself
    if (top < nav.scrollTop + 8) nav.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (top + el.offsetHeight > nav.scrollTop + nav.clientHeight - 8) nav.scrollTo({ top: top + el.offsetHeight - nav.clientHeight + 8, behavior: "smooth" });
  }, [active]);

  // open at #hash (from the ? button or a shared link)
  React.useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id) document.getElementById(`guide-${id}`)?.scrollIntoView({ block: "start" });
  }, []);

  const jump = (id: string) => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
      {/* ---- topic list ---- */}
      <aside className="md:sticky md:top-[4.75rem] md:self-start">
        {/* one tall card, like the topbar height away from the viewport bottom — the topic list scrolls inside it */}
        <div className="surface flex flex-col p-3 md:h-[calc(100vh-6rem)]">
          <div className="flex items-center gap-2 px-1 pb-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">ทุกหัวข้อ</span>
            <span className="rounded-full bg-muted px-2 py-px text-2xs font-medium text-muted-foreground">{total}</span>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหัวข้อ…" className="h-8 pl-8 pr-7 text-xs" aria-label="ค้นหัวข้อ" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="ล้าง">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* small screens: jump list */}
          <select
            className="mb-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm md:hidden"
            value={active}
            onChange={(e) => jump(e.target.value)}
            aria-label="ไปที่หัวข้อ"
          >
            <option value="">ไปที่หัวข้อ…</option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.title}>
                {g.topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <nav ref={navRef} className="relative hidden min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin] md:block" aria-label="หัวข้อคู่มือ">
            {groups.map((g) => (
              <div key={g.id}>
                <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</p>
                <ul className="space-y-0.5">
                  {g.topics.map((t) => {
                    const on = active === t.id;
                    return (
                      <li key={t.id} data-topic={t.id}>
                        <button
                          onClick={() => jump(t.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                            on ? "bg-primary-soft font-medium text-primary" : "text-foreground/80 hover:bg-accent hover:text-foreground"
                          )}
                          aria-current={on ? "true" : undefined}
                        >
                          <t.icon className={cn("h-3.5 w-3.5 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                          <span className="truncate">{t.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {groups.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">ไม่พบหัวข้อ "{q}"</p>}
          </nav>
        </div>
      </aside>

      {/* ---- content ---- */}
      <div className="min-w-0 space-y-8">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`guide-group-${g.id}`}>
            <h2 id={`guide-group-${g.id}`} className="mb-3 px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {g.title}
            </h2>
            <div className="space-y-4">
              {g.topics.map((t) => (
                <article key={t.id} id={`guide-${t.id}`} className="surface scroll-mt-[4.75rem] p-5 sm:p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <t.icon className="h-4 w-4" />
                    </span>
                    <h3 className="text-base font-semibold tracking-tight sm:text-lg">{t.title}</h3>
                  </div>
                  <div className="space-y-3">{t.body}</div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div className="surface p-10 text-center text-sm text-muted-foreground">ไม่พบหัวข้อที่ตรงกับ "{q}"</div>
        )}
      </div>
    </div>
  );
}
