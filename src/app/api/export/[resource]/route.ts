import { type NextRequest } from "next/server";
import { handle } from "@/server/auth";
import { exportXlsx } from "@/server/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export/<resource>?<same filters as /api/data/<resource>> → .xlsx download */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => {
  const { resource } = await ctx.params;
  const { buffer, filename } = await exportXlsx(req, resource);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
