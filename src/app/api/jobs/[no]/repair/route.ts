import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveRepair, type RepairInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, "Job Repair", "edit");
  const { no } = await ctx.params;
  const body = await readJson<RepairInput>(req);
  const job = await saveRepair(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
