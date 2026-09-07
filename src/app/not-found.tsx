import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="surface w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileQuestion className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">ไม่พบหน้าที่ต้องการ</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          หน้าที่คุณเรียกดูอาจถูกย้ายหรือไม่มีอยู่ในระบบ
        </p>
        <Link
          href="/jobs/dashboard"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
