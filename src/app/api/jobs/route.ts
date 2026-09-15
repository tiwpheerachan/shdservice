import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { createJob, type JobInput } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** เปิดงานใหม่ */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Job Management", "add");
  const body = await readJson<JobInput>(req);
  const job = await createJob(body, user.userId);
  return NextResponse.json({ ok: true, job });
});
