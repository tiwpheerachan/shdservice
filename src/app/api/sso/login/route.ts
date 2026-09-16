import { NextResponse } from "next/server";
import { SSO, STATE_COOKIE, DEFAULT_AFTER_LOGIN, appOrigin } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || DEFAULT_AFTER_LOGIN;

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

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min to complete login
  });
  return res;
}
