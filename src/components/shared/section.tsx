import * as React from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  icon: Icon,
  description,
  actions,
  children,
  className,
  bodyClassName,
  collapsibleDefaultOpen,
}: {
  title: string;
  icon?: React.ElementType;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsibleDefaultOpen?: boolean;
}) {
  void collapsibleDefaultOpen;
  return (
    <section className={cn("surface overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/35 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" />}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {description && (
              <p className="truncate text-2xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
