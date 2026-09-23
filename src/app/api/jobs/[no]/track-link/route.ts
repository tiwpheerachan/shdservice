import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan } from "@/server/auth";
import { db } from "@/db/client";
import { audit } from "@/server/audit";
import { appBaseUrl } from "@/lib/sso";
import { ensureToken, rotateToken, trackingReady, trackLinkFor } from "@/server/services/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ no: string }> };

/** GET — the customer tracking link for this job (+ whether it is usable yet) */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireCan(req, "Job Management", "view");
  const { no } = await ctx.params;
  const jobNo = decodeURIComponent(no).toUpperCase();
  await ensureToken(jobNo); // older rows created before drizzle/0012
  const [url, ready] = await Promise.all([trackLinkFor(jobNo, appBaseUrl(req.headers.get("host"))), trackingReady(jobNo)]);
  return NextResponse.json({ url, ready }, { headers: { "Cache-Control": "no-store" } });
});

/** POST — issue a NEW link; the previous one stops working immediately */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, "Job Management", "edit");
  const { no } = await ctx.params;
  const jobNo = decodeURIComponent(no).toUpperCase();
  await rotateToken(jobNo);
  await audit(db, me.userId, {
    action: "UPDATE",
    module: "Job Management",
    entity: "job",
    key: jobNo,
    summary: `ออกลิงก์ติดตามใหม่ให้ลูกค้า (ลิงก์เดิมใช้ไม่ได้แล้ว) — ${jobNo}`,
  });
  const url = await trackLinkFor(jobNo, appBaseUrl(req.headers.get("host")));
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
});
