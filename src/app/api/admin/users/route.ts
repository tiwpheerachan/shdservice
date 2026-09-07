import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  const db = supabaseAdmin();

  // Resolve the target row id: explicit id (edit) → existing by email → new id.
  let id = str(body.id);
  if (!id && email) {
    const { data } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (data?.id) id = data.id as string;
  }
  const isNew = !id;
  if (!id) id = `U-${crypto.randomUUID().slice(0, 8)}`;

  // Only include lastLogin on create so we never wipe an existing user's value.
  const row: Record<string, unknown> = {
    id,
    code: str(body.code),
    name,
    username: str(body.username) || (email ? email.split("@")[0] : ""),
    role,
    branch: str(body.branch),
    email,
    phone: str(body.phone),
    status: str(body.status) || "Active",
  };
  if (isNew) row.lastLogin = "";

  const { error } = await db.from("users").upsert(row, { onConflict: "id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, user: row, created: isNew });
}
