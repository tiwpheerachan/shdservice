import { type NextRequest } from "next/server";
import { handle } from "@/server/auth";
import { exportXlsx } from "@/server/export";
import { rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export/<resource>?<same filters as /api/data/<resource>> → .xlsx download */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => {
  const { resource } = await ctx.params;
  await rateLimit(req, "export", 5); // xlsx of up to 50k rows is the heaviest thing we do
  const { buffer, filename } = await exportXlsx(req, resource);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
