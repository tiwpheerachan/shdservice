import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";
import { userFromCookies } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Print views: no app shell, white background, A4 page rules. Login required. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await userFromCookies();
  if (!user) {
    // our /login page, never straight to SSO (see src/lib/navigation.ts). A visitor with no cookie
    // never gets here — the proxy already sent them to /login?next=… — so this is a cookie that
    // no longer verifies (expired / signed out elsewhere), same as the (app) layout
    const next = (await headers()).get("next-url") || "";
    const q = new URLSearchParams();
    if ((await cookies()).get(SESSION_COOKIE)?.value) q.set("expired", "1");
    if (next) q.set("next", next);
    redirect(q.size ? `/login?${q}` : "/login");
  }
  if (!user.approved) redirect("/pending");
  return (
    <div className="print-root min-h-screen bg-neutral-200 py-6 text-black print:bg-white print:py-0">
      {children}
    </div>
  );
}
