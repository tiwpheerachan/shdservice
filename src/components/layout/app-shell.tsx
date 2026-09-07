"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [palette, setPalette] = React.useState(false);

  React.useEffect(() => {
    const saved = localStorage.getItem("shd-sidebar-collapsed");
    if (saved === "1") setCollapsed(true);
  }, []);

  const toggleCollapse = () =>
    setCollapsed((c) => {
      localStorage.setItem("shd-sidebar-collapsed", c ? "0" : "1");
      return !c;
    });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[72px]" : "lg:pl-[268px]"
        )}
      >
        <Topbar
          onOpenMobile={() => setMobileOpen(true)}
          onOpenPalette={() => setPalette(true)}
          onToggleCollapse={toggleCollapse}
          collapsed={collapsed}
        />
        <main className="flex-1 p-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1600px] space-y-4">{children}</div>
        </main>
        <footer className="border-t border-border px-4 py-3 text-2xs text-muted-foreground no-print">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
            <span>© 2026 SHD Technology Co., Ltd. — Service Management System</span>
            <span className="num">v1.0.0</span>
          </div>
        </footer>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
