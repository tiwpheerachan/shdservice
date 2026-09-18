import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson } from "@/server/auth";
import { listDocumentProfiles, saveDocumentProfile, type DocumentProfileInput } from "@/server/services/document-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** โปรไฟล์ผู้ออกเอกสาร (ออกเอกสารในนาม) — System Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json({ rows: await listDocumentProfiles(false) });
});

export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = (await readJson(req)) as DocumentProfileInput;
  const row = await saveDocumentProfile(body, me.userId);
  return NextResponse.json({ row });
});
