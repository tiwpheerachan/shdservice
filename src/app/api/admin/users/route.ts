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

/** List system users (people who signed in via SSO). Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const deleted = parseStatusMode(parseQuery(req, usersList).deleted);
  return NextResponse.json({ rows: await listSystemUsers(deleted) });
});

/**
 * Create or update a system user (app_user). Callers pick a real employee from
 * the Lark directory and assign a role (= legacy user_type). Admin only.
 */
export const POST = handle(async (req: NextRequest) => {
  const me = await requireAdmin(req);
  const body = await parseBody(req, userSave);

  // same rules as the user form (lib/validation/admin); an unchanged legacy username / phone passes
  assertValid(userSchema(await userPrev(body.id)), body);
  const name = str(body.name);
  const role = str(body.role);
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
    },
    me.userId,
  );
  return NextResponse.json({ ok: true, user, created });
});
