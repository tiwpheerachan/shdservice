"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, LogOut, ChevronRight, Bell, PanelLeft } from "lucide-react";
import { findBreadcrumb } from "@/lib/nav";
import { ThemeToggle } from "./theme-toggle";
import { SessionTimer } from "./session-timer";
import { cn } from "@/lib/utils";

type Me = { name: string; email: string; avatar?: string };

export function Topbar({
  onOpenMobile,
  onOpenPalette,
  onToggleCollapse,
  collapsed,
}: {
  onOpenMobile: () => void;
  onOpenPalette: () => void;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const crumb = findBreadcrumb(pathname);

  const [me, setMe] = React.useState<Me | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/sso/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.user) setMe(d.user);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const initials = me?.name
    ? me.name.replace(/^(คุณ|นาย|นาง|นางสาว)\s*/u, "").slice(0, 2).toUpperCase()
    : "··";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md sm:px-4 no-print">
      <button
        onClick={onOpenMobile}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
        aria-label="เปิดเมนู"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      <button
        onClick={onToggleCollapse}
        className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
        aria-label={collapsed ? "ขยายเมนู" : "พับเมนู"}
        aria-pressed={collapsed}
        title={collapsed ? "ขยายเมนู" : "พับเมนู"}
      >
        <PanelLeft
          className={cn("h-[18px] w-[18px] transition-transform", collapsed && "rotate-180")}
        />
      </button>

      <nav
        aria-label="breadcrumb"
        className="hidden min-w-0 items-center gap-1.5 text-sm md:flex"
      >
        {crumb && (
          <>
            <span className="truncate text-muted-foreground">
              {crumb.group.no}. {crumb.group.title}
            </span>
            {crumb.item && (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <span className="truncate font-medium">{crumb.item.title}</span>
              </>
            )}
          </>
        )}
      </nav>

      <div className="flex-1" />

      <button
        onClick={onOpenPalette}
        className="hidden items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="pr-6">ค้นหาเมนู…</span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-px text-2xs">
          Ctrl K
        </kbd>
      </button>

      <SessionTimer />

      <button
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="การแจ้งเตือน"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-background" />
      </button>

      <ThemeToggle />

      <div className="ml-1 flex items-center gap-2 border-l border-border pl-2 sm:pl-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
          {initials}
        </div>
        <div className="hidden leading-tight lg:block">
          <p className="text-xs font-medium">{me?.name ?? "กำลังโหลด…"}</p>
          <p className="text-2xs text-muted-foreground">{me?.email ?? ""}</p>
        </div>
        <Link
          href="/api/sso/logout"
          title="ออกจากระบบ"
          className={cn(
            "rounded-md p-2 text-muted-foreground transition-colors",
            "hover:bg-danger-soft hover:text-danger"
          )}
        >
          <LogOut className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
