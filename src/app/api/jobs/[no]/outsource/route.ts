import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveOutsource, type OutsourceInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, "Job Repair", "edit");
  const { no } = await ctx.params;
  const body = await readJson<OutsourceInput>(req);
  const job = await saveOutsource(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
