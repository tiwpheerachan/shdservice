'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/shadcn/sonner';
import { CheckCircle2, Info, AlertTriangle, XCircle } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
/** `id`: the same id replaces a toast instead of stacking a second one; `action`: a button — the toast then stays until used or closed */
type ToastInput = {
  kind: ToastKind;
  title: string;
  desc?: string;
  id?: string;
  action?: { label: string; onClick: () => void };
  /** default bottom-right; 'top-center' keeps a note clear of a form and its save bar (the บทสอน's) */
  position?: 'top-center';
};

const push = (t: ToastInput) => {
  const fn =
    t.kind === 'error'
      ? toast.error
      : t.kind === 'success'
        ? toast.success
        : t.kind === 'warning'
          ? toast.warning
          : toast.info;
  // a body that only repeats the title (an API message + the same field error) is not shown twice
  const desc = t.desc && !t.title.includes(t.desc) ? t.desc : undefined;
  fn(t.title, {
    description: desc,
    id: t.id,
    position: t.position,
    // an error needs reading (and maybe acting on): 8 s, not the 3.6 s a "saved" gets (WCAG 2.2.1)
    ...(t.kind === 'error' && { duration: 8000 }),
    ...(t.action && { action: t.action, duration: Infinity }),
  });
};

const Ctx = React.createContext<{ push: (t: ToastInput) => void }>({ push });

export const useToast = () => React.useContext(Ctx);
/** take down a toast pushed with this `id` (an action toast stays until closed) */
export const dismissToast = (id: string) => toast.dismiss(id);

const TONE: Record<ToastKind, string> = {
  success: 'border-success/30! bg-success-soft! text-success!',
  error: 'border-danger/30! bg-danger-soft! text-danger!',
  info: 'border-info/30! bg-info-soft! text-info!',
  warning: 'border-warning/30! bg-warning-soft! text-warning!',
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
        // an open modal sets pointer-events:none on <body> (Radix): the toasts inherited it, so a click
        // on "โหลดใหม่" went through to the dark overlay — the toaster takes clicks of its own
        className="no-print pointer-events-auto"
        icons={{
          success: <CheckCircle2 className="h-4 w-4" />,
          error: <XCircle className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <AlertTriangle className="h-4 w-4" />,
        }}
        toastOptions={{
          classNames: {
            toast:
              'items-start! gap-2.5! rounded-lg! border! bg-card! p-3! shadow-pop! font-sans! w-[min(360px,calc(100vw-2rem))]!',
            title: 'text-sm! font-medium! text-card-foreground!',
            description: 'mt-0.5! text-xs! text-muted-foreground!',
            icon: 'mt-0.5! m-0!',
            closeButton:
              // 24×24 target (WCAG 2.5.8); -my-0.5 keeps a one-line toast its height
              'static! order-last! ml-auto! -my-0.5! grid! h-6! w-6! shrink-0! place-items-center! rounded! border-0! bg-transparent! p-0! text-muted-foreground! translate-x-0! translate-y-0! hover:bg-black/5! dark:hover:bg-white/10!',
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
