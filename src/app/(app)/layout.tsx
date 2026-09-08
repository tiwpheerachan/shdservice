import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isOwner, isApproved } from "@/lib/access";

// Always evaluate the access gate at request time (never statically cached).
export const dynamic = "force-dynamic";

/**
 * Authorization gate for the whole app. Runs on every navigation and reads the
 * user's CURRENT role/status straight from the DB, so an admin's approval takes
 * effect immediately — no stale cookie, no polling. Falls back to the login-time
 * cookie flag only if the DB is momentarily unreachable, so an already-approved
 * user is never locked out by a transient error.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/api/sso/login");

  let approved: boolean;
  if (isOwner(session.email)) {
    approved = true;
  } else {
    try {
      const { data } = await supabaseAdmin()
        .from("users")
        .select("role, status")
        .ilike("email", session.email);
      const rows = (data as { role: string; status: string }[] | null) ?? [];
      approved =
        rows.length === 0
          ? !!session.approved // no row yet (race after first login) → trust login flag
          : rows.some((r) => isApproved(r.role, r.status));
    } catch {
      approved = !!session.approved; // DB unreachable → don't lock out approved users
    }
  }

  if (!approved) redirect("/pending");

  return <AppShell>{children}</AppShell>;
}
