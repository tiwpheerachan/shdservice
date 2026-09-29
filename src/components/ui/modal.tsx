"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App modal — same props/look as before, now a Radix Dialog underneath
 * (focus trap, Esc, scroll lock, aria-modal, focus restore on close).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const w = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[size];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
          <DialogPrimitive.Overlay className="absolute inset-0 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <DialogPrimitive.Content
            className={cn(
              "relative z-10 w-full overflow-hidden rounded-xl border border-border bg-card shadow-pop outline-hidden data-[state=open]:animate-scale-in",
              w
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
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
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
