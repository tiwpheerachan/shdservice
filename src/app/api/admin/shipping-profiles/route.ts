import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseQuery, requireAdmin } from '@/server/auth';
import { shippingProfileDelete, shippingProfileSave } from '@/server/contract/admin';
import {
  listShippingProfiles,
  saveShippingProfile,
  deleteShippingProfile,
  type ShippingProfileInput,
} from '@/server/services/shipping-profiles';

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
  // the parsed body; the service's own type predates the contract (it reads null as none) — the old readJson<T> cast
  return NextResponse.json({ row: await saveShippingProfile(body as ShippingProfileInput, me.userId) });
});

export const DELETE = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const { id } = parseQuery(req, shippingProfileDelete); // 400 "id required"
  await deleteShippingProfile(id, me.userId);
  return NextResponse.json({ ok: true });
});
