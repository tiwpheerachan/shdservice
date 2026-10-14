import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { assignJobs } from "@/server/services/jobs";
import { assertValid } from "@/server/validate";
import { assignSchema } from "@/lib/validation/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** จนท.รับมอบหมายงาน — assign engineer to many jobs. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Job Assign", "edit");
  const body = assertValid(assignSchema, await readJson(req));
  const n = await assignJobs(body.jobNos, body.engineerId, user.userId);
  return NextResponse.json({ ok: true, assigned: n });
});
