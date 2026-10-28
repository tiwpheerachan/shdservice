'use client';

import * as React from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './field';
import { useUploading } from '@/lib/api';
import { Checkbox as ShadcnCheckbox } from '@/components/shadcn/checkbox';

const base =
  'w-full rounded-md border border-input bg-card text-foreground placeholder:text-muted-foreground ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground ' +
  'read-only:bg-muted/60';
// text-base on phones: iOS Safari zooms into any field under 16px when it is focused

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const field = useFieldControl(props.id);
    return <input ref={ref} className={cn(base, 'h-9 px-3 text-base md:text-sm', className)} {...props} {...field} />;
  },
);
Input.displayName = 'Input';

/** an amount as money looks: "800.00" ('' stays '') */
export function moneyShown(value: string | number | undefined | null): string | number {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

/** a money amount field (baht): the number keypad, right-aligned, shown with 2 decimals once left */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, value, onFocus, onBlur, onChange, ...props }, ref) => {
    // what is being typed, exactly as typed ("0.7", "12."): the box never reformats under the caret. Not set on
    // focus — a focus that changes the text loses the select-all, and typing then appends ("250" → "250250")
    const [draft, setDraft] = React.useState<string | null>(null);
    return (
      <Input
        ref={ref}
        type="number"
        step="0.01"
        min={0}
        inputMode="decimal"
        placeholder="0.00"
        {...props}
        value={draft ?? moneyShown(value as string | number | undefined)}
        onFocus={(e) => {
          e.currentTarget.select(); // a click on an amount replaces it
          onFocus?.(e);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange?.(e);
        }}
        onBlur={(e) => {
          setDraft(null);
          onBlur?.(e);
        }}
        className={cn('num text-right', className)}
      />
    );
  },
);
MoneyInput.displayName = 'MoneyInput';

/** a file field in the app's look (Thai text, the chosen file's name) — not the browser's "Choose File / No file chosen" */
export function FileInput({
  placeholder = 'เลือกไฟล์',
  onFile,
  disabled,
  ...props
}: {
  placeholder?: string;
  /** `false` (or a promise of it) = the upload failed: the chosen file's name is not kept on screen */
  onFile: (f: File | undefined) => void | boolean | Promise<void | boolean>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'className'>) {
  const field = useFieldControl(props.id);
  const [name, setName] = React.useState('');
  // one upload at a time: a second file picked while one is still going up would race it
  const uploading = useUploading();
  const busy = disabled || uploading;
  return (
    <label
      className={cn(
        'relative flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-within:border-primary focus-within:text-foreground',
        busy && 'pointer-events-none opacity-50',
      )}
    >
      <Upload className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{name || placeholder}</span>
      <input
        type="file"
        className="sr-only"
        disabled={busy}
        {...props}
        {...field}
        onChange={(e) => {
          const f = e.target.files?.[0];
          setName(f?.name ?? '');
          e.target.value = ''; // the same file can be chosen again (after a failed upload)
          void Promise.resolve(onFile(f)).then((ok) => ok === false && setName(''));
        }}
      />
    </label>
  );
}

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
  placeholder = '0.00',
  showZero = false,
  ...props
}: {
  value: number;
  onChange: (n: number) => void;
  /** a stored 0 (an existing record's free line / no service fee) shows as 0, not as an empty box */
  showZero?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const field = useFieldControl(props.id);
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value === 0 && !showZero ? '' : value}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={cn(base, 'h-9 px-3 text-base md:text-sm num text-right', className)}
      {...props}
      {...field}
    />
  );
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => {
    const field = useFieldControl(props.id);
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(base, 'px-3 py-2 text-base md:text-sm resize-y min-h-[38px]', className)}
        {...props}
        {...field}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    const field = useFieldControl(props.id);
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(base, 'h-9 pl-3 pr-8 text-base md:text-sm appearance-none cursor-pointer', className)}
          {...props}
          {...field}
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
    );
  },
);
Select.displayName = 'Select';

/**
 * Checkbox — Radix/shadcn underneath (keyboard, indeterminate, aria-checked),
 * but keeps the native-input props the app uses: `checked`, `defaultChecked`,
 * `onChange(e)` (e.target.checked), `disabled`, `name`, `aria-label`.
 */
export function Checkbox({
  className,
  checked,
  defaultChecked,
  onChange,
  disabled,
  name,
  value,
  id,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>) {
  return (
    <ShadcnCheckbox
      id={id}
      name={name}
      value={value as string | undefined}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onCheckedChange={(c) =>
        onChange?.({
          target: { checked: c === true, name, value },
          currentTarget: { checked: c === true, name, value },
        } as unknown as React.ChangeEvent<HTMLInputElement>)
      }
      className={cn('h-4 w-4 shrink-0 rounded-[4px] border-input shadow-none cursor-pointer', className)}
      aria-label={props['aria-label']}
      title={props.title}
    />
  );
}

/** disabled (view mode) is drawn here: the browser's grey disabled radio looks the same checked or not */
export function Radio({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="radio"
      className={cn(
        'h-4 w-4 shrink-0 border-input accent-[hsl(var(--primary))] cursor-pointer',
        'disabled:appearance-none disabled:rounded-full disabled:border disabled:bg-muted disabled:checked:border-[5px] disabled:checked:border-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
