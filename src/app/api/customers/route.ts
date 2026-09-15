import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveCustomer, type CustomerInput } from "@/server/services/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create (add) or update (edit) a customer. */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<CustomerInput>(req);
  const user = await requireCan(req, "Customer", body.code ? "edit" : "add");
  const row = await saveCustomer(body, user.userId);
  return NextResponse.json({ ok: true, row });
});
