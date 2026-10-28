'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { AccessGuard } from './access-guard';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useAccess } from '@/lib/use-access';
import { useLocalStorage } from '@/lib/use-client';
import { useUnsavedChangesGuard } from '@/lib/use-unsaved-changes';
import { today } from '@/lib/dates';
import { TourProvider } from '@/components/tour/tour';

// cmdk + a Radix dialog (~16 KB gz) that only Ctrl+K / the search button opens: its own chunk, loaded
// on first open (that first press still opens it, once the chunk arrives)
const CommandPalette = dynamic(() => import('./command-palette').then((m) => m.CommandPalette));

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []); // stable: the drawer's focus effect keys on it
  // collapsed sidebar is remembered per browser (and follows a change made in another tab)
  const [collapsedPref, setCollapsedPref] = useLocalStorage('shd-sidebar-collapsed', '0');
  const collapsed = collapsedPref === '1';
  const [palette, setPalette] = React.useState(false);
  // mounted from the first open on (and kept: closing runs Radix's focus return)
  const [paletteUsed, setPaletteUsed] = React.useState(false);
  if (palette && !paletteUsed) setPaletteUsed(true);
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
    <TourProvider>
      <div className="min-h-screen">
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-100 no-print"
        >
          ข้ามไปยังเนื้อหาหลัก
        </a>
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
            // the sidebar is not printed: neither is the room kept for it (a printed page used ~70% of the sheet)
            collapsed ? 'lg:pl-[72px] print:lg:pl-0' : 'lg:pl-[268px] print:lg:pl-0',
          )}
        >
          <Topbar
            onOpenMobile={() => setMobileOpen(true)}
            onOpenPalette={() => setPalette(true)}
            onToggleCollapse={toggleCollapse}
            collapsed={collapsed}
          />
          <main id="main" tabIndex={-1} className="flex-1 p-3 outline-hidden sm:p-4 lg:p-6">
            <div className="mx-auto w-full max-w-[1600px] space-y-4">{allowed ? children : null}</div>
          </main>
          <footer className="border-t border-border px-4 py-3 text-2xs text-muted-foreground no-print">
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
              <span>© {today().slice(0, 4)} SHD Technology Co., Ltd. — Service Management System</span>
              <span className="num">v1.0.0</span>
            </div>
          </footer>
        </div>
        {paletteUsed && <CommandPalette open={palette} onOpenChange={setPalette} />}
      </div>
    </TourProvider>
  );
}
