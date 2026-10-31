import { NextResponse, type NextRequest } from 'next/server';
import { handle, parseBody, parseQuery, requireAdmin } from '@/server/auth';
import { userSave, usersList } from '@/server/contract/admin';
import { lookupByEmail } from '@/lib/directory';
import { listSystemUsers, upsertUser, userPrev } from '@/server/services/users';
import { parseStatusMode } from '@/server/record-status';
import { assertValid } from '@/server/validate';
import { userSchema } from '@/lib/validation/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const str = (v: string | null | undefined) => v?.trim() ?? '';

/** people who signed in via SSO. Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const deleted = parseStatusMode(parseQuery(req, usersList).deleted);
  return NextResponse.json({ rows: await listSystemUsers(deleted) });
});

/** role = legacy user_type. Admin only. */
export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = await parseBody(req, userSave);

  // same rules as the user form (lib/validation/admin); an unchanged legacy username / phone passes; an edit
  // that leaves name / role out keeps the stored ones (the row's อนุมัติ / ถอนสิทธิ์ / คืนสิทธิ์ send only what they change)
  const prev = await userPrev(body.id);
  assertValid(userSchema(prev), prev ? { ...body, name: body.name ?? prev.name, role: body.role ?? prev.role } : body);
  const name = body.name == null ? undefined : str(body.name);
  const role = body.role == null ? undefined : str(body.role);
  const email = str(body.email).toLowerCase();

  // Enrich avatar/title (and fill blanks) from the directory when we have an email.
  const prof = email ? await lookupByEmail(email) : null;

  const { user, created } = await upsertUser(
    {
      id: str(body.id) || undefined,
      name,
      role,
      email,
      username: str(body.username) || undefined,
      code: str(body.code) || prof?.id || undefined,
      branch: str(body.branch) || prof?.department || undefined,
      phone: str(body.phone) || prof?.phone || undefined,
      status: str(body.status) || undefined,
      avatar: str(body.avatar) || prof?.avatar || undefined,
      title: str(body.title) || prof?.title || undefined,
      expect: body.expect,
    },
    me.pk,
  );
  return NextResponse.json({ ok: true, user, created });
});
