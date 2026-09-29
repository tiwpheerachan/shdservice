import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { approveSaleOrder } from "@/server/services/sale-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** อนุมัติ / ปฏิเสธ / ส่งกลับแก้ไข — approval issues stock (WHO type 4). */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  const user = await requireCan(req, "Sale Order", "edit");
  const { no } = await ctx.params;
  const body = await readJson<{ decision: "approve" | "deny" | "reject"; remark?: string }>(req);
  const order = await approveSaleOrder(decodeURIComponent(no), body.decision, body.remark ?? "", user.userId);
  return NextResponse.json({ ok: true, order });
});
