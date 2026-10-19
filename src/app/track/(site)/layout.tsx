import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { COMPANY } from '@/lib/company';
import { listDocumentProfiles } from '@/server/services/document-profiles';

export const metadata: Metadata = {
  title: 'ติดตามสถานะงานซ่อม',
  robots: { index: false, follow: false },
};
// reads the document profile per request — never at build time (no DB there; a baked copy would go stale)
export const dynamic = 'force-dynamic';

/**
 * Public shell for the customer tracking pages (no login, no AppShell).
 * Carries the company identity on purpose: an anonymous page that shows repair
 * data must look unmistakably like the company it belongs to — the opposite of
 * a phishing page (see docs §33, the Google Web Risk flag). The identity is the default document
 * profile admins edit (cached list), COMPANY when there is none or the DB is down.
 */
export default async function TrackLayout({ children }: { children: React.ReactNode }) {
  const co = (await listDocumentProfiles().catch(() => [])).find((p) => p.isDefault) ?? COMPANY;
  // the per-request CSP nonce (src/proxy.ts) — 'strict-dynamic' trusts what this script loads in turn
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <div className="min-h-dvh bg-background">
      {/* Turnstile (the gate) from the server HTML: connection + api.js start with the page, not after
          hydration — React hoists both into <head>; track-client.tsx waits for window.turnstile */}
      <link rel="preconnect" href="https://challenges.cloudflare.com" />
      <script async src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" nonce={nonce} />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          {/* width/height = the default logo's ratio (1252×320 at 32 px): its box is reserved before it loads */}
          <img src={co.logoUrl} alt="" width={125} height={32} className="h-8 w-auto" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{co.nameTh}</p>
            <p className="truncate text-2xs text-muted-foreground">ติดตามสถานะงานซ่อม</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-2">
        <div className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">{co.nameTh}</p>
          <p>{co.address}</p>
          <p>โทร {co.phone}</p>
          <p className="mt-2 text-warning">
            หน้านี้แสดงสถานะงานซ่อมเท่านั้น ·{' '}
            <strong>ระบบนี้ไม่ขอรหัสผ่าน เลขบัตรเครดิต หรือให้โอนเงินผ่านลิงก์</strong> — หากพบหน้าที่ขอข้อมูลเหล่านี้
            กรุณาแจ้งศูนย์บริการ
          </p>
        </div>
      </footer>
    </div>
  );
}
