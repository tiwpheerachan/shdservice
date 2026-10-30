import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseParams, requireCan } from '@/server/auth';
import { trackLinkGet, trackLinkNew } from '@/server/contract/jobs';
import { audit } from '@/server/audit';
import { appBaseUrl } from '@/lib/sso';
import { rotateToken, trackLinkFor, linkStatus } from '@/server/services/tracking';
import { jobNoOf } from '@/server/services/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — the link's lifetime state, read-only: opening a job page never issues a link (nor writes an audit row).
 * Only a hash of a link is stored (drizzle/0025), so an existing one can never be shown again — staff issue one
 * with POST (the first one too) to get a copyable link. `url` stays in the answer for older clients: always "".
 */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireCan(req, 'Job Management', 'view');
  const no = await jobNoOf((await parseParams(ctx, trackLinkGet)).id);
  // `ready` (in the contract): always true — tracking needs nothing per job
  return NextResponse.json(
    { url: '', ready: true, status: await linkStatus(no) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/** POST — issue a NEW link; the previous one stops working immediately */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, 'Job Management', 'edit');
  const jobNo = await jobNoOf((await parseParams(ctx, trackLinkNew)).id);
  // the job's first link replaces none — decided under the job row's lock, with the audit line in the same tx
  const { token, status } = await rotateToken(jobNo, (tx, first) =>
    audit(tx, me.pk, {
      action: 'UPDATE',
      module: 'Job Management',
      entity: 'job',
      key: jobNo,
      summary: first
        ? `ออกลิงก์ติดตามให้ลูกค้า — ${jobNo}`
        : `ออกลิงก์ติดตามใหม่ให้ลูกค้า (ลิงก์เดิมใช้ไม่ได้แล้ว) — ${jobNo}`,
    }),
  );
  // returned once, to the staff member who generated it — only its hash is stored
  const url = trackLinkFor(token, appBaseUrl(req.headers.get('host')));
  return NextResponse.json({ url, status }, { headers: { 'Cache-Control': 'no-store' } });
});
