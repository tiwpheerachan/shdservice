import { redirect } from "next/navigation";
import { userFromCookies } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Print views: no app shell, white background, A4 page rules. Login required. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await userFromCookies();
  if (!user) redirect("/api/sso/login");
  if (!user.approved) redirect("/pending");
  return (
    <div className="print-root min-h-screen bg-neutral-200 py-6 text-black print:bg-white print:py-0">
      {children}
    </div>
  );
}
