import { notFound } from "next/navigation";
import { userFromCookies, canViewAny, JOB_MODULES } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * Every job print view (receipt, /return, /label — customer name, address, phone) needs
 * "view" on a job screen, the same rule as GET /api/jobs/[no]. app/print/layout.tsx
 * only checks sign-in + approval.
 */
export default async function JobPrintLayout({ children }: { children: React.ReactNode }) {
  const user = await userFromCookies();
  if (!user || !(await canViewAny(user, JOB_MODULES))) notFound();
  return children;
}
