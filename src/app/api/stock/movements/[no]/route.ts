import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/server/auth";
import { movementLines } from "@/server/services/stock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ no: string }> }) => {
  await requireUser(req);
  const { no } = await ctx.params;
  return NextResponse.json({ rows: await movementLines(decodeURIComponent(no)) });
});
