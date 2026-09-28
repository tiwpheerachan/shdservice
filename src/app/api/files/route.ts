import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser, HttpError } from "@/server/auth";
import { signedUrl } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/files?path=products/P00230/x.jpg → 302 to a short-lived signed URL.
 *
 * Only the folders the app actually writes (storage.ts `filePath`) can be signed —
 * never an arbitrary object in the bucket:
 *   jobs/{no}/attachments|slip/…   sale-orders/{no}/slip/…   products/{code}/…
 *   profiles/{id}/…                shippers/{id}/…
 * Courier logos (shippers/) and letterhead logos (profiles/, document profiles — nothing
 * else is stored there) are public: the customer tracking page and the customer's documents
 * (/track/doc) show them to visitors who are not signed in. Everything else needs a signed-in staff user.
 */
const STAFF_PATH = /^(?:jobs\/[^/]+\/(?:attachments|slip)|sale-orders\/[^/]+\/slip|products\/[^/]+)\/[^/]+$/;
const PUBLIC_PATH = /^(?:shippers|profiles)\/\d+\/[^/]+$/;
const URL_TTL_S = 300;

export const GET = handle(async (req: NextRequest) => {
  const path = (new URL(req.url).searchParams.get("path") ?? "").replace(/^\/+/, "");
  // no traversal, no control characters, no backslashes, sane length
  if (!path || path.length > 300 || path.includes("..") || /[\x00-\x1f\\]/.test(path)) throw new HttpError(400, "path required");

  const isPublic = PUBLIC_PATH.test(path);
  if (!isPublic) {
    await requireUser(req);
    if (!STAFF_PATH.test(path)) throw new HttpError(404, "ไม่พบไฟล์");
  }
  const url = await signedUrl(path, URL_TTL_S);
  if (!url) throw new HttpError(404, "ไม่พบไฟล์ (อาจอยู่บนระบบเก่า)");
  // the browser may reuse the redirect only while the signed URL is still valid
  return NextResponse.redirect(url, { headers: { "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${URL_TTL_S - 60}` } });
});
