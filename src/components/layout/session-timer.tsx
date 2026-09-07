"use client";

import * as React from "react";
import { Timer, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL = 30 * 60; // 30 นาที

export function SessionTimer() {
  const [left, setLeft] = React.useState(TOTAL);

  React.useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const reset = () => setLeft(TOTAL);
    const events = ["click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    return () => events.forEach((e) => window.removeEventListener(e, reset));
  }, []);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const warn = left <= 300;

  return (
    <div
      className={cn(
        "hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs sm:flex",
        warn
          ? "border-warning/30 bg-warning-soft text-warning"
          : "border-border bg-muted/60 text-muted-foreground"
      )}
      title="เซสชันจะหมดอายุอัตโนมัติ — ขยับเมาส์หรือกดปุ่มเพื่อต่ออายุ"
    >
      <Timer className="h-3.5 w-3.5" />
      <span className="num font-medium tracking-tight">
        {mm}:{ss}
      </span>
      <button
        onClick={() => setLeft(TOTAL)}
        className="ml-0.5 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="ต่ออายุเซสชัน"
      >
        <RotateCw className="h-3 w-3" />
      </button>
    </div>
  );
}
