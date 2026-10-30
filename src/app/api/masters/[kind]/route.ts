import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseParams, requireAdmin } from '@/server/auth';
import { masterSave } from '@/server/contract/admin';
import { isSimpleKind, saveSimple, saveSymptom, saveModel } from '@/server/services/masters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create/update master data (ข้อมูลระบบ). System Admin only. */
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ kind: string }> }) => {
  const me = await requireAdmin(req);
  // every field as text (masterSave); the kind is checked after the body: 404 "unknown master: …"
  const b = await parseBody(req, masterSave);
  const { kind } = await parseParams(ctx, masterSave);
  if (isSimpleKind(kind)) {
    const row = await saveSimple(
      kind,
      {
        id: b.id ?? undefined,
        name: b.name ?? '',
        detail: b.detail,
        extra: b.extra,
        days: b.days,
        status: b.status,
        expect: b.expect,
      },
      me.pk,
    );
    return NextResponse.json({ ok: true, row });
  }
  if (kind === 'symptoms') {
    const row = await saveSymptom(
      {
        id: b.id ?? undefined,
        name: b.name ?? '',
        detail: b.detail,
        group: b.group,
        status: b.status,
        expect: b.expect,
      },
      me.pk,
    );
    return NextResponse.json({ ok: true, row });
  }
  const row = await saveModel(
    { code: b.code, name: b.name ?? '', brand: b.brand ?? '', price: b.price, status: b.status, expect: b.expect },
    me.pk,
  );
  return NextResponse.json({ ok: true, row });
});
