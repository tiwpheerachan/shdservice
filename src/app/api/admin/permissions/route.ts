import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown) => v === true || v === "true";

type Incoming = {
  role: string;
  menu: string;
  add: boolean;
  edit: boolean;
  del: boolean;
  view: boolean;
};

/**
 * Persist permission rows. Upserts by the natural key (role, menu) so it updates
 * an existing row or creates one — regardless of how the id was generated.
 * Requires a valid SSO session; writes with the server secret key (bypasses RLS).
 */
export async function POST(req: NextRequest) {
  const me = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const items: Incoming[] = Array.isArray(body.items)
    ? (body.items as Record<string, unknown>[])
        .map((r) => ({
          role: str(r.role),
          menu: str(r.menu),
          add: bool(r.add),
          edit: bool(r.edit),
          del: bool(r.del),
          view: bool(r.view),
        }))
        .filter((r) => r.role && r.menu)
    : [];

  if (items.length === 0) {
    return NextResponse.json({ error: "no items" }, { status: 400 });
  }

  let db;
  try {
    db = supabaseAdmin();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server database is not configured" },
      { status: 503 }
    );
  }

  try {
    for (const it of items) {
      const { data: existing } = await db
        .from("permissions")
        .select("id")
        .eq("role", it.role)
        .eq("menu", it.menu)
        .maybeSingle();
      const id = (existing?.id as string) ?? `${it.role}|${it.menu}`;
      const { error } = await db
        .from("permissions")
        .upsert(
          { id, role: it.role, menu: it.menu, add: it.add, edit: it.edit, del: it.del, view: it.view },
          { onConflict: "id" }
        );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, saved: items.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 }
    );
  }
}
