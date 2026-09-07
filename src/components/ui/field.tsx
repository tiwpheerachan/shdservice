import * as React from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  className,
  children,
  wide,
}: {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-full", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"
        >
          {required && <span className="text-danger">*</span>}
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="mt-1 text-2xs text-danger">{error}</p>}
    </div>
  );
}

export function FieldGrid({
  cols = 4,
  className,
  children,
}: {
  cols?: 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}) {
  const map = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  } as const;
  return (
    <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3.5", map[cols], className)}>
      {children}
    </div>
  );
}

export function ReadOnly({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center rounded-md border border-border bg-muted/60 px-3 text-sm text-foreground">
      {children || <span className="text-muted-foreground">—</span>}
    </div>
  );
}
