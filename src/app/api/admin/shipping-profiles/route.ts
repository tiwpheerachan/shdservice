import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson, HttpError } from "@/server/auth";
import {
  listShippingProfiles,
  saveShippingProfile,
  deleteShippingProfile,
  type ShippingProfileInput,
} from "@/server/services/shipping-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** โปรไฟล์บริษัทขนส่ง — System Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json({ rows: await listShippingProfiles(false) });
});

export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = (await readJson(req)) as ShippingProfileInput;
  return NextResponse.json({ row: await saveShippingProfile(body, me.userId) });
});

export const DELETE = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "id required");
  await deleteShippingProfile(id, me.userId);
  return NextResponse.json({ ok: true });
});
