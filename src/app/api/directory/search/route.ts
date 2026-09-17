import { NextResponse } from "next/server";
import { searchDirectory } from "@/lib/directory";

// Runs only on the server. CENTRAL_API_KEY never leaves this file / the server —
// the browser calls OUR /api/directory/search, and we proxy to the central API.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  if (!process.env.CENTRAL_API_KEY) {
    // fail explicitly instead of silently returning nothing
    return NextResponse.json({ items: [], error: "CENTRAL_API_KEY is not configured on the server" }, { status: 500 });
  }

  try {
    const { items, stale, syncedAt } = await searchDirectory(q, 20);
    // pass through only the fields the UI needs — never echo the token or upstream headers
    return NextResponse.json({
      items: items.map((p) => ({ id: p.id, name: p.name, email: p.email, department: p.department, title: p.title, avatar: p.avatar, status: p.status })),
      stale,
      synced_at: syncedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "directory service unavailable";
    return NextResponse.json({ items: [], error: msg }, { status: 502 });
  }
}
