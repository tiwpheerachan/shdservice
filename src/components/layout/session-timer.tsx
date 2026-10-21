'use client';

import * as React from 'react';
import { Timer, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/use-me';
import { toLogin } from '@/lib/navigation';

const WARN_SECONDS = 5 * 60;
const AUTO_REFRESH_EVERY_MS = 5 * 60 * 1000; // activity-based renewal, at most every 5 min (TTL is 30 min)

/**
 * Idle-timeout countdown (30 min): reads the cookie's expiry from /api/sso/me (useMe — shared with
 * the topbar and AccessGuard, re-read every minute, so it shows the server's real expiry). The ONLY
 * thing that extends the session is this component: /api/sso/refresh on the button, and
 * automatically on user activity (typing included) at most every 5 minutes — never past 12 h from sign-in.
 * No activity for 30 min → the session ends on the server; AccessGuard then sends the user to /login, or
 * keeps a page with typed data and asks to sign in again in a new tab.
 * The last 5 minutes also open an alert dialog on every screen size (the chip is sm+ and only colour):
 * it takes focus, so a screen-reader user hears it before being signed out (WCAG 2.2.1).
 */
export function SessionTimer() {
  const { exp, refresh: reloadMe } = useMe();
  const [now, setNow] = React.useState(() => Date.now());
  const lastRefresh = React.useRef(0);
  const [renewedAt, setRenewedAt] = React.useState(0);

  const refresh = React.useCallback(async () => {
    lastRefresh.current = Date.now();
    try {
      const r = await fetch('/api/sso/refresh', { cache: 'no-store' });
      if (r.status === 401) {
        toLogin({ reason: ((await r.json().catch(() => null)) as { reason?: string } | null)?.reason });
        return;
      }
      await reloadMe();
      setRenewedAt(Date.now());
    } catch {
      /* ignore */
    }
  }, [reloadMe]);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // renew on activity, throttled
  React.useEffect(() => {
    const onActivity = () => {
      if (Date.now() - lastRefresh.current > AUTO_REFRESH_EVERY_MS) void refresh();
    };
    // only what a person does: typing (input covers dictation / autofill / paste), clicks, wheel, touch. Not
    // `scroll` — the page scrolls by itself (a list re-rendering, scroll anchoring) and would keep a tab nobody
    // touches signed in. A hidden tab gets none of these, so it is never renewed. /refresh caps at 12 h anyway.
    const events = ['click', 'keydown', 'input', 'wheel', 'pointerdown', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [refresh]);

  const left = exp ? Math.max(0, Math.floor((exp - now) / 1000)) : null;

  // run out by this tab's clock → ask the server: another tab may have renewed it (this tab's copy is stale while
  // hidden — the /me poll pauses); really gone → AccessGuard sends it to /login, or keeps a form with typed data
  React.useEffect(() => {
    if (left === 0) void reloadMe();
  }, [left, reloadMe]);

  const p = (n: number) => String(n).padStart(2, '0');
  const label =
    left === null
      ? '--:--'
      : left >= 3600
        ? `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`
        : `${p(Math.floor(left / 60))}:${p(left % 60)}`;
  const warn = left !== null && left > 0 && left <= WARN_SECONDS;
  // still about to run out right after a renewal = the 12 h limit from sign-in (/refresh never goes past it)
  const capped = warn && now - renewedAt < 60_000;
  // closed without renewing (the renewal failed): not again until the session is renewed
  const [dismissed, setDismissed] = React.useState(false);
  if (!warn && dismissed) setDismissed(false);

  return (
    <>
      <Modal
        open={warn && !dismissed}
        onClose={() => setDismissed(true)}
        alert
        size="sm"
        title="เซสชันใกล้หมดอายุ"
        description={
          capped
            ? `เข้าสู่ระบบมาครบ 12 ชั่วโมงแล้ว — เซสชันจะหมดในอีก ${label} นาที`
            : `ไม่มีการใช้งานนานเกินไป — ระบบจะออกจากระบบในอีก ${label} นาที`
        }
        footer={
          capped ? (
            <Button size="sm" data-autofocus onClick={() => setDismissed(true)}>
              รับทราบ
            </Button>
          ) : (
            <Button size="sm" data-autofocus onClick={() => void refresh()}>
              <RotateCw className="h-3.5 w-3.5" />
              ต่ออายุเซสชัน
            </Button>
          )
        }
      >
        <p className="text-sm text-foreground/90">
          {capped
            ? 'ต่ออายุไม่ได้ — กดบันทึกงานที่ค้างไว้ก่อน ถ้าหมดเวลาก่อน ข้อมูลที่กรอกยังอยู่ ให้เข้าสู่ระบบใหม่ในแท็บใหม่แล้วกดบันทึกอีกครั้ง'
            : 'กด “ต่ออายุเซสชัน” เพื่อทำงานต่อ — ถ้าหมดเวลา ข้อมูลที่กรอกยังอยู่ในหน้านี้ เข้าสู่ระบบใหม่แล้วกดบันทึกอีกครั้งได้'}
        </p>
      </Modal>
      <div
        className={cn(
          'hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs sm:flex',
          warn ? 'border-warning/30 bg-warning-soft text-warning' : 'border-border bg-muted/60 text-muted-foreground',
        )}
        title="เซสชันหมดอายุเมื่อไม่มีการใช้งาน 30 นาที — ใช้งานอยู่จะต่ออายุให้อัตโนมัติ หรือกดปุ่มเพื่อต่ออายุ"
      >
        <Timer className="h-3.5 w-3.5" />
        <span className="num font-medium tracking-tight">{label}</span>
        {/* 24×24 target (WCAG 2.5.8) without growing the chip: -my-1 */}
        <button
          onClick={() => void refresh()}
          className="-my-1 ml-0.5 grid h-6 w-6 place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="ต่ออายุเซสชัน"
        >
          <RotateCw className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}
