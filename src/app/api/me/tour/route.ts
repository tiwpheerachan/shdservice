import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireUser } from '@/server/auth';
import { meTour } from '@/server/contract/misc';
import { saveTour } from '@/server/services/tour';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser(req);
  await saveTour(user.pk, await parseBody(req, meTour));
  return NextResponse.json({ ok: true });
});
