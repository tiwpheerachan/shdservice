import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser, HttpError } from "@/server/auth";
import { getProduct, productStockCard } from "@/server/services/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Product detail + stock card (product-detail modal). */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  await requireUser(req);
  const { code } = await ctx.params;
  const product = await getProduct(code);
  if (!product) throw new HttpError(404, "ไม่พบรหัสอะไหล่ " + code);
  const card = await productStockCard(code);
  return NextResponse.json({ product, card });
});
