// SERVER-ONLY directory helpers. CENTRAL_API_KEY authorizes the call and must
// never reach the browser — import this only from route handlers / server code.
//
// Central directory = a copy of the Lark employee list, synced every 3 h and
// exposed to apps holding the `directory:read:people` scope (SSO manual, step G).
// Real response shape (verified 2026-09-17):
//   GET /directory/search?q=&limit=  → { ok, synced_at, stale, count, max, items: Person[] }
//   GET /directory/user?email=|union_id= → { ok, synced_at, stale, person: Person }
//   Person = { union_id, name, en_name, email, job_title, departments[], city, country,
//              manager, manager_union_id, avatar_url, status }

const CENTRAL = "https://sso.shd-technology.co.th/api/v1";

export type DirectoryProfile = {
  /** Lark union_id — stable across email changes; stored in app_user.lark_id */
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  phone: string; // not provided by the directory — kept for callers' shape
  avatar: string;
  status: string; // "active" | … (anything else = left the company / suspended)
  manager: string;
};

export type DirectorySearch = {
  items: DirectoryProfile[];
  /** last successful sync (ISO) */
  syncedAt: string;
  /** true = the last sync was incomplete; results may be missing people */
  stale: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function mapPerson(p: Record<string, unknown>): DirectoryProfile {
  const depts = Array.isArray(p.departments) ? (p.departments as unknown[]).map(str).filter(Boolean) : [];
  return {
    id: str(p.union_id) || str(p.id) || str(p.email),
    name: str(p.name) || str(p.en_name),
    email: str(p.email).toLowerCase(),
    department: depts.join(" / ") || str(p.department),
    title: str(p.job_title) || str(p.title),
    phone: str(p.phone) || str(p.mobile),
    avatar: str(p.avatar_url) || str(p.avatar),
    status: str(p.status) || "active",
    manager: str(p.manager),
  };
}

function headers() {
  const key = process.env.CENTRAL_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : null;
}

/**
 * Search people by name / email (≥ 2 chars, max 20). Throws with the upstream
 * status so the caller can tell "misconfigured" (401/403) from "down" (5xx).
 */
export async function searchDirectory(q: string, limit = 20): Promise<DirectorySearch> {
  const h = headers();
  if (!h) throw new Error("CENTRAL_API_KEY is not configured on the server");
  const res = await fetch(`${CENTRAL}/directory/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`, { headers: h, cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; need?: string };
    throw new Error(`directory responded ${res.status}${body.error ? ` (${body.error}${body.need ? `: ${body.need}` : ""})` : ""}`);
  }
  const data = (await res.json()) as { items?: unknown; synced_at?: string; stale?: boolean };
  const raw = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  return { items: raw.map(mapPerson), syncedAt: str(data.synced_at), stale: !!data.stale };
}

/** One employee's profile by exact email (GET /directory/user). null when unknown / directory unavailable. */
export async function lookupByEmail(email: string): Promise<DirectoryProfile | null> {
  const h = headers();
  const target = email.trim().toLowerCase();
  if (!h || !target) return null;
  try {
    const res = await fetch(`${CENTRAL}/directory/user?email=${encodeURIComponent(target)}`, { headers: h, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { person?: Record<string, unknown> };
    return data.person ? mapPerson(data.person) : null;
  } catch {
    return null;
  }
}
