import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/server/auth";
import { listDistricts, listProvinces, listSubDistricts } from "@/server/services/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cascading address lists: ?level=province | district&city= | subdistrict&district= */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const level = sp.get("level") ?? "province";
  if (level === "district") return NextResponse.json({ rows: await listDistricts(Number(sp.get("city"))) });
  if (level === "subdistrict") return NextResponse.json({ rows: await listSubDistricts(Number(sp.get("district"))) });
  return NextResponse.json({ rows: await listProvinces() });
});
