import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser, HttpError } from "@/server/auth";
import { getQuotation } from "@/server/services/quotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireUser(req);
  const { no } = await ctx.params;
  const quotation = await getQuotation(decodeURIComponent(no).trim().toUpperCase());
  if (!quotation) throw new HttpError(404, "ไม่พบใบเสนอราคา " + no);
  return NextResponse.json({ quotation });
});
