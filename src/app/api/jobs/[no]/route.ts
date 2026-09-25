import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, requireUser, readJson, HttpError } from "@/server/auth";
import { getJob, updateJob, type JobInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ no: string }> };

/** Job detail for every job screen. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireUser(req);
  const { no } = await ctx.params;
  const job = await getJob(decodeURIComponent(no).trim().toUpperCase());
  if (!job) throw new HttpError(404, "ไม่พบหมายเลขงาน " + no);
  return NextResponse.json({ job });
});

/** แก้ไขข้อมูลงาน */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireCan(req, "Job Management", "edit");
  const { no } = await ctx.params;
  const body = await readJson<JobInput>(req);
  const job = await updateJob(decodeURIComponent(no), body, user.userId);
  return NextResponse.json({ ok: true, job });
});
