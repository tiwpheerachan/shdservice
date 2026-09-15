import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/server/auth";
import { readResource } from "@/server/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generic read endpoint used by the data hooks (src/data/db.ts). */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => {
  const { resource } = await ctx.params;
  const data = await readResource(req, resource);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
});
