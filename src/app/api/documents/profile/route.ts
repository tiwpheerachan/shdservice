import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson, HttpError } from "@/server/auth";
import { setDocumentProfile, DOC_MODULE, type DocumentKind } from "@/server/services/document-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { kind: "job" | "quotation" | "sale_order", no, profileId }
 * Change "ออกเอกสารในนาม" of an existing document (edit screen / print button).
 * Needs `edit` on the document's module; the number never changes; audited.
 */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson<{ kind?: DocumentKind; no?: string; profileId?: number }>(req);
  const kind = body.kind;
  if (kind !== "job" && kind !== "quotation" && kind !== "sale_order") throw new HttpError(400, "kind required");
  const no = String(body.no ?? "").trim().toUpperCase();
  const profileId = Number(body.profileId);
  if (!no) throw new HttpError(400, "no required");
  if (!Number.isFinite(profileId) || profileId <= 0) throw new HttpError(400, "profileId required");
  const me = await requireCan(req, DOC_MODULE[kind], "edit");
  const profile = await setDocumentProfile(kind, no, profileId, me.userId);
  return NextResponse.json({ ok: true, profile: { id: profile.id, code: profile.code, nameTh: profile.nameTh } });
});
