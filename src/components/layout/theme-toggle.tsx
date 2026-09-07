"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/use-theme";
import { cn } from "@/lib/utils";

const OPTIONS: { key: ThemeMode; icon: typeof Sun; label: string }[] = [
  { key: "light", icon: Sun, label: "สว่าง" },
  { key: "dark", icon: Moon, label: "มืด" },
  { key: "system", icon: Monitor, label: "ตามระบบ" },
];

export function ThemeToggle() {
  const { mode, setMode, mounted } = useTheme();

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5"
      role="group"
      aria-label="โหมดการแสดงผล"
    >
      {OPTIONS.map((o) => {
        const active = mounted && mode === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setMode(o.key)}
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <o.icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
