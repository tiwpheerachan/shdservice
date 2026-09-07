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

async function hmacKey() {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.CENTRAL_API_KEY ||
    "dev-only-insecure-secret-change-me";
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
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload))
  );
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  token?: string | null
): Promise<SessionUser | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      unb64url(sig),
      enc.encode(payload)
    );
    if (!ok) return null;
    const user = JSON.parse(dec.decode(unb64url(payload))) as SessionUser;
    if (!user.exp || user.exp < Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}
