import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";
import { AccessProvider } from "@/lib/use-access";
import { userFromCookies, grantsForUserType } from "@/server/auth";

// Always evaluate the access gate at request time (never statically cached).
export const dynamic = "force-dynamic";

/**
 * Authorization gate for the whole app. Runs on every navigation and reads the
 * user's CURRENT user_type/is_active straight from app_user, so an admin's
 * approval takes effect immediately. The user's permission grants (app_config)
 * are handed to the client so the sidebar/buttons can hide what they may not do;
 * the API re-checks every write regardless.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await userFromCookies();
  if (!user) {
    // soft navigation / prefetch → our /login page; real navigation → SSO directly
    // always our own /login page — never auto-forward to the external SSO
    // (see middleware.ts: Google Web Risk flags sites that do that)
    const h = await headers();
    const next = h.get("next-url") || "";
    const expired = !!(await cookies()).get(SESSION_COOKIE)?.value; // cookie present but no longer verifies
    const q = new URLSearchParams();
    if (expired) q.set("expired", "1");
    if (next) q.set("next", next);
    redirect(q.size ? `/login?${q}` : "/login");
  }
  if (!user.approved) redirect("/pending");

  let grants = {};
  try {
    grants = user.isAdmin ? {} : await grantsForUserType(user.userType);
  } catch {
    grants = {};
  }

  return (
    <AccessProvider
      value={{
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
        grants,
      }}
    >
      <AppShell>{children}</AppShell>
    </AccessProvider>
  );
}
