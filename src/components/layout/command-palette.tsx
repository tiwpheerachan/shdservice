"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Command as CommandPrimitive } from "cmdk";
import { Search, CornerDownLeft } from "lucide-react";
import { ALL_LINKS as EVERY_LINK } from "@/lib/nav";
import { useAccess } from "@/lib/use-access";
import { cn } from "@/lib/utils";

/**
 * ⌘K menu search — cmdk (fuzzy matching, keyboard navigation, aria listbox)
 * inside a Radix Dialog (focus trap, Esc, scroll lock). Same look as before.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { canPath } = useAccess();
  const links = React.useMemo(() => EVERY_LINK.filter((l) => canPath(l.href)), [canPath]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <div className="fixed inset-0 z-80 flex items-start justify-center p-4 pt-[12vh] no-print">
          <DialogPrimitive.Overlay className="absolute inset-0 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <DialogPrimitive.Content
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-pop outline-hidden data-[state=open]:animate-scale-in"
          >
            <DialogPrimitive.Title className="sr-only">ค้นหาเมนู</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">พิมพ์เพื่อค้นหาเมนู แล้วกด Enter เพื่อไป</DialogPrimitive.Description>
            <CommandPrimitive label="ค้นหาเมนู" loop>
              <div className="flex items-center gap-2 border-b border-border px-3.5">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CommandPrimitive.Input
                  autoFocus
                  placeholder="ค้นหาเมนู… (เช่น เปิดงานใหม่, อะไหล่, รายงาน)"
                  className="h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                />
                <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground sm:block">
                  Esc
                </kbd>
              </div>
              <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1.5">
                <CommandPrimitive.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                  ไม่พบเมนูที่ตรงกับคำค้น
                </CommandPrimitive.Empty>
                {links.map((r) => (
                  <CommandPrimitive.Item
                    key={r.href}
                    value={`${r.title} ${r.group}`}
                    onSelect={() => go(r.href)}
                    className={cn(
                      "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      "data-[selected=true]:bg-primary-soft data-[selected=true]:text-primary hover:bg-accent"
                    )}
                  >
                    <span className="truncate">
                      <span className="font-medium">{r.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.groupNo}. {r.group}
                      </span>
                    </span>
                    <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 group-data-[selected=true]:block" />
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.List>
            </CommandPrimitive>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
