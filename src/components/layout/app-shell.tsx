'use client';

import * as React from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CommandPalette } from './command-palette';
import { AccessGuard } from './access-guard';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useAccess } from '@/lib/use-access';
import { useLocalStorage } from '@/lib/use-client';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes';
import { today } from '@/lib/dates';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []); // stable: the drawer's focus effect keys on it
  // collapsed sidebar is remembered per browser (and follows a change made in another tab)
  const [collapsedPref, setCollapsedPref] = useLocalStorage('shd-sidebar-collapsed', '0');
  const collapsed = collapsedPref === '1';
  const [palette, setPalette] = React.useState(false);
  useUnsavedChangesGuard(); // leaving a form with unsaved edits asks first
  // a page the user may not open is never rendered (AccessGuard redirects): no 403 API calls first
  const allowed = useAccess().canPath(usePathname());

  const toggleCollapse = () => setCollapsedPref(collapsed ? '0' : '1');

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <AccessGuard />
      <Sidebar
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div
        inert={mobileOpen} // the open mobile drawer is modal: Tab stays inside it
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200 ease-out',
          collapsed ? 'lg:pl-[72px]' : 'lg:pl-[268px]',
        )}
      >
        <Topbar
          onOpenMobile={() => setMobileOpen(true)}
          onOpenPalette={() => setPalette(true)}
          onToggleCollapse={toggleCollapse}
          collapsed={collapsed}
        />
        <main className="flex-1 p-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1600px] space-y-4">{allowed ? children : null}</div>
        </main>
        <footer className="border-t border-border px-4 py-3 text-2xs text-muted-foreground no-print">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
            <span>© {today().slice(0, 4)} SHD Technology Co., Ltd. — Service Management System</span>
            <span className="num">v1.0.0</span>
          </div>
        </footer>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
