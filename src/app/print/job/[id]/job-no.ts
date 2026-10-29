import 'server-only';
import { userFromCookies, canViewAny, JOB_MODULES } from '@/server/auth';
import { jobNoOrNull } from '@/server/services/jobs';

/**
 * The job a print view's path names (its uuid, ADR 0008) → its number; null = not for this user (view on a job
 * screen, ./layout.tsx's rule — checked here too: layouts can be skipped on partial renders), an old number link
 * or no such job. The page answers not found; the tab title leaves the number out.
 */
export async function printJobNo(id: string): Promise<string | null> {
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, JOB_MODULES))) return null;
  return jobNoOrNull(id);
}
