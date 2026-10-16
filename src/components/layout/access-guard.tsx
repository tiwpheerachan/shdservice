'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAccess } from '@/lib/use-access';
import { findBreadcrumb } from '@/lib/nav';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { hardNavigate, toLogin, SESSION_EXPIRED_EVENT } from '@/lib/navigation';
import { useMe } from '@/lib/use-me';
import { landingPath } from '@/app/landing';

/**
 * Client-side authorization watchdog. The server layout only re-checks approval
 * on a full page load, so during client-side (SPA) navigation a user whose access
 * was just revoked could keep clicking around. This re-checks the DB-backed
 * session + approval on every route change and every minute — WITHOUT renewing the
 * session; if the user is no longer approved they are sent to /pending, and if
 * their session died they are sent to /login.
 */
export function AccessGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { canPath, isAdmin, role, grants, email } = useAccess();
  const { push } = useToast();

  // Page-level permission (app_config `view`; a create page also needs `add`): a user who types a URL
  // they may not open is sent to their landing page — and told why, not silently. The landing page is
  // picked HERE from the same (client) grants: "/" picks it from the DB's grants, and after an admin
  // changed this role mid-session the two disagreed → "/" sent the user to a page this guard denied →
  // back to "/" forever. A target the client grants also deny (only the guide) → full reload, fresh grants.
  // (AppShell does not render that page, so it fires no API call first.) The API
  // enforces the same grants on every write regardless.
  React.useEffect(() => {
    if (canPath(pathname)) return;
    const page = findBreadcrumb(pathname);
    push({
      kind: 'warning',
      id: 'no-access', // one toast, also when the effect runs twice (dev Strict Mode)
      title: `ไม่มีสิทธิ์เข้าหน้า ${page?.item?.title ?? page?.group.title ?? pathname}`,
      desc: 'ขอสิทธิ์ได้จากผู้ดูแลระบบ',
    });
    const to = landingPath({ isAdmin, userType: role }, grants);
    if (canPath(to.replace(/\?.*/, ''))) router.replace(to);
    else hardNavigate('/');
  }, [pathname, canPath, router, push, isAdmin, role, grants]);

  // still signed in / still approved? — read from /api/sso/me, which never extends the session
  // (so 30 min without activity really ends it). Every minute while the tab is visible, and at once
  // on every page change.
  const me = useMe({ poll: 60_000 });
  const { refresh } = me;
  React.useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  React.useEffect(() => {
    if (me.unauthorized)
      toLogin({ signedOut: me.signedOut }); // expired / signed out on another device / ออกจากระบบ in another tab
    else if (me.approved === false)
      hardNavigate('/pending'); // approval revoked → reload into the pending page
    // someone else signed in in another tab (same cookie) → this page still shows the previous user's
    // data and grants: start clean as the new user
    else if (me.user && email && me.user.email.toLowerCase() !== email.toLowerCase()) hardNavigate('/');
  }, [me.unauthorized, me.signedOut, me.approved, me.user, email]);

  // a save refused for an expired session / a form with typed data when the session ran out
  // (lib/navigation sessionExpired): the page stays as it is — sign in again in another tab
  // (same cookie), come back, save again
  const [expired, setExpired] = React.useState(false);
  React.useEffect(() => {
    const on = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, []);
  const close = () => {
    setExpired(false);
    void refresh(); // signed in again meanwhile → the countdown / guard pick up the new session
  };

  return (
    <Modal
      open={expired}
      onClose={close}
      title="เซสชันหมดอายุ"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={close}>
            ปิด
          </Button>
          <Button asChild size="sm">
            <a href="/login" target="_blank" rel="noopener" onClick={close}>
              เข้าสู่ระบบใหม่ (แท็บใหม่)
            </a>
          </Button>
        </>
      }
    >
      <p className="text-sm">
        เซสชันหมดอายุ — ข้อมูลที่กรอกยังอยู่ กดเข้าสู่ระบบใหม่ (เปิดแท็บใหม่) แล้วกลับมากดบันทึกอีกครั้ง
      </p>
    </Modal>
  );
}
