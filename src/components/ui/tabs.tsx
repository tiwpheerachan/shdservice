"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * App tabs — same props/look (underline style), now Radix Tabs underneath
 * (roving focus, ←/→/Home/End keyboard navigation, proper tab/tabpanel roles).
 */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (k: string) => void;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onChange}>
      <TabsPrimitive.List
        className={cn("flex gap-1 overflow-x-auto no-scrollbar border-b border-border", className)}
      >
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <TabsPrimitive.Trigger
              key={t.key}
              value={t.key}
              className={cn(
                "relative shrink-0 px-3.5 py-2 text-sm font-medium transition-colors outline-hidden",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-md",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px text-2xs num",
                      active ? "bg-primary-soft text-primary" : "bg-muted"
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-opacity",
                  active ? "bg-primary opacity-100" : "opacity-0"
                )}
              />
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
