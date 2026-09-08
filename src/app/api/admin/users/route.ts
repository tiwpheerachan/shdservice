import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import {
  findUserIdByEmail,
  upsertUserRow,
  dedupeUsersByEmail,
} from "@/lib/supabase-admin";
import { lookupByEmail } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function requireSession(req: NextRequest) {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Create or update a OneService user. Callers pick a real employee from the Lark
 * directory (GET /api/directory/search) and assign a role here; the role maps to
 * the permission matrix in the `permissions` table. Writes use the server secret
 * key (bypasses RLS) and require a valid SSO session.
 */
export async function POST(req: NextRequest) {
  const me = await requireSession(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = str(body.name);
  const role = str(body.role);
  const email = str(body.email).toLowerCase();
  if (!name || !role) {
    return NextResponse.json({ error: "name and role are required" }, { status: 400 });
  }

  // Enrich avatar/title (and fill blanks) from the directory when we have an email.
  const prof = email ? await lookupByEmail(email) : null;

  try {
    // Resolve the target row id: explicit id (edit) → existing by email → new id.
    let id = str(body.id);
    if (!id && email) {
      id = (await findUserIdByEmail(email)) ?? "";
    }
    const isNew = !id;
    if (!id) id = `U-${crypto.randomUUID().slice(0, 8)}`;

    const row: Record<string, unknown> = {
      id,
      code: str(body.code) || prof?.id || "",
      name,
      username: str(body.username) || (email ? email.split("@")[0] : ""),
      role,
      branch: str(body.branch) || prof?.department || "",
      email,
      phone: str(body.phone) || prof?.phone || "",
      status: str(body.status) || "Active",
      avatar: str(body.avatar) || prof?.avatar || "",
      title: str(body.title) || prof?.title || "",
    };
    // Only set lastLogin on create so we never wipe an existing user's value.
    if (isNew) row.lastLogin = "";

    const errMsg = await upsertUserRow(row);
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: 500 });
    if (email) await dedupeUsersByEmail(email, id);
    return NextResponse.json({ ok: true, user: row, created: isNew });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server database is not configured" },
      { status: 503 }
    );
  }
}
