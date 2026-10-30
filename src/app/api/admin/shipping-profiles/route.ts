import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseQuery, requireAdmin } from '@/server/auth';
import { shippingProfileDelete, shippingProfileSave } from '@/server/contract/admin';
import { listShippingProfiles, saveShippingProfile, deleteShippingProfile } from '@/server/services/shipping-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** โปรไฟล์บริษัทขนส่ง — System Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json({ rows: await listShippingProfiles(false) });
});

export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = await parseBody(req, shippingProfileSave);
  return NextResponse.json({ row: await saveShippingProfile(body, me.pk) });
});

export const DELETE = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const { id } = parseQuery(req, shippingProfileDelete); // not a uuid → 404
  await deleteShippingProfile(id, me.pk);
  return NextResponse.json({ ok: true });
});
