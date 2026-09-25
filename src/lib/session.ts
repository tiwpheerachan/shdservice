// Signed session cookie helpers — HMAC-SHA256 via Web Crypto so they run in
// both the Edge middleware and Node route handlers. The cookie is httpOnly and
// tamper-proof: payload.signature, verified before it is trusted.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = "os_session";
// Idle timeout: the timer in the topbar renews the cookie on activity (≤ every
// 5 min), so an active user never hits this; 30 min without activity → /login.
export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Absolute lifetime from sign-in: renewing the idle timer never extends a session
// past this — a stolen cookie cannot be kept alive forever through /refresh.
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
// Long-lived marker that a session once existed on this browser — lets the
// middleware tell "session expired" (→ /login with a message) apart from a
// first visit (→ straight to SSO). Set by /api/sso/me + /refresh (JSON responses,
// never on the callback redirect — see the single-Set-Cookie note there).
export const SEEN_COOKIE = "os_seen";
export const SEEN_TTL_S = 30 * 24 * 60 * 60;

export type SessionUser = {
  email: string;
  name: string;
  avatar?: string;
  sid?: string; // central session id (for Single-Logout checks)
  role?: string; // OneService role (from the users table); baked in at login
  approved?: boolean; // may this user actually enter the app?
  exp: number; // epoch ms — idle expiry, renewed by /refresh
  iat: number; // epoch ms — sign-in time; never renewed (SESSION_MAX_AGE_MS)
  sv: number; // app_user.session_version at sign-in — logout bumps it (all devices)
};

function b64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + "=".repeat(pad));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Signing secret. Production: ONLY `SESSION_SECRET` (random, ≥ 32 chars, used for
// nothing else). It is deliberately NOT CENTRAL_API_KEY any more — that key is also
// sent to the central directory service, and anyone holding it could mint sessions.
// Missing in production = fail closed (nobody can sign in) rather than fall back.
// Keep it fixed in the Render dashboard (sync: false) — changing it signs everyone out.
//
// The dev fallback string is public (it is in this file): it only ever applies in
// local development when no secret is configured at all.
const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-change-me";
const MIN_SECRET_LENGTH = 32;
function candidateSecrets(): string[] {
  const own = (process.env.SESSION_SECRET ?? "").trim();
  if (own.length >= MIN_SECRET_LENGTH) return [own];
  if (process.env.NODE_ENV === "production") {
    throw new Error(`SESSION_SECRET is not configured (random, at least ${MIN_SECRET_LENGTH} characters)`);
  }
  const dev = [own, process.env.CENTRAL_API_KEY ?? ""].map((s) => s.trim()).filter(Boolean);
  return dev.length ? dev : [DEV_FALLBACK_SECRET];
}

function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(user: SessionUser): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(user)));
  const key = await importKey(candidateSecrets()[0]);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(payload))
  );
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  token?: string | null
): Promise<SessionUser | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    let ok = false;
    for (const secret of candidateSecrets()) {
      ok = await crypto.subtle.verify(
        "HMAC",
        await importKey(secret),
        unb64url(sig),
        enc.encode(payload)
      );
      if (ok) break;
    }
    if (!ok) return null;
    const user = JSON.parse(dec.decode(unb64url(payload))) as SessionUser;
    if (!user.exp || user.exp < Date.now()) return null;
    // absolute lifetime + version stamp are mandatory (older cookies lack them → sign in again)
    if (typeof user.iat !== "number" || Date.now() - user.iat > SESSION_MAX_AGE_MS) return null;
    if (typeof user.sv !== "number") return null;
    return user;
  } catch {
    return null;
  }
}
