import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { assignJobs } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** จนท.รับมอบหมายงาน — assign engineer to many jobs. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Job Assign", "edit");
  const body = await readJson<{ jobNos: string[]; engineerId: number | string }>(req);
  const n = await assignJobs(Array.isArray(body.jobNos) ? body.jobNos.map(String) : [], Number(body.engineerId), user.userId);
  return NextResponse.json({ ok: true, assigned: n });
});
