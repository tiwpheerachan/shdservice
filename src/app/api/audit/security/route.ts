import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseQuery, requireAdmin } from '@/server/auth';
import { securityList } from '@/server/contract/audit';
import { pageSecurity } from '@/server/audit';
import { parsePageQuery, searchOf } from '@/server/paging';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  await rateLimit(req, 'data', 240);
  const query = parseQuery(req, securityList);
  const p = parsePageQuery(searchOf(query));
  return NextResponse.json(await pageSecurity(p, p.f), { headers: { 'Cache-Control': 'no-store' } });
});
