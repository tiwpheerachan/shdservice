"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Check, X, PanelLeftClose } from "lucide-react";
import { NAV, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";

type Flyout = { id: string; top: number; left: number };

export function Sidebar({
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();
  const activeGroup = NAV.find((g) =>
    g.items.some((i) => i.href === pathname)
  )?.id;

  const [open, setOpen] = React.useState<string[]>(
    activeGroup ? [activeGroup] : ["jobs"]
  );

  React.useEffect(() => {
    if (activeGroup) setOpen((s) => (s.includes(activeGroup) ? s : [...s, activeGroup]));
  }, [activeGroup]);

  const toggle = (id: string) =>
    setOpen((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /* ---------- collapsed hover flyout ---------- */
  const [flyout, setFlyout] = React.useState<Flyout | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyout(null), 140);
  };

  const openFlyout = (e: React.MouseEvent | React.FocusEvent, g: NavGroup) => {
    cancelClose();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // estimate panel height so it never runs off the bottom of the viewport
    const estimated = 46 + g.items.length * 34 + 12;
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - estimated - 12));
    setFlyout({ id: g.id, top, left: rect.right + 10 });
  };

  React.useEffect(() => {
    if (!collapsed) setFlyout(null);
  }, [collapsed]);

  React.useEffect(() => () => cancelClose(), []);

  const flyoutGroup = flyout ? NAV.find((g) => g.id === flyout.id) : null;
  const FlyoutIcon = flyoutGroup?.icon;

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden no-print"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border shadow-sm transition-[width,transform] duration-200 ease-out no-print",
          collapsed ? "lg:w-[72px]" : "lg:w-[268px]",
          "w-[268px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* brand */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border",
            collapsed ? "justify-center px-0" : "px-3"
          )}
        >
          {collapsed ? (
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-sm ring-1 ring-inset ring-white/15"
              style={{ background: "linear-gradient(135deg,#43a6f8,#55d5a1)" }}
            >
              <Check className="h-5 w-5" strokeWidth={3} />
            </div>
          ) : (
            <Link
              href="/jobs/dashboard"
              onClick={onCloseMobile}
              aria-label="OneService — หน้าแรก"
              className="flex min-w-0 flex-1 items-center rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-black/5 transition-shadow hover:shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="OneService"
                className="h-6 w-auto max-w-full object-contain"
              />
            </Link>
          )}
          <button
            onClick={onCloseMobile}
            className="rounded-md p-1 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
            aria-label="ปิดเมนู"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
          {NAV.map((g) => {
            const isOpen = open.includes(g.id) && !collapsed;
            const groupActive = g.items.some((i) => i.href === pathname);
            const Icon = g.icon;
            return (
              <div key={g.id}>
                {collapsed ? (
                  <button
                    type="button"
                    aria-label={`${g.title} — คลิกเพื่อกางเมนู`}
                    onMouseEnter={(e) => openFlyout(e, g)}
                    onMouseLeave={scheduleClose}
                    onFocus={(e) => openFlyout(e, g)}
                    onBlur={scheduleClose}
                    onClick={() => {
                      setFlyout(null);
                      setOpen((s) => (s.includes(g.id) ? s : [...s, g.id]));
                      onToggleCollapse();
                    }}
                    className={cn(
                      "flex h-11 w-full items-center justify-center rounded-xl transition-colors",
                      groupActive || flyout?.id === g.id
                        ? "bg-primary/12 text-primary"
                        : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      groupActive && "bg-primary text-primary-foreground shadow-sm hover:bg-primary"
                    )}
                  >
                    <Icon className="h-[19px] w-[19px]" />
                  </button>
                ) : (
                  <button
                    onClick={() => toggle(g.id)}
                    aria-expanded={isOpen}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-colors",
                      groupActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
                        groupActive
                          ? "bg-primary/15 text-primary"
                          : "text-sidebar-muted group-hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <span className="flex-1 truncate text-left">{g.title}</span>
                    <span
                      className={cn(
                        "num rounded-full px-1.5 py-px text-2xs tabular-nums",
                        groupActive
                          ? "bg-primary/15 text-primary"
                          : "text-sidebar-muted"
                      )}
                    >
                      {g.no}
                    </span>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-sidebar-muted transition-transform duration-200",
                        isOpen && "rotate-90"
                      )}
                    />
                  </button>
                )}

                {!collapsed && (
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                  >
                    <div className="overflow-hidden">
                      <ul className="ml-[26px] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                        {g.items.map((i) => {
                          const active = pathname === i.href;
                          return (
                            <li key={i.href}>
                              <Link
                                href={i.href}
                                onClick={onCloseMobile}
                                className={cn(
                                  "relative block truncate rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                                  active
                                    ? "bg-primary/10 font-medium text-primary"
                                    : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                )}
                              >
                                {active && (
                                  <span className="absolute -left-[13px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                                )}
                                {i.title}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2.5">
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex",
              collapsed && "justify-center"
            )}
          >
            <PanelLeftClose
              className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
            />
            {!collapsed && <span>ย่อเมนู</span>}
          </button>
        </div>
      </aside>

      {/* collapsed hover flyout — escapes the sidebar via fixed positioning */}
      {collapsed && flyout && flyoutGroup && (
        <div
          role="menu"
          aria-label={flyoutGroup.title}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ top: flyout.top, left: flyout.left }}
          className="fixed z-[60] hidden w-60 origin-left animate-scale-in rounded-xl border border-border bg-card p-1.5 shadow-pop lg:block no-print"
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/12 text-primary">
              {FlyoutIcon && <FlyoutIcon className="h-3.5 w-3.5" />}
            </span>
            <span className="truncate text-xs font-semibold text-foreground">
              {flyoutGroup.title}
            </span>
          </div>
          <div className="my-1 h-px bg-border" />
          <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto">
            {flyoutGroup.items.map((i) => {
              const active = pathname === i.href;
              return (
                <li key={i.href}>
                  <Link
                    role="menuitem"
                    href={i.href}
                    onClick={() => setFlyout(null)}
                    className={cn(
                      "block truncate rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {i.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
