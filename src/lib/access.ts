// Access rules shared by the SSO callback, the refresh endpoint, and the UI.
// A user may enter the app only once an admin has assigned a real role
// (i.e. not PENDING_ROLE) and their account is Active.

export const PENDING_ROLE = 'รออนุมัติ';

/**
 * Owner emails become System Admin when their app_user row has no role yet — a
 * bootstrap so a fresh DB always has an admin. An admin can still change or
 * disable an owner later. Read from OWNER_EMAILS (comma-separated) in every
 * environment — none set = no owner (dev: put yours in .env.development.local;
 * the e2e server sets its own, tests/e2e/support/env.ts).
 */
export function ownerEmails(): string[] {
  return Array.from(
    new Set(
      (process.env.OWNER_EMAILS || '')
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function isOwner(email: string): boolean {
  return ownerEmails().includes(email.trim().toLowerCase());
}

/** True when this role + status combination is allowed to use the app. */
export function isApproved(role: string | null | undefined, status: string | null | undefined): boolean {
  const r = (role || '').trim();
  const s = (status || '').trim();
  if (!r || r === PENDING_ROLE) return false;
  if (s && s.toLowerCase() !== 'active') return false;
  return true;
}
