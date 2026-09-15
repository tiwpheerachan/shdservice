import { redirect } from "next/navigation";
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
  if (!user) redirect("/api/sso/login");
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
