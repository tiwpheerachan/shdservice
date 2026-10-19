'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** what the dialog opens on: an element marked `data-autofocus` (anywhere in it, footer included), else
 *  its first field to fill (Radix alone would focus the close button). Not React's `autoFocus`: that
 *  focuses before Radix looks, so the opener would never be remembered for the focus return.
 *  :enabled / :not(:disabled) — a control disabled by a <fieldset disabled> (view mode) is skipped too */
const FIELD =
  'input:enabled:not([type=hidden]):not([readonly]), select:enabled, textarea:enabled:not([readonly]), [role=combobox]:not(:disabled)';

/**
 * App modal — same props/look as before, now a Radix Dialog underneath
 * (focus trap, Esc, scroll lock, aria-modal). Controlled without a Trigger, Radix has nothing to
 * give focus back to on close — so the element focused when it opened is remembered and refocused.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  alert,
  describedBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** a confirmation that interrupts (role=alertdialog) */
  alert?: boolean;
  /** id of the element in the body that describes the dialog (instead of `description`) */
  describedBy?: string;
}) {
  const w = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size];
  const body = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const returnTo = React.useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
          <DialogPrimitive.Overlay className="absolute inset-0 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <DialogPrimitive.Content
            ref={content}
            // only when set: an `undefined` here would erase Radix's own role="dialog" / aria-describedby
            {...(alert && { role: 'alertdialog' })}
            {...(describedBy && { 'aria-describedby': describedBy })}
            onOpenAutoFocus={(e) => {
              // still the opener here: Radix moves focus only after this event
              returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              const first =
                content.current?.querySelector<HTMLElement>('[data-autofocus]') ??
                [...(body.current?.querySelectorAll<HTMLElement>(FIELD) ?? [])].find(
                  (el) => el.getClientRects().length > 0, // not a display:none file input
                );
              first?.focus();
              // no field (a confirm, a view) or it refused focus: Radix's default (first tabbable / the dialog)
              if (first && document.activeElement === first) e.preventDefault();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (returnTo.current?.isConnected) returnTo.current.focus();
              returnTo.current = null;
            }}
            // a click on a toast (its "โหลดใหม่" / close) is not a click outside: the dialog stays open
            onInteractOutside={(e) => {
              if (e.target instanceof Element && e.target.closest('[data-sonner-toaster]')) e.preventDefault();
            }}
            className={cn(
              'relative z-10 w-full overflow-hidden rounded-xl border border-border bg-card shadow-pop outline-hidden data-[state=open]:animate-scale-in',
              w,
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
              <div>
                <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : (
                  <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close
                className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="ปิด"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
            <div ref={body} className="max-h-[65vh] overflow-y-auto px-5 py-4">
              {children}
            </div>
            {footer && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                {footer}
              </div>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
