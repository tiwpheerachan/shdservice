import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, parseQuery } from '@/server/auth';
import { dataOperations, dataResource, unknownResource } from '@/server/contract/data';
import { readResource } from '@/server/resources';
import { rateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generic read endpoint used by the data hooks (src/data/db.ts) — each resource's query as its operation declares it. */
export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => {
  const { resource } = await parseParams(ctx, dataResource);
  await rateLimit(req, 'data', 240); // a busy screen fires ~10–20 of these per load
  const data = await readResource(req, resource, parseQuery(req, dataOperations.get(resource) ?? unknownResource));
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
});
