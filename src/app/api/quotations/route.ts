import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson } from "@/server/auth";
import { saveQuotation, type QuotationInput } from "@/server/services/quotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<QuotationInput>(req);
  const user = await requireCan(req, "Quotation", body.no ? "edit" : "add");
  const quotation = await saveQuotation(body, user.userId);
  return NextResponse.json({ ok: true, quotation });
});
