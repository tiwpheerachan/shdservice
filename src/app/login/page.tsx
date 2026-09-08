import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shared/logo";

export const metadata = { title: "เข้าสู่ระบบ" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  state_mismatch: "เซสชันหมดอายุระหว่างเข้าสู่ระบบ กรุณาลองใหม่",
  missing_code: "ไม่ได้รับรหัสยืนยันจากระบบกลาง",
  no_email: "บัญชีนี้ไม่มีอีเมลในระบบกลาง",
  server_not_configured: "ยังไม่ได้ตั้งค่า CENTRAL_API_KEY บนเซิร์ฟเวอร์",
  verify_unreachable: "เชื่อมต่อระบบกลางไม่ได้ ลองใหม่อีกครั้ง",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; bye?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next ?? "/jobs/dashboard";
  const err = sp.error
    ? ERRORS[sp.error] ?? `เข้าสู่ระบบไม่สำเร็จ (${sp.error})`
    : null;

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mx-auto mb-6 flex justify-center">
          <Logo className="h-9 w-auto" />
        </div>

        <div className="surface p-7">
          <h1 className="text-center text-lg font-semibold tracking-tight">
            ระบบบริหารงานบริการ
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            เข้าสู่ระบบด้วยบัญชีพนักงาน SHD
          </p>

          {sp.bye && (
            <p className="mt-4 rounded-md bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
              ออกจากระบบเรียบร้อยแล้ว
            </p>
          )}
          {err && (
            <p className="mt-4 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-center text-xs text-danger">
              {err}
            </p>
          )}

          <Link
            href={`/api/sso/login?next=${encodeURIComponent(next)}`}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            เข้าสู่ระบบด้วย SHD SSO
          </Link>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            ยืนยันตัวตนผ่าน sso.shd-technology.co.th
          </p>
        </div>

        <p className="mt-5 text-center text-2xs text-muted-foreground">
          © 2026 SHD Technology Co., Ltd.
        </p>
      </div>
    </div>
  );
}
