import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { documentAttach } from "@/db/schema";
import { handle, requireCan, requireUser, HttpError } from "@/server/auth";
import { removeAttachment } from "@/server/services/jobs";
import { removeFile, signedUrl } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Redirect to a short-lived signed URL for the stored file. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const [row] = await db.select().from(documentAttach).where(eq(documentAttach.documentAttachId, Number(id)));
  if (!row) throw new HttpError(404, "not found");
  const url = await signedUrl(`jobs/${row.referenceItemCode}/${row.systemFileName}`);
  if (!url) throw new HttpError(404, "ไฟล์นี้อยู่บนระบบเก่า ยังไม่ได้ย้ายมา");
  return NextResponse.redirect(url);
});

export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const me = await requireCan(req, "Job Management", "edit");
  const { id } = await ctx.params;
  const [row] = await db.select().from(documentAttach).where(eq(documentAttach.documentAttachId, Number(id)));
  if (!row) throw new HttpError(404, "not found");
  await removeAttachment(row.documentAttachId, me.userId);
  await removeFile(`jobs/${row.referenceItemCode}/${row.systemFileName}`);
  return NextResponse.json({ ok: true });
});
