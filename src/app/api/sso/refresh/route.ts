import { NextResponse, type NextRequest } from "next/server";
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isOwner, isApproved, ADMIN_ROLE, PENDING_ROLE } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-read the caller's role/status from the DB and re-issue the session cookie so
 * an admin's approval takes effect without the user logging out and back in.
 * Used by the /pending screen to poll for approval.
 */
export async function GET(request: NextRequest) {
  const current = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!current) return NextResponse.json({ user: null }, { status: 401 });

  let role = current.role ?? PENDING_ROLE;
  let approved = !!current.approved;

  if (isOwner(current.email)) {
    role = ADMIN_ROLE;
    approved = true;
  } else {
    try {
      // read ALL rows for this email (robust to duplicates); the user is approved
      // if ANY row has a real role + Active status.
      const { data } = await supabaseAdmin()
        .from("users")
        .select("role, status")
        .ilike("email", current.email);
      const rows =
        (data as { role: string; status: string }[] | null) ?? [];
      const approvedRow = rows.find((r) => isApproved(r.role, r.status));
      if (approvedRow) {
        role = approvedRow.role;
        approved = true;
      } else if (rows[0]) {
        role = rows[0].role ?? PENDING_ROLE;
        approved = false;
      }
      // if no row found, keep the current cookie values (don't downgrade on a race)
    } catch {
      // DB unavailable — keep current values
    }
  }

  const updated: SessionUser = {
    ...current,
    role,
    approved,
    exp: Date.now() + SESSION_TTL_MS,
  };

  const res = NextResponse.json({ approved, role, email: current.email });
  res.cookies.set(SESSION_COOKIE, await signSession(updated), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
