"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-input bg-card text-foreground placeholder:text-muted-foreground/70 " +
  "transition-[border-color,box-shadow] duration-150 " +
  "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground " +
  "read-only:bg-muted/60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, "h-9 px-3 text-sm", className)} {...props} />
));
Input.displayName = "Input";

/**
 * Numeric input tuned for easy data entry:
 * - shows an empty field (with a "0.00" placeholder) instead of a literal 0,
 *   so you can type straight away without deleting the leading zero
 * - selects the whole value on focus, so an existing number is overwritten by typing
 */
export function NumberInput({
  value,
  onChange,
  className,
  placeholder = "0.00",
  ...props
}: {
  value: number;
  onChange: (n: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value === 0 ? "" : value}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={cn(base, "h-9 px-3 text-sm num text-right", className)}
      {...props}
    />
  );
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(base, "px-3 py-2 text-sm resize-y min-h-[38px]", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        base,
        "h-9 pl-3 pr-8 text-sm appearance-none cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
));
Select.displayName = "Select";

export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 rounded border-input text-primary accent-[hsl(var(--primary))] cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

export function Radio({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="radio"
      className={cn(
        "h-4 w-4 shrink-0 border-input accent-[hsl(var(--primary))] cursor-pointer",
        className
      )}
      {...props}
    />
  );
}
