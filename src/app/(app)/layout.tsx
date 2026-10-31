import { redirect } from 'next/navigation';
import { pack } from '@/lib/obscure';
import { headers, cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';
import { AppShell } from '@/components/layout/app-shell';
import { AccessProvider } from '@/lib/use-access';
import { userFromCookies, grantsForUserType } from '@/server/auth';
import { tourState } from '@/server/services/tour';
import { r2Ready } from '@/server/storage';

export const dynamic = 'force-dynamic';

/** reads user_type / is_active fresh from app_user on every navigation, so an approval takes effect at once; grants go to the client only to hide UI — the API re-checks every write */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await userFromCookies();
  if (!user) {
    // always our own /login page — never auto-forward to the external SSO
    // (see src/proxy.ts: Google Web Risk flags sites that do that)
    const h = await headers();
    const next = h.get('next-url') || '';
    const expired = !!(await cookies()).get(SESSION_COOKIE)?.value; // cookie present but no longer verifies
    const q = new URLSearchParams();
    if (expired) q.set('expired', '1');
    if (next) q.set('next', next);
    redirect(q.size ? `/login?${q}` : '/login');
  }
  if (!user.approved) redirect('/pending');

  // a failed grants read must not look like "no access" (→ /pending): let it reach app/error.tsx
  // (System Admin's too: Job Take is the one right an admin holds only when ticked — checkRight)
  // the tutorials' "asked already": a nicety — a failed read asks again rather than failing the page
  const [grants, tour] = await Promise.all([
    grantsForUserType(user.userType),
    tourState(user.pk).catch(() => ({ seen: [], off: false })),
  ]);

  return (
    <AccessProvider
      value={{
        userId: user.id,
        name: user.name,
        email: pack(user.email), // packed: no e-mail address in the HTML (src/lib/obscure.ts)
        role: user.role,
        isAdmin: user.isAdmin,
        grants,
        tour,
        videos: r2Ready(),
      }}
    >
      <AppShell>{children}</AppShell>
    </AccessProvider>
  );
}
