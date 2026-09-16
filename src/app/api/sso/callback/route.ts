import { NextResponse, type NextRequest } from "next/server";
import { SSO, STATE_COOKIE, STATE_SEP, DEFAULT_AFTER_LOGIN, appOrigin } from "@/lib/sso";
import {
  signSession,
  verifySession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/session";
import { lookupByEmail } from "@/lib/directory";
import { provisionSsoUser } from "@/server/services/users";
import { PENDING_ROLE, ADMIN_ROLE, isOwner, isApproved } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Auto-provision the signed-in employee into `app_user` (the single user table)
 * and return their effective role/status. New users start pending (user_type
 * NULL) until an admin assigns a role; owner emails are always System Admin.
 * Best-effort: never blocks login if the DB is unavailable.
 */
async function provision(opts: {
  email: string;
  name: string;
  larkId: string;
  department: string;
  phone: string;
  avatar: string;
  title: string;
}): Promise<{ role: string; status: string }> {
  try {
    const r = await provisionSsoUser(opts);
    return { role: r.userType ?? PENDING_ROLE, status: r.isActive ? "Active" : "Inactive" };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[sso] provision failed:", e instanceof Error ? e.message : e);
    return isOwner(opts.email)
      ? { role: ADMIN_ROLE, status: "Active" }
      : { role: PENDING_ROLE, status: "Active" };
  }
}

function fail(request: NextRequest, reason: string) {
  const to = new URL("/login", appOrigin(request));
  to.searchParams.set("error", reason);
  return NextResponse.redirect(to);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStates = (request.cookies.get(STATE_COOKIE)?.value ?? "").split(STATE_SEP).filter(Boolean);
  const nextFromState = state?.split("|")[1] || DEFAULT_AFTER_LOGIN;

  // Reloading the callback URL (or a second tab finishing after the first) must
  // not throw the user out: if this browser already holds a valid session, go on.
  const existing = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const continueIfSignedIn = () =>
    existing ? NextResponse.redirect(new URL(nextFromState, appOrigin(request))) : null;

  if (!code) return continueIfSignedIn() ?? fail(request, "missing_code");
  if (!state || !cookieStates.includes(state))
    return continueIfSignedIn() ?? fail(request, "state_mismatch");

  const clientSecret = process.env.SSO_CLIENT_SECRET;
  if (!clientSecret) return fail(request, "server_not_configured");

  let identity: Record<string, unknown>;
  try {
    // verify authenticates the app with client_id + client_secret (in the body)
    const res = await fetch(SSO.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: SSO.clientId,
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      // surface the SSO's reason in the server log (Render → Logs) without leaking secrets
      const body = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error(`[sso] verify failed ${res.status} for client ${SSO.clientId}: ${body.slice(0, 300)}`);
      // a code that was already exchanged (page reload) while a session exists → just continue
      return continueIfSignedIn() ?? fail(request, `verify_${res.status}`);
    }
    identity = await res.json();
    if (process.env.SSO_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[sso] identity keys:", Object.keys(identity));
    }
  } catch {
    return fail(request, "verify_unreachable");
  }

  // central may nest the user under `user` / `profile` / `data`
  const u =
    (identity.user as Record<string, unknown>) ??
    (identity.profile as Record<string, unknown>) ??
    (identity.data as Record<string, unknown>) ??
    identity;

  const email = str(u.email);
  if (!email) {
    // eslint-disable-next-line no-console
    console.error("[sso] no email in verify response; top-level keys:", Object.keys(identity), "user keys:", Object.keys(u ?? {}));
    return fail(request, "no_email");
  }

  // Enrich with the full directory profile (department, title, phone, avatar).
  const prof = await lookupByEmail(email);

  const name =
    str(u.name) || str(u.en_name) || prof?.name || email.split("@")[0];
  const avatar = str(u.avatar_url) || str(u.avatar) || prof?.avatar || "";

  // Auto-provision into the users table and get the effective role/status.
  const { role, status } = await provision({
    email,
    name,
    larkId: prof?.id ?? "",
    department: prof?.department ?? "",
    phone: prof?.phone ?? "",
    avatar,
    title: prof?.title ?? "",
  });

  const user: SessionUser = {
    email,
    name,
    avatar,
    sid: str(identity.sid) || str(identity.session_id) || str(u.union_id),
    role,
    approved: isApproved(role, status),
    exp: Date.now() + SESSION_TTL_MS,
  };

  const res = NextResponse.redirect(new URL(nextFromState, appOrigin(request)));
  // set ONLY the session cookie here — a single Set-Cookie on the redirect,
  // so proxies (Render) can't drop it while folding multiple Set-Cookie headers.
  // os_state has Max-Age=600 and expires on its own.
  res.cookies.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
