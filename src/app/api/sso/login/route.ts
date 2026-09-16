import { NextResponse, type NextRequest } from "next/server";
import { SSO, STATE_COOKIE, STATE_SEP, MAX_STATES, DEFAULT_AFTER_LOGIN, appOrigin, isRouterFetch } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || DEFAULT_AFTER_LOGIN;

  // A soft navigation / prefetch landed here (session gone mid-session): send the
  // router to the app's own /login page instead of the SSO — the user clicks once
  // and the real flow runs as a top-level navigation with cookies intact.
  if (isRouterFetch(request)) {
    const to = new URL("/login", appOrigin(request));
    to.searchParams.set("next", next);
    return NextResponse.redirect(to);
  }

  // CSRF state = random nonce + where to return afterwards
  const state = `${crypto.randomUUID()}|${next}`;
  const redirectUri = `${appOrigin(request)}/api/sso/callback`;

  const authorize = new URL(SSO.authorizeUrl);
  authorize.searchParams.set("client_id", SSO.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  // "เข้าสู่ระบบด้วยบัญชีอื่น": ask Central SSO to re-authenticate (standard OIDC
  // hints; harmless if the SSO ignores them — it then behaves like a normal login)
  if (url.searchParams.get("prompt") === "login") {
    authorize.searchParams.set("prompt", "login");
    authorize.searchParams.set("max_age", "0");
  }

  // Several logins can start within seconds (link prefetch, a second tab, two
  // 401 handlers racing) — each used to overwrite the cookie and the earlier
  // flow then failed with state_mismatch. Keep the last few states instead.
  const prev = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const states = [state, ...prev.split(STATE_SEP).filter(Boolean)].slice(0, MAX_STATES);

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, states.join(STATE_SEP), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min to complete login
  });
  return res;
}
