import { redirect } from 'next/navigation';
import { userFromCookies, grantsForUserType } from '@/server/auth';
import { DASHBOARD, landingPath } from './landing';

/**
 * The landing page (after login, the logo, "/") — see landingPath.
 * Not signed in / not approved → the dashboard, whose (app) layout sends them to /login or /pending.
 */
export default async function Home() {
  const user = await userFromCookies();
  if (!user?.approved) redirect(DASHBOARD);
  redirect(landingPath(user, user.isAdmin ? {} : await grantsForUserType(user.userType)));
}
