import { NextResponse, type NextRequest } from 'next/server';
import { handle, requireCan } from '@/server/auth';
import { db } from '@/db/client';
import { audit } from '@/server/audit';
import { appBaseUrl } from '@/lib/sso';
import { ensureToken, rotateToken, trackingReady, trackLinkFor, linkStatus } from '@/server/services/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ no: string }> };

/**
 * GET — the link's lifetime state (+ whether tracking is usable yet). `url` is set only when this
 * call issued the job's first link: only its hash is stored (drizzle/0025), so an existing link
 * can never be shown again — staff generate a new one (POST) to get a copyable link.
 */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireCan(req, 'Job Management', 'view');
  const { no } = await ctx.params;
  const jobNo = decodeURIComponent(no).toUpperCase();
  const token = await ensureToken(jobNo); // jobs are created without a link
  const url = token ? trackLinkFor(token, appBaseUrl(req.headers.get('host'))) : '';
  const [ready, status] = await Promise.all([trackingReady(jobNo), linkStatus(jobNo)]);
  return NextResponse.json({ url, ready, status }, { headers: { 'Cache-Control': 'no-store' } });
});

/** POST — issue a NEW link; the previous one stops working immediately */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'edit');
  const { no } = await ctx.params;
  const jobNo = decodeURIComponent(no).toUpperCase();
  const token = await rotateToken(jobNo);
  await audit(db, me.userId, {
    action: 'UPDATE',
    module: 'Job Management',
    entity: 'job',
    key: jobNo,
    summary: `ออกลิงก์ติดตามใหม่ให้ลูกค้า (ลิงก์เดิมใช้ไม่ได้แล้ว) — ${jobNo}`,
  });
  // returned once, to the staff member who generated it — only its hash is stored
  const url = trackLinkFor(token, appBaseUrl(req.headers.get('host')));
  return NextResponse.json({ url, status: await linkStatus(jobNo) }, { headers: { 'Cache-Control': 'no-store' } });
});
