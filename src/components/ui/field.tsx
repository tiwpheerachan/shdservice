"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Field = label + one control (+ hint / error). The label is tied to the control automatically:
 * Field makes an id (React.useId) and the FIRST form control rendered inside it (Input, Select,
 * Textarea, NumberInput, SearchSelect and the pickers — via useFieldControl) takes it, together
 * with aria-describedby (hint / error) and aria-invalid. So clicking the label focuses the control,
 * and screen readers announce "ประเภทงานหลัก, combobox" instead of an unnamed box.
 * A control that already has its own `id` keeps it and the label follows it.
 */
type FieldCtx = {
  id: string;
  describedBy?: string;
  invalid: boolean;
  /** which control inside owns the label (the first one rendered) */
  owner: React.RefObject<string | null>;
};
const FieldContext = React.createContext<FieldCtx | null>(null);

export type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * For form controls: the props that tie this control to the surrounding Field's label.
 * Only the first control in a Field gets them; outside a Field it returns just `{ id }`.
 */
export function useFieldControl(ownId?: string): FieldControlProps {
  const ctx = React.useContext(FieldContext);
  const token = React.useId();
  if (ctx && ctx.owner.current === null) ctx.owner.current = token;
  const primary = !!ctx && ctx.owner.current === token;
  const owner = ctx?.owner;
  React.useEffect(() => {
    if (!owner) return;
    return () => {
      if (owner.current === token) owner.current = null; // unmounted → the next control takes over
    };
  }, [owner, token]);
  if (!primary) return ownId ? { id: ownId } : {};
  return {
    id: ownId ?? ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid || undefined,
  };
}

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
  /** only needed when the control is NOT rendered inside this Field */
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const auto = React.useId();
  // a single child that brings its own id (e.g. <ProductPicker id="so-product" />) keeps it
  const childId =
    React.isValidElement<{ id?: unknown }>(children) && typeof children.props.id === "string" ? children.props.id : undefined;
  const id = htmlFor ?? childId ?? `${auto}-control`;
  const hintId = hint && !error ? `${auto}-hint` : undefined;
  const errorId = error ? `${auto}-error` : undefined;
  const owner = React.useRef<string | null>(null);
  const ctx = React.useMemo<FieldCtx>(
    () => ({ id, describedBy: errorId ?? hintId, invalid: !!error, owner }),
    [id, errorId, hintId, error]
  );

  return (
    <div className={cn("min-w-0", wide && "col-span-full", className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {required && (
            <span className="text-danger" aria-hidden>
              *
            </span>
          )}
          {label}
          {required && <span className="sr-only">(จำเป็น)</span>}
        </label>
      )}
      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>
      {hintId && (
        <p id={hintId} className="mt-1 text-2xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} role="alert" className="mt-1 text-2xs text-danger">
          {error}
        </p>
      )}
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
