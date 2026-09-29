"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Field = label + one control (+ hint / error). The label is tied to the control automatically:
 * Field makes an id (React.useId) and the FIRST form control mounted inside it (Input, Select,
 * Textarea, NumberInput, SearchSelect and the pickers — via useFieldControl) takes it, together
 * with aria-describedby (hint / error) and aria-invalid. So clicking the label focuses the control,
 * and screen readers announce "ประเภทงานหลัก, combobox" instead of an unnamed box.
 * A control that already has its own `id` keeps it and the label follows it.
 *
 * Controls register in a layout effect (never by writing during render — a render React throws
 * away must not leave the label pointing at nothing); the owner is settled before the browser paints.
 *
 * The label never points at nothing (WAI-ARIA APG):
 *  - a labelable control (input / select / textarea / button) owns it → <label for>
 *  - a read-only value (<ReadOnly>) owns it → no `for`; the value is named by aria-labelledby
 *  - `group` (radios / checkboxes that carry their own labels) → the wrapper is a named
 *    radiogroup / group (aria-labelledby), each option keeps its own label
 */
type FieldCtx = {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  /** the control that owns the label: the first one registered that is still mounted */
  owner: string | null;
  /** a control announces itself (labelable = a real form control); returns its unregister */
  register: (token: string, labelable: boolean) => () => void;
};
const FieldContext = React.createContext<FieldCtx | null>(null);

export type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-labelledby"?: string;
};

/**
 * For form controls: the props that tie this control to the surrounding Field's label.
 * Only the first control in a Field gets them; outside a Field it returns just `{ id }`.
 * `labelable: false` — not a form control (a read-only value): named by aria-labelledby instead.
 */
export function useFieldControl(ownId?: string, opts: { labelable?: boolean } = {}): FieldControlProps {
  const labelable = opts.labelable ?? true;
  const ctx = React.useContext(FieldContext);
  const token = React.useId();
  const register = ctx?.register;
  React.useLayoutEffect(() => register?.(token, labelable), [register, token, labelable]);
  const primary = !!ctx && ctx.owner === token;
  if (!primary) return ownId ? { id: ownId } : {};
  return {
    id: ownId ?? ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid || undefined,
    ...(labelable ? {} : { "aria-labelledby": ctx.labelId }),
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
  group,
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
  /** the children are options with their own labels (radios / checkboxes) — the label names the group */
  group?: "radiogroup" | "group";
}) {
  const auto = React.useId();
  const labelId = `${auto}-label`;
  // a single child that brings its own id (e.g. <ProductPicker id="so-product" />) keeps it
  const childId =
    React.isValidElement<{ id?: unknown }>(children) && typeof children.props.id === "string" ? children.props.id : undefined;
  const id = htmlFor ?? childId ?? `${auto}-control`;
  const hintId = hint && !error ? `${auto}-hint` : undefined;
  const errorId = error ? `${auto}-error` : undefined;
  // controls in mount order (layout effects run in tree order → the first control in the markup
  // registers first); unmounting the owner hands the label to the next one
  const [owner, setOwner] = React.useState<{ token: string; labelable: boolean } | null>(null);
  const registered = React.useRef<{ token: string; labelable: boolean }[]>([]);
  const register = React.useCallback((token: string, labelable: boolean) => {
    registered.current = [...registered.current, { token, labelable }];
    setOwner(registered.current[0]);
    return () => {
      registered.current = registered.current.filter((r) => r.token !== token);
      setOwner(registered.current[0] ?? null);
    };
  }, []);
  const ctx = React.useMemo<FieldCtx>(
    () => ({ id, labelId, describedBy: errorId ?? hintId, invalid: !!error, owner: owner?.token ?? null, register }),
    [id, labelId, errorId, hintId, error, owner, register]
  );
  // `for` only when it reaches a real form control: one that registered as labelable, or an id the
  // page named itself (htmlFor / the child's own id)
  const labelFor = htmlFor ?? childId ?? (!group && owner?.labelable ? id : undefined);

  return (
    <div className={cn("min-w-0", wide && "col-span-full", className)}>
      {label && (
        <label id={labelId} htmlFor={labelFor} className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {required && (
            <span className="text-danger" aria-hidden>
              *
            </span>
          )}
          {label}
          {required && <span className="sr-only">(จำเป็น)</span>}
        </label>
      )}
      <FieldContext.Provider value={ctx}>
        {group ? (
          <div role={group} aria-labelledby={label ? labelId : undefined} aria-describedby={errorId ?? hintId} aria-required={group === "radiogroup" && required ? true : undefined}>
            {children}
          </div>
        ) : (
          children
        )}
      </FieldContext.Provider>
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

/** a value shown in a Field that cannot be edited — announced as "<label>, read-only, <value>" */
export function ReadOnly({ children }: { children: React.ReactNode }) {
  const field = useFieldControl(undefined, { labelable: false });
  return (
    <div
      {...field}
      role="textbox"
      aria-readonly="true"
      className="flex h-9 items-center rounded-md border border-border bg-muted/60 px-3 text-sm text-foreground"
    >
      {children || <span className="text-muted-foreground">—</span>}
    </div>
  );
}
