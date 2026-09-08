// Signed session cookie helpers — HMAC-SHA256 via Web Crypto so they run in
// both the Edge middleware and Node route handlers. The cookie is httpOnly and
// tamper-proof: payload.signature, verified before it is trusted.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = "os_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export type SessionUser = {
  email: string;
  name: string;
  avatar?: string;
  sid?: string; // central session id (for Single-Logout checks)
  role?: string; // OneService role (from the users table); baked in at login
  approved?: boolean; // may this user actually enter the app?
  exp: number; // epoch ms
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

// Candidate signing secrets, in priority order. CENTRAL_API_KEY is preferred
// because it is STABLE across deploys — unlike a Render `generateValue` secret,
// which can rotate on redeploy and silently invalidate every existing session
// (the cause of sessions dying after a deploy). We SIGN with the first candidate
// and VERIFY against all of them, so cookies signed with any of these keep
// working — no forced re-login when the priority changes.
function candidateSecrets(): string[] {
  const list = [
    process.env.CENTRAL_API_KEY,
    process.env.SESSION_SECRET,
    "dev-only-insecure-secret-change-me",
  ].filter((s): s is string => !!s);
  return list.length ? list : ["dev-only-insecure-secret-change-me"];
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
    return user;
  } catch {
    return null;
  }
}
