import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser, HttpError } from "@/server/auth";
import { signedUrl } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/files?path=products/P00230/x.jpg → 302 to a short-lived signed URL (login required). */
export const GET = handle(async (req: NextRequest) => {
  await requireUser(req);
  const path = (new URL(req.url).searchParams.get("path") ?? "").replace(/^\/+/, "");
  if (!path || path.includes("..")) throw new HttpError(400, "path required");
  const url = await signedUrl(path, 3600);
  if (!url) throw new HttpError(404, "ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)");
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, max-age=300" } });
});
