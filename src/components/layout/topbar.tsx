'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, LogOut, ChevronRight, PanelLeft, CircleHelp } from 'lucide-react';
import { findBreadcrumb } from '@/lib/nav';
import { ThemeToggle } from './theme-toggle';
import { SessionTimer } from './session-timer';
import { NotificationBell } from './notification-bell';
import { cn } from '@/lib/utils';
import { useMe } from '@/lib/use-me';
import { startSignOut } from '@/lib/navigation';
import { useTour } from '@/components/tour/tour';
import { Email } from '@/components/shared/email';

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
  const tour = useTour();
  const crumb = findBreadcrumb(pathname);

  // the tab title names the page (WCAG 2.4.2) — the (app) pages are client pages without metadata of
  // their own, so the root's "OneService" would stay. Re-applied if Next writes its <title> after us.
  const pageTitle = crumb?.item?.title ?? crumb?.group.title;
  React.useEffect(() => {
    const want = pageTitle ? `${pageTitle} · OneService` : 'OneService';
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [pageTitle]);

  const { user: me } = useMe();
  const [avatarError, setAvatarError] = React.useState(false);

  const initials = me?.name
    ? me.name
        .replace(/^(คุณ|นาย|นาง|นางสาว)\s*/u, '')
        .slice(0, 2)
        .toUpperCase()
    : '··';

  return (
    <header className="sticky top-0 z-30 flex h-(--topbar-h) shrink-0 items-center gap-1.5 border-b border-border bg-background/85 px-3 backdrop-blur-md sm:gap-2 sm:px-4 no-print">
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
        aria-label={collapsed ? 'ขยายเมนู' : 'พับเมนู'}
        aria-pressed={collapsed}
        title={collapsed ? 'ขยายเมนู' : 'พับเมนู'}
      >
        <PanelLeft className={cn('h-[18px] w-[18px] transition-transform', collapsed && 'rotate-180')} />
      </button>

      {/* xl: from 768 to 1279 the topbar has no room — it cut the trail to "4. ข้อ…" */}
      <nav aria-label="breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm xl:flex">
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

      {/* icon only below xl (the label stays for screen readers); the shortcut only where there is a keyboard */}
      <button
        onClick={onOpenPalette}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="sr-only xl:not-sr-only xl:pr-6">ค้นหาเมนู…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-px text-2xs xl:pointer-fine:inline">
          Ctrl K
        </kbd>
      </button>

      <SessionTimer />

      {/* a page with a บทสอน starts it; the others open the full guide */}
      {tour.has ? (
        <button
          type="button"
          onClick={tour.start}
          title="สอนการใช้งานหน้านี้"
          aria-label="สอนการใช้งานหน้านี้"
          className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      ) : (
        <Link
          href="/admin/guide"
          title="คู่มือการใช้งาน"
          aria-label="คู่มือการใช้งาน"
          className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </Link>
      )}

      <NotificationBell />

      <ThemeToggle />

      <div className="ml-1 flex items-center gap-2 border-l border-border pl-2 sm:pl-3">
        {me?.avatar && !avatarError ? (
          <img
            src={me.avatar}
            alt={me.name}
            onError={() => setAvatarError(true)}
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials}
          </div>
        )}
        {/* one line each, cut with … — a long email wrapped the topbar at 1280px; xl: no room beside the sidebar at 1024 */}
        <div className="hidden min-w-0 max-w-48 leading-tight xl:block" title={me?.email}>
          <p className="truncate text-xs font-medium">{me?.name ?? 'กำลังโหลด…'}</p>
          <p className="truncate text-2xs text-muted-foreground">
            <Email value={me?.email} />
          </p>
        </div>
        {/* plain <a>, NOT <Link>: Next prefetches visible Links, and prefetching
            /api/sso/logout silently signed the user out after every page load. onClick: the /me poll's
            401 meanwhile is this sign-out, not an expiry (lib/navigation) */}
        <a
          href="/api/sso/logout"
          onClick={startSignOut}
          title="ออกจากระบบ"
          className={cn(
            'rounded-md p-2 text-muted-foreground transition-colors',
            'hover:bg-danger-soft hover:text-danger',
          )}
        >
          <LogOut className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}
