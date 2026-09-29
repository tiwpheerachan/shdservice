import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveSaleOrder, type SaleOrderInput } from "@/server/services/sale-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<SaleOrderInput>(req);
  const user = await requireCan(req, "Sale Order", body.no ? "edit" : "add");
  const order = await saveSaleOrder(body, user.userId);
  return NextResponse.json({ ok: true, order });
});
