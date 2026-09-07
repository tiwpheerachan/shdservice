// SERVER-ONLY directory helpers. CENTRAL_API_KEY authorizes the call and must
// never reach the browser — import this only from route handlers / server code.

export type DirectoryProfile = {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  phone: string;
  avatar: string;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function mapPerson(p: Record<string, unknown>): DirectoryProfile {
  return {
    id: str(p.id) || str(p.employeeId) || str(p.email),
    name: str(p.name) || str(p.fullName) || str(p.displayName),
    email: str(p.email),
    department: str(p.department) || str(p.dept),
    title: str(p.title) || str(p.position),
    phone: str(p.phone) || str(p.mobile) || str(p.tel),
    avatar: str(p.avatar_url) || str(p.avatar) || str(p.photo) || str(p.picture),
  };
}

/** Look up one employee's full profile from the Lark directory by exact email. */
export async function lookupByEmail(email: string): Promise<DirectoryProfile | null> {
  const key = process.env.CENTRAL_API_KEY;
  const target = email.trim().toLowerCase();
  if (!key || !target) return null;
  try {
    const res = await fetch(
      `https://sso.shd-technology.co.th/api/v1/directory/search?q=${encodeURIComponent(
        target
      )}&limit=20`,
      { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data: { items?: unknown } = await res.json();
    const raw = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    const exact = raw.find((p) => str(p.email).toLowerCase() === target);
    const match = exact ?? raw[0];
    return match ? mapPerson(match) : null;
  } catch {
    return null;
  }
}
