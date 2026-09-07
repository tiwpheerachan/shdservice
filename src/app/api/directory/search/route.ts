import { NextResponse } from "next/server";

// Runs only on the server. CENTRAL_API_KEY never leaves this file / the server —
// the browser calls OUR /api/directory/search, and we proxy to the central API.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Person = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const key = process.env.CENTRAL_API_KEY;
  if (!key) {
    // fail explicitly instead of silently returning nothing
    return NextResponse.json(
      { items: [], error: "CENTRAL_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://sso.shd-technology.co.th/api/v1/directory/search?q=${encodeURIComponent(
        q
      )}&limit=20`,
      {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return NextResponse.json(
        { items: [], error: `directory responded ${res.status}` },
        { status: 502 }
      );
    }

    const data: { items?: unknown } = await res.json();
    const raw = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];

    // pass through only the fields the UI needs — never echo the token or upstream headers
    const items: Person[] = raw.map((p) => ({
      id: str(p.id) || str(p.employeeId) || str(p.email),
      name: str(p.name) || str(p.fullName) || str(p.displayName),
      email: str(p.email),
      department: str(p.department) || str(p.dept),
      title: str(p.title) || str(p.position),
    }));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json(
      { items: [], error: "directory service unavailable" },
      { status: 502 }
    );
  }
}
