import { NextResponse, type NextRequest } from "next/server";
import { handle, requireAdmin, readJson, HttpError } from "@/server/auth";
import { lookupByEmail } from "@/lib/directory";
import { listSystemUsers, upsertUser, type DeletedMode } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** List system users (people who signed in via SSO). Admin only. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const deleted = (new URL(req.url).searchParams.get("deleted") ?? "exclude") as DeletedMode;
  return NextResponse.json({ rows: await listSystemUsers(deleted) });
});

/**
 * Create or update a system user (app_user). Callers pick a real employee from
 * the Lark directory and assign a role (= legacy user_type). Admin only.
 */
export const POST = handle(async (req: NextRequest) => {
  await requireAdmin(req);
  const body = await readJson(req);

  const name = str(body.name);
  const role = str(body.role);
  const email = str(body.email).toLowerCase();
  if (!name || !role) throw new HttpError(400, "name and role are required");

  // Enrich avatar/title (and fill blanks) from the directory when we have an email.
  const prof = email ? await lookupByEmail(email) : null;

  const { user, created } = await upsertUser({
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
  });
  return NextResponse.json({ ok: true, user, created });
});
