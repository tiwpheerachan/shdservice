import { safeNext } from "@/lib/sso";
import { COMPANY } from "@/lib/company";
import { LogIn, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { AuthSplit } from "@/components/ui/sign-in";

export const metadata = { title: "เข้าสู่ระบบ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const HERO = "/hero-shd.jpg";

const ERRORS: Record<string, string> = {
  state_mismatch: "ลิงก์เข้าสู่ระบบหมดอายุหรือถูกใช้ไปแล้ว กรุณากดเข้าสู่ระบบอีกครั้ง",
  missing_code: "ไม่ได้รับรหัสยืนยันจากระบบกลาง",
  no_email: "บัญชีนี้ไม่มีอีเมลในระบบกลาง",
  server_not_configured: "ยังไม่ได้ตั้งค่า CENTRAL_API_KEY บนเซิร์ฟเวอร์",
  verify_unreachable: "เชื่อมต่อระบบกลางไม่ได้ ลองใหม่อีกครั้ง",
  db_unavailable: "ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; bye?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  // only known codes are shown — never echo a URL parameter back onto the page
  const err = sp.error ? ERRORS[sp.error] ?? "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" : null;

  return (
    <main className="auth-page">
      <AuthSplit heroImageSrc={HERO} fit="contain">
        <div className="flex flex-col gap-6">
          <Logo variant="navy" className="h-9 w-auto self-start animate-element" />

          <div>
            <h1 className="animate-element animate-delay-100 text-3xl font-semibold tracking-tight sm:text-4xl">
              ยินดีต้อนรับ
            </h1>
            <p className="animate-element animate-delay-200 mt-2 text-muted-foreground">
              ระบบบริหารงานบริการหลังการขาย SHD — เข้าสู่ระบบด้วยบัญชีพนักงานผ่าน Single Sign-On
            </p>
          </div>

          {sp.expired && !sp.bye && (
            <p className="animate-element rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-center text-xs text-warning">
              เซสชันหมดอายุเนื่องจากไม่มีการใช้งานเกิน 30 นาที กรุณาเข้าสู่ระบบอีกครั้ง
            </p>
          )}
          {sp.bye && (
            <p className="animate-element rounded-xl border border-border bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
              ออกจากระบบเรียบร้อยแล้ว
            </p>
          )}
          {err && (
            <p className="animate-element rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-center text-xs text-danger">
              {err}
            </p>
          )}

          {/* plain <a>: a Next <Link> would prefetch /api/sso/login and mint a stray state */}
          <a
            href={`/api/sso/login?next=${encodeURIComponent(next)}`}
            rel="nofollow"
            className="animate-element animate-delay-300 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(90deg,#43a6f8,#55d5a1)" }}
          >
            <LogIn className="h-4 w-4" />
            เข้าสู่ระบบด้วย SHD SSO
          </a>

          <p className="animate-element animate-delay-400 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            ยืนยันตัวตนผ่านระบบกลางของบริษัท (sso.shd-technology.co.th) — ระบบนี้ไม่ขอรหัสผ่านของคุณ
          </p>

          {/* who runs this site — a plain statement of identity for people (and reviewers) landing here */}
          <div className="animate-element animate-delay-400 border-t border-border pt-4 text-2xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">{COMPANY.nameTh} · {COMPANY.nameEn}</p>
            <p>{COMPANY.address}</p>
            <p>
              โทร {COMPANY.phone} · เว็บไซต์{" "}
              <a href="https://shd-technology.co.th" className="underline" rel="noopener">shd-technology.co.th</a>
            </p>
            <p className="mt-1">
              OneService เป็นระบบภายในสำหรับพนักงาน SHD Technology เท่านั้น — Internal after-sales service system for SHD Technology staff. Not affiliated with Google.
            </p>
          </div>
        </div>
      </AuthSplit>
    </main>
  );
}
