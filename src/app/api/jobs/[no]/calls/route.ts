import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, requireUser, readJson } from "@/server/auth";
import { addCallLog, listCallLogs } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ no: string }> };

export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireUser(req);
  const { no } = await ctx.params;
  return NextResponse.json({ rows: await listCallLogs(decodeURIComponent(no)) });
});

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, "Job Management", "edit");
  const { no } = await ctx.params;
  const body = await readJson<{ detail: string }>(req);
  return NextResponse.json({ ok: true, rows: await addCallLog(decodeURIComponent(no), body.detail ?? "", user.userId) });
});
