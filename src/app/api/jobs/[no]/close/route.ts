import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { closeJob, type CloseInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, "Job Closing", "edit");
  const { no } = await ctx.params;
  const body = await readJson<CloseInput>(req);
  const job = await closeJob(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
