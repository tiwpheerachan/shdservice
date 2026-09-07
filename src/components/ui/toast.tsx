"use client";

import * as React from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info" | "warning";
type Toast = { id: number; kind: ToastKind; title: string; desc?: string };

const Ctx = React.createContext<{
  push: (t: Omit<Toast, "id">) => void;
}>({ push: () => {} });

export const useToast = () => React.useContext(Ctx);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const STYLES: Record<ToastKind, string> = {
  success: "border-success/30 bg-success-soft text-success",
  error: "border-danger/30 bg-danger-soft text-danger",
  info: "border-info/30 bg-info-soft text-info",
  warning: "border-warning/30 bg-warning-soft text-warning",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const remove = React.useCallback(
    (id: number) => setItems((s) => s.filter((t) => t.id !== id)),
    []
  );

  const push = React.useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++idRef.current;
      setItems((s) => [...s, { ...t, id }].slice(-4));
      setTimeout(() => remove(id), 3600);
    },
    [remove]
  );

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 no-print">
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card p-3 shadow-pop animate-slide-up",
                STYLES[t.kind]
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-card-foreground">{t.title}</p>
                {t.desc && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
                )}
              </div>
              <button
                onClick={() => remove(t.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="ปิด"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
