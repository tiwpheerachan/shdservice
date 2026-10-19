import { NextResponse, type NextRequest } from 'next/server';
import { can, handle, parseParams, requireCan } from '@/server/auth';
import { trackLinkGet, trackLinkNew } from '@/server/contract/jobs';
import { db } from '@/db/client';
import { audit } from '@/server/audit';
import { appBaseUrl } from '@/lib/sso';
import { ensureToken, rotateToken, trackLinkFor, linkStatus } from '@/server/services/tracking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ no: string }> };

/**
 * GET — the link's lifetime state. `url` is set only when this call issued the job's first link: only
 * its hash is stored (drizzle/0025), so an existing link can never be shown again — staff generate a
 * new one (POST) to get a copyable link. Jobs are created without a link; the first one is issued here
 * only for someone POST would let issue one (edit), and audited like POST — a viewer just reads the state.
 */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'view');
  const { no } = await parseParams(ctx, trackLinkGet);
  const jobNo = decodeURIComponent(no).toUpperCase();
  const token = (await can(me, 'Job Management', 'edit')) ? await ensureToken(jobNo) : '';
  if (token)
    await audit(db, me.userId, {
      action: 'UPDATE',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary: `ออกลิงก์ติดตามให้ลูกค้า — ${jobNo}`,
    });
  const url = token ? trackLinkFor(token, appBaseUrl(req.headers.get('host'))) : '';
  // `ready` (in the contract): tracking needs nothing per job any more — every job can be tracked
  return NextResponse.json(
    { url, ready: true, status: await linkStatus(jobNo) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/** POST — issue a NEW link; the previous one stops working immediately */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'edit');
  const { no } = await parseParams(ctx, trackLinkNew);
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
