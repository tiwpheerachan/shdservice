import Link from "next/link";
import { LogOut, ArrowLeft } from "lucide-react";

export const metadata = { title: "ออกจากระบบ" };

export default function LogoutPage() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="surface w-full max-w-sm p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
          <LogOut className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">ออกจากระบบเรียบร้อย</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          เซสชันของ May - Pradit ถูกปิดแล้ว ขอบคุณที่ใช้งานระบบ
        </p>
        <Link
          href="/jobs/dashboard"
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          กลับเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
