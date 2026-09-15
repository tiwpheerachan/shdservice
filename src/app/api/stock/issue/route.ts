import { NextResponse, type NextRequest } from "next/server";
import { handle, requireCan, readJson, HttpError } from "@/server/auth";
import { issueForJob, issueForSaleOrder, issueOther } from "@/server/services/stock";
import { markPartsIssued } from "@/server/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  type: "job" | "sale" | "other";
  ref?: string;
  payTo?: string;
  remark?: string;
  lines: { logId?: number; dtId?: number; code?: string; qty: number }[];
};

/** ตัดจ่ายอะไหล่ → WHO document (type 3 / 4 / 5). */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireCan(req, "Product Pick Stock", "add");
  const b = await readJson<Body>(req);
  if (b.type === "job") {
    if (!b.ref) throw new HttpError(400, "ต้องระบุหมายเลขงาน");
    const r = await issueForJob({ jobNo: b.ref, remark: b.remark, payTo: b.payTo, lines: b.lines.map((l) => ({ logId: Number(l.logId), qty: Number(l.qty) })) }, user.userId);
    if (r.allGranted) await markPartsIssued(b.ref, user.userId);
    return NextResponse.json({ ok: true, ...r });
  }
  if (b.type === "sale") {
    if (!b.ref) throw new HttpError(400, "ต้องระบุเลขใบสั่งขาย");
    const r = await issueForSaleOrder({ soNo: b.ref, remark: b.remark, payTo: b.payTo, lines: b.lines.map((l) => ({ dtId: Number(l.dtId), qty: Number(l.qty) })) }, user.userId);
    return NextResponse.json({ ok: true, ...r });
  }
  const r = await issueOther({ payTo: b.payTo ?? "", remark: b.remark, lines: b.lines.map((l) => ({ code: String(l.code ?? ""), qty: Number(l.qty) })) }, user.userId);
  return NextResponse.json({ ok: true, ...r });
});
