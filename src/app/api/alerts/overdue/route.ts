import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan } from "@/server/auth";
import { overdueAlerts } from "@/server/services/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the notification bell: overdue open jobs (an Engineer gets only their own) */
export const GET = handle(async (req: NextRequest) => {
  const me = await requireCan(req, "Job Management", "view");
  return NextResponse.json(await overdueAlerts(me), { headers: { "Cache-Control": "no-store" } });
});
