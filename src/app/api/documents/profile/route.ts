import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, requireCan } from '@/server/auth';
import { documentProfileSet } from '@/server/contract/sales';
import { setDocumentProfile, DOC_MODULE } from '@/server/services/document-profiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** change "ออกเอกสารในนาม" of an existing document: needs `edit` on its module, the number never changes, audited */
export const POST = handle(async (req: NextRequest) => {
  // before the permission check, which needs `kind`
  const { kind, no, profileId } = await parseBody(req, documentProfileSet);
  const me = await requireCan(req, DOC_MODULE[kind], 'edit');
  const profile = await setDocumentProfile(kind, no, profileId, me.pk, me.isAdmin);
  return NextResponse.json({ ok: true, profile: { id: profile.id, code: profile.code, nameTh: profile.nameTh } });
});
