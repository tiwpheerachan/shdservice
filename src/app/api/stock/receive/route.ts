import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { receiveStock } from "@/server/services/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** รับเข้าอะไหล่ → WHI document. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Product Receive Stock", "add");
  const body = await readJson<Parameters<typeof receiveStock>[0]>(req);
  const r = await receiveStock(body, user.userId);
  return NextResponse.json({ ok: true, ...r });
});
