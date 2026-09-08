// Access rules shared by the SSO callback, the refresh endpoint, and the UI.
// A user may enter the app only once an admin has assigned a real role
// (i.e. not PENDING_ROLE) and their account is Active.

export const PENDING_ROLE = "รออนุมัติ";
export const ADMIN_ROLE = "System Admin";

/**
 * Owner emails are ALWAYS treated as System Admin — a bootstrap so the person
 * running the system can never lock themselves out (e.g. after a DB reset).
 * Configure via OWNER_EMAILS (comma-separated); the defaults are the project owner.
 */
const DEFAULT_OWNERS = [
  "the.dataverse@shd-technology.co.th",
  "tiw.pheerachan@shd-technology.co.th",
];

export function ownerEmails(): string[] {
  const fromEnv = (process.env.OWNER_EMAILS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_OWNERS, ...fromEnv]));
}

export function isOwner(email: string): boolean {
  return ownerEmails().includes(email.trim().toLowerCase());
}

/** True when this role + status combination is allowed to use the app. */
export function isApproved(role: string | null | undefined, status: string | null | undefined): boolean {
  const r = (role || "").trim();
  const s = (status || "").trim();
  if (!r || r === PENDING_ROLE) return false;
  if (s && s.toLowerCase() !== "active") return false;
  return true;
}
