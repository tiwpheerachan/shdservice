import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson, HttpError } from "@/server/auth";
import { listDocumentProfiles, saveDocumentProfile, deleteDocumentProfile, type DocumentProfileInput } from "@/server/services/document-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** โปรไฟล์ผู้ออกเอกสาร (ออกเอกสารในนาม) — System Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json({ rows: await listDocumentProfiles(false) });
});

/** DELETE ?id= — soft delete (see deleteDocumentProfile for the rules). */
export const DELETE = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "id required");
  await deleteDocumentProfile(id, me.userId);
  return NextResponse.json({ ok: true });
});

export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = (await readJson(req)) as DocumentProfileInput;
  const row = await saveDocumentProfile(body, me.userId);
  return NextResponse.json({ row });
});
