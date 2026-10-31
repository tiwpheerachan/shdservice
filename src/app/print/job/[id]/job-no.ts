import 'server-only';
import { userFromCookies, canViewAny, JOB_MODULES } from '@/server/auth';
import { jobNoOrNull } from '@/server/services/jobs';
import { db } from '@/db/client';
import { audit } from '@/server/audit';
import { runInPage } from '@/server/request-context';

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

/** PRINT event (audit() files it in security_log): who opened which job document for printing — in the page's
 *  request context, with the view check (cached grants) inside it so the line names the permission it used */
export async function logJobPrint(id: string, no: string, doc: string): Promise<void> {
  const user = await userFromCookies();
  await runInPage(user, async () => {
    if (user) await canViewAny(user, JOB_MODULES); // printJobNo already let this user through
    await audit(db, user?.pk ?? null, {
      action: 'PRINT',
      module: 'Job Management',
      entity: 'job',
      key: id.toLowerCase(),
      no,
      summary: `พิมพ์${doc} ${no}`,
    });
  });
}
