import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireAdmin } from '@/server/auth';
import { alertsAnomaliesList } from '@/server/contract/alerts';
import { parsePageQuery, searchOf } from '@/server/paging';
import { anomalyPage } from '@/server/services/anomalies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — /admin/anomalies: one page (≤ 100 rows), the category filtered in SQL */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const query = parseQuery(req, alertsAnomaliesList);
  const p = parsePageQuery(searchOf(query), { pageSize: 50 });
  return NextResponse.json(await anomalyPage({ ...p, pageSize: Math.min(p.pageSize, 100) }, query.category), {
    headers: { 'Cache-Control': 'no-store' },
  });
});
