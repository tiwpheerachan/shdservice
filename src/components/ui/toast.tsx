"use client";

import * as React from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/shadcn/sonner";
import { CheckCircle2, Info, AlertTriangle, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "info" | "warning";
type ToastInput = { kind: ToastKind; title: string; desc?: string };

/**
 * App toasts — same `useToast().push({ kind, title, desc })` API as before, now
 * rendered by Sonner (stacking, pause on hover, swipe to dismiss, a11y live region).
 */
const push = (t: ToastInput) => {
  const fn = t.kind === "error" ? toast.error : t.kind === "success" ? toast.success : t.kind === "warning" ? toast.warning : toast.info;
  fn(t.title, { description: t.desc });
};

const Ctx = React.createContext<{ push: (t: ToastInput) => void }>({ push });

export const useToast = () => React.useContext(Ctx);

const TONE: Record<ToastKind, string> = {
  success: "border-success/30! bg-success-soft! text-success!",
  error: "border-danger/30! bg-danger-soft! text-danger!",
  info: "border-info/30! bg-info-soft! text-info!",
  warning: "border-warning/30! bg-warning-soft! text-warning!",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <Toaster
        position="bottom-right"
        duration={3600}
        visibleToasts={4}
        gap={8}
        offset={16}
        closeButton
        className="no-print"
        icons={{
          success: <CheckCircle2 className="h-4 w-4" />,
          error: <XCircle className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <AlertTriangle className="h-4 w-4" />,
        }}
        toastOptions={{
          classNames: {
            toast: "items-start! gap-2.5! rounded-lg! border! bg-card! p-3! shadow-pop! font-sans! w-[min(360px,calc(100vw-2rem))]!",
            title: "text-sm! font-medium! text-card-foreground!",
            description: "mt-0.5! text-xs! text-muted-foreground!",
            icon: "mt-0.5! m-0!",
            closeButton: "static! order-last! ml-auto! h-auto! w-auto! rounded! border-0! bg-transparent! p-0.5! text-muted-foreground! translate-x-0! translate-y-0! hover:bg-black/5! dark:hover:bg-white/10!",
            success: TONE.success,
            error: TONE.error,
            info: TONE.info,
            warning: TONE.warning,
          },
        }}
      />
    </Ctx.Provider>
  );
}
