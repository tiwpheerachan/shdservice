import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { trackByNumber, ensureToken } from "@/server/services/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public tracking lookup — the ONLY unauthenticated data endpoint.
 *  POST { no, phone4, turnstileToken? }  (the /track/<token> page reads the DB directly)
 *
 * Rules that matter more than the code:
 *  - one message for every failure, so this cannot be used to probe which
 *    job / quotation numbers exist
 *  - per-IP rate limit, plus a lockout per job number after repeated misses
 *    (last-4-digits is only 10,000 combinations)
 *  - Turnstile is verified once a caller has missed twice; when the key is not
 *    configured the check is skipped so the feature works without Cloudflare
 */
const FAIL_MSG = "ไม่พบข้อมูล กรุณาตรวจสอบเลขที่เอกสารและเบอร์โทรอีกครั้ง";

/** misses per (number) — resets after LOCK_MS */
const misses = new Map<string, { n: number; at: number }>();
const LOCK_AFTER = 5;
const CHALLENGE_AFTER = 2;
const LOCK_MS = 15 * 60_000;

function missState(key: string) {
  const m = misses.get(key);
  if (!m || Date.now() - m.at > LOCK_MS) return { n: 0, at: Date.now() };
  return m;
}
function addMiss(key: string) {
  const m = missState(key);
  misses.set(key, { n: m.n + 1, at: Date.now() });
  if (misses.size > 5_000) for (const [k, v] of misses) if (Date.now() - v.at > LOCK_MS) misses.delete(k);
}

async function turnstileOk(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured → feature still works
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const d = (await r.json()) as { success?: boolean };
    return !!d.success;
  } catch {
    return false; // Cloudflare unreachable → fail closed on the challenge only
  }
}

export async function POST(req: NextRequest) {
  const fail = (extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: false, error: FAIL_MSG, ...extra }, { status: 200, headers: { "Cache-Control": "no-store" } });

  try {
    await rateLimit(req, "track", 20);
  } catch {
    return NextResponse.json(
      { ok: false, error: "ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { no?: string; phone4?: string; turnstileToken?: string };
  const no = String(body.no ?? "").trim().toUpperCase();
  const phone4 = String(body.phone4 ?? "").replace(/\D/g, "");
  const key = no || "-";
  const state = missState(key);

  if (state.n >= LOCK_AFTER) {
    return NextResponse.json(
      { ok: false, error: "ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่ หรือติดต่อศูนย์บริการ", locked: true },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  const needChallenge = state.n >= CHALLENGE_AFTER && !!process.env.TURNSTILE_SECRET_KEY;
  if (needChallenge) {
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (!(await turnstileOk(body.turnstileToken, ip))) return fail({ challenge: true });
  }

  if (!no || phone4.length !== 4) {
    addMiss(key);
    return fail({ challenge: needChallenge || state.n + 1 >= CHALLENGE_AFTER });
  }

  const found = await trackByNumber(no, phone4); // never throws — returns null on any failure
  if (!found) {
    addMiss(key);
    return fail({ challenge: state.n + 1 >= CHALLENGE_AFTER && !!process.env.TURNSTILE_SITE_KEY });
  }

  misses.delete(key);
  // hand back the permanent link so the browser lands on the same page as the QR
  try {
    const token = await ensureToken(found.no);
    return NextResponse.json({ ok: true, url: `/track/${token}` }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail();
  }
}
