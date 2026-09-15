import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson, HttpError } from "@/server/auth";
import { isSimpleKind, saveSimple, saveSymptom, saveModel } from "@/server/services/masters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create/update master data (ข้อมูลระบบ). System Admin only. */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ kind: string }> }) => {
  await requireAdmin(req);
  const { kind } = await ctx.params;
  const body = await readJson<Record<string, unknown>>(req);
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : body[k] == null ? undefined : String(body[k]));
  if (isSimpleKind(kind)) {
    const row = await saveSimple(kind, { id: s("id"), name: s("name") ?? "", detail: s("detail"), extra: s("extra"), status: s("status") });
    return NextResponse.json({ ok: true, row });
  }
  if (kind === "symptoms") {
    const row = await saveSymptom({ id: s("id"), name: s("name") ?? "", detail: s("detail"), group: s("group"), status: s("status") });
    return NextResponse.json({ ok: true, row });
  }
  if (kind === "models") {
    const row = await saveModel({ code: s("code"), name: s("name") ?? "", brand: s("brand") ?? "", price: s("price"), status: s("status") });
    return NextResponse.json({ ok: true, row });
  }
  throw new HttpError(404, `unknown master: ${kind}`);
});
