import { redirect } from 'next/navigation';
import { userFromCookies, grantsForUserType } from '@/server/auth';
import { canViewPath, checkGrant, moduleForPath, EVERYONE_PATHS, type Action } from '@/lib/modules';
import { ALL_LINKS } from '@/lib/nav';

const DASHBOARD = '/jobs/dashboard';

/**
 * The landing page (after login, the logo, "/"): the dashboard when the role may open it, else the
 * first menu page it may open (menu order), else the guide — never a "ไม่มีสิทธิ์เข้าหน้า …" toast.
 * Not signed in / not approved → the dashboard, whose (app) layout sends them to /login or /pending.
 */
export default async function Home() {
  const user = await userFromCookies();
  if (!user?.approved) redirect(DASHBOARD);
  const grants = user.isAdmin ? {} : await grantsForUserType(user.userType);
  const may = (href: string, need?: Action) =>
    canViewPath(user.isAdmin, grants, href) && (!need || checkGrant(user.isAdmin, grants, moduleForPath(href), need));
  if (may(DASHBOARD)) redirect(DASHBOARD);
  const first = ALL_LINKS.find((l) => !EVERYONE_PATHS.includes(l.href) && may(l.href, l.need));
  redirect(first?.href ?? '/admin/guide');
}
