import * as React from "react";
import { Info, AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Small building blocks for the user guide — plain prose, step lists,
 * field tables, callouts. Kept deliberately simple so the content file
 * reads like a document.
 * ------------------------------------------------------------------ */

export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm leading-relaxed text-foreground/90", className)}>{children}</p>;
}

/** Inline emphasis for a button / menu / field name as it appears on screen. */
export function UI({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

/** Inline literal value — a code, a number format, a status name. */
export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">{children}</code>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px]">{children}</kbd>;
}

/** Numbered steps — one <li> per step, may contain nested content. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed marker:font-semibold marker:text-primary">{children}</ol>;
}

export function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed marker:text-muted-foreground">{children}</ul>;
}

/** Two-column "field → what it is" table. */
export function Fields({ rows, head = ["ช่อง", "คืออะไร / กรอกอย่างไร"] }: { rows: [React.ReactNode, React.ReactNode][]; head?: [string, string] }) {
  return (
    <div className="table-scroll rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/60 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 sm:w-[38%]">{head[0]}</th>
            <th className="px-3 py-2">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-t border-border/70 align-top">
              <td className="px-3 py-2 font-medium">{k}</td>
              <td className="px-3 py-2 text-foreground/90">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONE = {
  info: { icon: Info, cls: "border-info/30 bg-info-soft text-foreground" },
  warn: { icon: AlertTriangle, cls: "border-warning/40 bg-warning-soft text-foreground" },
  tip: { icon: Lightbulb, cls: "border-success/30 bg-success-soft text-foreground" },
} as const;

export function Note({ tone = "info", title, children }: { tone?: keyof typeof TONE; title?: string; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-relaxed", t.cls)}>
      <t.icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

/** A named sub-section inside a topic card. */
export function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </div>
  );
}

/** Status badge-like chip used in flow diagrams and tables. */
export function Status({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" | "info" | "success" | "danger" | "primary" }) {
  const c = {
    muted: "bg-muted text-foreground/80",
    warning: "bg-warning-soft text-warning",
    info: "bg-info-soft text-info",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    primary: "bg-primary-soft text-primary",
  }[tone];
  return <span className={cn("inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium", c)}>{children}</span>;
}

/** Horizontal flow: A → B → C (wraps on small screens). */
export function Flow({ items }: { items: React.ReactNode[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}
          <span>{it}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
