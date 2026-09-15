import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser, HttpError } from "@/server/auth";
import { listPartRequests, listSaleOrderPickLines } from "@/server/services/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lines to issue for a reference document: ?type=job|sale&ref=J26…/SO26… */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const ref = (sp.get("ref") ?? "").trim();
  if (!ref) throw new HttpError(400, "ref required");
  if (type === "job") return NextResponse.json({ rows: await listPartRequests(ref, true) });
  if (type === "sale") return NextResponse.json({ rows: await listSaleOrderPickLines(ref) });
  throw new HttpError(400, "type must be job or sale");
});
