import { NextResponse, type NextRequest } from "next/server";
import { SSO, STATE_COOKIE, DEFAULT_AFTER_LOGIN, appOrigin } from "@/lib/sso";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

function fail(request: NextRequest, reason: string) {
  const to = new URL("/login", appOrigin(request));
  to.searchParams.set("error", reason);
  return NextResponse.redirect(to);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;

  if (!code) return fail(request, "missing_code");
  if (!state || !cookieState || state !== cookieState)
    return fail(request, "state_mismatch");

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
    if (!res.ok) return fail(request, `verify_${res.status}`);
    identity = await res.json();
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
  if (!email) return fail(request, "no_email");

  const user: SessionUser = {
    email,
    name: str(u.name) || str(u.en_name) || email.split("@")[0],
    avatar: str(u.avatar_url) || str(u.avatar),
    sid: str(identity.sid) || str(identity.session_id) || str(u.union_id),
    exp: Date.now() + SESSION_TTL_MS,
  };

  const next = state.split("|")[1] || DEFAULT_AFTER_LOGIN;
  const res = NextResponse.redirect(new URL(next, appOrigin(request)));
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
