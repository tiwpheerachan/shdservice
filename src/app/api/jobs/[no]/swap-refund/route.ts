import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveSwapRefund, type SwapRefundInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, "Job Management", "edit");
  const { no } = await ctx.params;
  const body = await readJson<SwapRefundInput>(req);
  const job = await saveSwapRefund(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
