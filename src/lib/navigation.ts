import { allowUnload, hasUnsavedChanges } from '@/lib/use-unsaved-changes';

/**
 * Full page loads — for the few moments the app must start clean instead of routing client-side
 * (in-app links use <Link> / router.push):
 *  - the session is gone → /login (drops every cached list / form of the old session)
 *  - a new role or approval → reload so the server hands out the new permissions
 *
 * Never send a signed-out visitor straight to /api/sso/login: an app URL that auto-forwards to a
 * Google sign-in is what phishing kits do (Google Web Risk flagged the site for it).
 * The /login page's button is the only way into SSO.
 */
export function hardNavigate(path: string) {
  if (typeof window === 'undefined') return;
  allowUnload(); // the app decided — an unsaved form can't be saved without the session anyway
  window.location.assign(new URL(path, window.location.origin).href);
}

/** AccessGuard shows the "session expired — your data is still here" dialog on this window event */
export const SESSION_EXPIRED_EVENT = 'shd:session-expired';

// ออกจากระบบ was clicked: the page is on its way to /api/sso/logout — the 401s that follow (the /me poll,
// the countdown) are that sign-out, not an expiry. Without this the poll wins the race and sends the PC to
// /login?expired=1&next=<this page>, and the NEXT person signing in lands on the previous user's page.
let signingOut = false;
export function startSignOut() {
  signingOut = true;
}

/** the session is gone but this page must stay (a save failed, or a form holds typed data): ask the
 *  user to sign in again in a NEW tab — the cookie is shared, so saving here works again after */
export function sessionExpired() {
  if (typeof window !== 'undefined' && !signingOut) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

// writes refused for an expired session (lib/api authedFetch), waiting for the dialog's answer
let signIn: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;
/** a write got its final 401: the dialog opens and the write waits — true = signed in again and บันทึกอีกครั้ง
 *  (the write is sent again), false = the dialog was closed (the save fails; pressing บันทึก later asks again) */
export function waitForSignIn(): Promise<boolean> {
  if (!signIn) {
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    signIn = { promise, resolve };
  }
  const { promise } = signIn;
  sessionExpired();
  return promise;
}
/** a save is waiting in the session-expired dialog */
export const waitingForSignIn = () => !!signIn;
/** the dialog's answer to every waiting write */
export function signedInAgain(ok: boolean) {
  signIn?.resolve(ok);
  signIn = null;
}

// the user's last press, and the in-app link it was on: the press itself renews the session (SessionTimer, on
// pointerdown), so its 401 comes back while the tab still shows the page the link is leaving
let pressed: { to: string | null; at: number } | null = null;
if (typeof window !== 'undefined')
  for (const ev of ['pointerdown', 'click', 'keydown'] as const)
    window.addEventListener(
      ev,
      (e) => {
        const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
        const u = a && a.target !== '_blank' ? new URL(a.href) : null;
        const inApp =
          u?.origin === window.location.origin && u.pathname !== '/login' && !u.pathname.startsWith('/api/');
        pressed = { to: inApp ? u.pathname + u.search : null, at: Date.now() };
      },
      true,
    );

/** session expired → our /login with the "expired" note. `next` (where the sign-in comes back to) = what the
 *  user was opening when the 401 hit: the link pressed in the last few seconds, or this page after any other
 *  press (a button, a search); without a press, this page after an idle expiry (filters included) — but none
 *  when signed out on another device: this tab's page is stale, the sign-in lands on the role's landing page.
 *  A form with unsaved edits, or a save waiting for the sign-in, is never thrown away for it: the dialog instead.
 *  `signedOut` (ออกจากระบบ in another tab — /api/sso/me says so): ALWAYS /login?bye=1, no `next`, no dialog —
 *  the user left on purpose, and the next person must not sign in into this tab's page / typed data.
 *  `reason` = the 401's `reason` from /api/sso/me or /refresh: 'elsewhere' (signed out on another device)
 *  gets its own note instead of "idle 30 min". */
export function toLogin(opts: { signedOut?: boolean; reason?: string } = {}) {
  if (typeof window === 'undefined' || signingOut) return;
  if (opts.signedOut) return hardNavigate('/login?bye=1');
  if (hasUnsavedChanges() || signIn) return sessionExpired(); // typed data / a save waiting: the page stays
  const here = window.location.pathname + window.location.search;
  const next =
    pressed && Date.now() - pressed.at < 5000 ? (pressed.to ?? here) : opts.reason === 'elsewhere' ? '' : here;
  const why = opts.reason === 'elsewhere' ? 'reason=elsewhere' : 'expired=1';
  hardNavigate(`/login?${why}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
}
