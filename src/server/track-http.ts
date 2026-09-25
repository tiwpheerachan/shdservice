import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { clientIp } from "@/lib/client-ip";
import { hmac } from "./track-guard";

/** every tracking response: never cached anywhere (spec §P, §AE) */
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function trackJson(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** per-request context: trusted IP (+ its HMAC for keys / logs), UA and a request id */
export function trackCtx(req: NextRequest) {
  const ip = clientIp(req.headers);
  return {
    ip,
    ipKey: hmac(`ip:${ip}`),
    ua: req.headers.get("user-agent") ?? "",
    requestId: randomUUID(),
  };
}

/** small JSON body only (no field is ever longer than a few hundred chars) */
export async function readSmallJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > 8_192) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max = 256) => (typeof v === "string" ? v.slice(0, max) : "");
