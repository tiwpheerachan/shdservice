import type { Metadata } from "next";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "ติดตามสถานะงานซ่อม",
  robots: { index: false, follow: false },
};

/**
 * Public shell for the customer tracking pages (no login, no AppShell).
 * Carries the company identity on purpose: an anonymous page that shows repair
 * data must look unmistakably like the company it belongs to — the opposite of
 * a phishing page (see docs §33, the Google Web Risk flag).
 */
export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={COMPANY.logoMark} alt="" className="h-8 w-auto" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{COMPANY.nameTh}</p>
            <p className="truncate text-2xs text-muted-foreground">ติดตามสถานะงานซ่อม</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-2">
        <div className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">{COMPANY.nameTh}</p>
          <p>{COMPANY.address}</p>
          <p>โทร {COMPANY.phone}</p>
          <p className="mt-2 text-warning">
            หน้านี้แสดงสถานะงานซ่อมเท่านั้น · <strong>ระบบนี้ไม่ขอรหัสผ่าน เลขบัตรเครดิต หรือให้โอนเงินผ่านลิงก์</strong> —
            หากพบหน้าที่ขอข้อมูลเหล่านี้ กรุณาแจ้งศูนย์บริการ
          </p>
        </div>
      </footer>
    </div>
  );
}
