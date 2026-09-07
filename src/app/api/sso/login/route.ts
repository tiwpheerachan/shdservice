import { NextResponse } from "next/server";
import { SSO, STATE_COOKIE, DEFAULT_AFTER_LOGIN } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || DEFAULT_AFTER_LOGIN;

  // CSRF state = random nonce + where to return afterwards
  const state = `${crypto.randomUUID()}|${next}`;
  const redirectUri = `${url.origin}/api/sso/callback`;

  const authorize = new URL(SSO.authorizeUrl);
  authorize.searchParams.set("client_id", SSO.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);

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
