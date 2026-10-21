import { type NextRequest } from 'next/server';
import { handle, parseParams, parseQuery } from '@/server/auth';
import { exportXlsx as exportOp } from '@/server/contract/data';
import { exportXlsx } from '@/server/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/export/<resource>?<same filters as /api/data/<resource>> → .xlsx download */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => {
  const { resource } = await parseParams(ctx, exportOp); // 404 "unknown export: …" before the session check
  const { stream, filename, truncatedOf } = await exportXlsx(req, resource, parseQuery(req, exportOp));
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...(truncatedOf ? { 'X-Export-Truncated': String(truncatedOf) } : {}),
    },
  });
});
