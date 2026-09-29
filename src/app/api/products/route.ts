import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveProduct, type ProductInput } from "@/server/services/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create or update a spare part (product + on-hand row + models). */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<ProductInput>(req);
  const user = await requireCan(req, "Product", body.sysCode ? "edit" : "add");
  const row = await saveProduct(body, user.userId);
  return NextResponse.json({ ok: true, row });
});
