'use client';

import * as React from 'react';

/**
 * The clock both tracking entry points share (link countdown, OTP session): it runs out exactly
 * at `expiresAt`; while the customer is actually using the page (input in the last minute) and
 * < 5.5 min are left, `keepalive` asks the server for more time (server cap: 60 min).
 * No per-second state here — the visible countdown is <Countdown>, so only it re-renders.
 */
const ACTIVE_WINDOW_MS = 60_000;
const KEEPALIVE_WHEN_LEFT_MS = 5.5 * 60_000;

/** returns `markActive` — call it on actions that count as use (sign-in, opening a document) */
export function useSessionClock(expiresAt: number, onExpired: () => void, keepalive: () => void) {
  const lastInput = React.useRef(0); // stamped on mount below (no Date.now() during render)
  const lastKeepalive = React.useRef(0);
  const expire = React.useEffectEvent(onExpired);
  const extend = React.useEffectEvent(keepalive);

  React.useEffect(() => {
    lastInput.current = Date.now();
    const mark = () => (lastInput.current = Date.now());
    const evts = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => evts.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  // one expiry timer, re-armed whenever a keepalive moves expiresAt
  React.useEffect(() => {
    if (!expiresAt) return;
    const t = setTimeout(() => expire(), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [expiresAt]);

  // in use and running low → keepalive (at most every 30 s)
  React.useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      const now = Date.now();
      if (now >= expiresAt) return;
      const inUse = now - lastInput.current < ACTIVE_WINDOW_MS;
      if (inUse && expiresAt - now < KEEPALIVE_WHEN_LEFT_MS && now - lastKeepalive.current > 30_000) {
        lastKeepalive.current = now;
        extend();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  return React.useCallback(() => {
    lastInput.current = Date.now();
  }, []);
}

/** Date.now(), re-read every second — for the small components that show a countdown */
export function useNow() {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)} ชม. ${Math.floor((s % 3600) / 60)} นาที`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** time left until `to`, ticking on its own */
export function Countdown({ to }: { to: number }) {
  const now = useNow();
  return <span className="num font-medium text-foreground">{mmss(to - now)}</span>;
}
