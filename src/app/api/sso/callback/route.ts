import { NextResponse, type NextRequest } from "next/server";
import { SSO, STATE_COOKIE, DEFAULT_AFTER_LOGIN, appOrigin } from "@/lib/sso";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
} from "@/lib/session";
import { lookupByEmail } from "@/lib/directory";
import {
  supabaseAdmin,
  findUserIdByEmail,
  upsertUserRow,
} from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

const PENDING_ROLE = "รออนุมัติ";

function nowStamp() {
  // "YYYY-MM-DD HH:mm" — matches the lastLogin format used elsewhere
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Auto-provision the signed-in employee into the `users` table. New users get the
 * PENDING_ROLE (no access until an admin assigns a real role); existing users keep
 * their role/status and only get profile fields + lastLogin refreshed. Best-effort:
 * never blocks login if the DB or secret key is unavailable.
 */
async function provision(opts: {
  email: string;
  name: string;
  larkId: string;
  department: string;
  phone: string;
  avatar: string;
  title: string;
}) {
  try {
    const existingId = await findUserIdByEmail(opts.email);
    // preserve an existing user's role/status; only new users start as PENDING
    let role = PENDING_ROLE;
    let status = "Active";
    if (existingId) {
      const { data } = await supabaseAdmin()
        .from("users")
        .select("role, status")
        .eq("id", existingId)
        .maybeSingle();
      role = (data?.role as string) ?? PENDING_ROLE;
      status = (data?.status as string) ?? "Active";
    }
    const id = existingId ?? `U-${crypto.randomUUID().slice(0, 8)}`;
    await upsertUserRow({
      id,
      code: opts.larkId,
      name: opts.name,
      username: opts.email.split("@")[0],
      role,
      branch: opts.department,
      email: opts.email,
      phone: opts.phone,
      status,
      lastLogin: nowStamp(),
      avatar: opts.avatar,
      title: opts.title,
    });
  } catch {
    // ignore — provisioning is best-effort
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

  // Enrich with the full directory profile (department, title, phone, avatar).
  const prof = await lookupByEmail(email);

  const name =
    str(u.name) || str(u.en_name) || prof?.name || email.split("@")[0];
  const avatar = str(u.avatar_url) || str(u.avatar) || prof?.avatar || "";

  // Auto-provision into the users table (best-effort; won't block login).
  await provision({
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
