import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/server/auth";
import { getCustomerByCode, listCustomers } from "@/server/services/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Find customers by code / tax id / name / phone (job & quotation forms). */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ rows: [] });
  const exact = await getCustomerByCode(q);
  if (exact) return NextResponse.json({ rows: [exact] });
  const rows = await listCustomers({ q, limit: 20 });
  return NextResponse.json({ rows });
});
