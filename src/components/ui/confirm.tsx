"use client";

import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Modal } from "./modal";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * App-wide confirmation dialog — a promise-based drop-in for `window.confirm`:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "ลบผู้ใช้?", description: "…", tone: "danger" }))) return;
 *
 * One instance is mounted by <ConfirmProvider> in the root layout, so every page
 * gets the same look (Radix Dialog: focus trap, Esc = cancel, Enter = confirm).
 */
export type ConfirmOptions = {
  title: string;
  /** what will happen + whether it can be undone — plain language */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red confirm button (delete / cancel a document); default = primary */
  tone?: "danger" | "default";
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const Ctx = React.createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const confirm = React.useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((cur) => {
          cur?.resolve(false); // a second request while one is open cancels the first
          return { ...o, resolve };
        });
      }),
    []
  );
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const danger = pending?.tone === "danger";

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? "ยกเลิก"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} size="sm" autoFocus onClick={() => settle(true)}>
              {pending?.confirmLabel ?? (danger ? "ยืนยันลบ" : "ยืนยัน")}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", danger ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary")}>
            {danger ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          </span>
          <div className="min-w-0 text-sm leading-relaxed text-foreground/90">{pending?.description ?? "ต้องการดำเนินการต่อหรือไม่?"}</div>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useConfirm() must be used inside <ConfirmProvider>");
  return c;
}
