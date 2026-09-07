import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { int } from "@/lib/utils";

const TONES = {
  primary: {
    bar: "bg-primary",
    text: "text-primary",
    soft: "bg-primary-soft",
  },
  warning: { bar: "bg-warning", text: "text-warning", soft: "bg-warning-soft" },
  info: { bar: "bg-info", text: "text-info", soft: "bg-info-soft" },
  success: { bar: "bg-success", text: "text-success", soft: "bg-success-soft" },
  danger: { bar: "bg-danger", text: "text-danger", soft: "bg-danger-soft" },
} as const;

export function StatCard({
  label,
  sub,
  value,
  unit = "Jobs",
  percent,
  tone = "primary",
  icon: Icon,
  href,
}: {
  label: string;
  sub?: string;
  value: number;
  unit?: string;
  percent: number;
  tone?: keyof typeof TONES;
  icon?: React.ElementType;
  href?: string;
}) {
  const t = TONES[tone];
  return (
    <div className="surface group relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 flex items-baseline gap-1.5">
            <span className="num text-2xl font-semibold tracking-tight">
              {int(value)}
            </span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </p>
        </div>
        {Icon && (
          <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", t.soft)}>
            <Icon className={cn("h-4 w-4", t.text)} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all duration-500", t.bar)}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <span className={cn("num text-xs font-medium", t.text)}>
          {percent.toFixed(2)}%
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="truncate text-2xs text-muted-foreground">{sub}</p>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-0.5 text-2xs font-medium text-primary hover:underline"
          >
            More info <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
