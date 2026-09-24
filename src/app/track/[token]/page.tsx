import Link from "next/link";
import { CircleCheck, CircleDot, Circle, Ban, PackageSearch, Truck, ExternalLink } from "lucide-react";
import { trackByToken, TRACK_STEPS } from "@/server/services/tracking";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** the whole point of the token: no personal data in the URL, nothing to enumerate */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const j = await trackByToken(decodeURIComponent(token));

  if (!j) {
    return (
      <div className="surface p-8 text-center">
        <PackageSearch className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
        <h1 className="text-base font-semibold">ไม่พบข้อมูลงานซ่อม</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          ลิงก์อาจหมดอายุหรือไม่ถูกต้อง ลองค้นด้วยเลขที่เอกสารแทน หรือติดต่อศูนย์บริการ
        </p>
        <Link href="/track" className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          ค้นด้วยเลขที่เอกสาร
        </Link>
      </div>
    );
  }

  const reached = new Map(j.history.map((h) => [h.key, h.at]));
  const currentIndex = j.step ? TRACK_STEPS.findIndex((s) => s.key === j.step) : -1;

  return (
    <div className="space-y-4">
      <div className="surface p-5">
        <p className="text-2xs uppercase tracking-wider text-muted-foreground">หมายเลขงานซ่อม</p>
        <h1 className="num mt-0.5 text-xl font-semibold tracking-tight">{j.no}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4">
          {[
            ["ลูกค้า", j.customerMasked],
            ["เครื่อง", j.brandModel || "—"],
            ["S/N", j.deviceRef || "—"],
            ["วันที่รับเครื่อง", j.receivedDate || "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-2xs text-muted-foreground">{k}</dt>
              <dd className="truncate font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {j.cancelled ? (
        <div className="surface flex items-start gap-3 p-5">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <p className="font-semibold">รายการนี้ถูกยกเลิก</p>
            <p className="mt-0.5 text-sm text-muted-foreground">กรุณาติดต่อศูนย์บริการเพื่อสอบถามรายละเอียด</p>
          </div>
        </div>
      ) : (
        <div className="surface p-5">
          <p className="text-sm font-semibold">สถานะปัจจุบัน: <span className="text-primary">{j.stepLabel}</span></p>
          <ol className="mt-4 space-y-0">
            {TRACK_STEPS.map((s, i) => {
              const done = i < currentIndex;
              const now = i === currentIndex;
              const at = reached.get(s.key);
              return (
                <li key={s.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    {done ? (
                      <CircleCheck className="h-5 w-5 text-success" />
                    ) : now ? (
                      <CircleDot className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/40" />
                    )}
                    {i < TRACK_STEPS.length - 1 && (
                      <span className={cn("my-0.5 w-px flex-1", done ? "bg-success/40" : "bg-border")} />
                    )}
                  </div>
                  <div className={cn("pb-5", !done && !now && "opacity-55")}>
                    <p className={cn("text-sm font-medium", now && "text-primary")}>{s.label}</p>
                    <p className="text-xs text-muted-foreground">{s.hint}</p>
                    {at && <p className="num mt-0.5 text-2xs text-muted-foreground">{at}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* return shipment — courier logo + a link into the courier's own tracking page */}
          {j.trackingNo && (
            <div className="mt-1 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-10 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-border">
                  {j.courier?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={j.courier.logoUrl} alt={j.courier.name} className="max-h-8 max-w-[56px] object-contain" />
                  ) : (
                    <Truck className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{j.courier?.name || j.shipper || "การจัดส่งคืน"}</p>
                  <p className="num text-sm font-semibold tracking-tight">{j.trackingNo}</p>
                </div>
                {j.courier?.trackUrl && (
                  <a
                    href={j.courier.trackUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    ติดตามพัสดุ
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              {!j.courier?.trackUrl && (
                <p className="mt-2 text-xs text-muted-foreground">นำเลขพัสดุไปตรวจสอบที่เว็บไซต์ของบริษัทขนส่ง</p>
              )}
            </div>
          )}

          {(j.dueDate || j.closedDate) && (
            <dl className="mt-1 grid gap-2.5 border-t border-border pt-4 text-sm sm:grid-cols-3">
              {j.dueDate && !j.closedDate && (
                <div>
                  <dt className="text-2xs text-muted-foreground">วันที่คาดว่าจะเสร็จ</dt>
                  <dd className="num font-medium">{j.dueDate}</dd>
                </div>
              )}
              {j.closedDate && (
                <div>
                  <dt className="text-2xs text-muted-foreground">วันที่ปิดงาน</dt>
                  <dd className="num font-medium">{j.closedDate}</dd>
                </div>
              )}
              {j.shipper && !j.trackingNo && (
                <div>
                  <dt className="text-2xs text-muted-foreground">การส่งคืน</dt>
                  <dd className="font-medium">{j.shipper}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        สอบถามเพิ่มเติม ติดต่อศูนย์บริการตามเบอร์ด้านล่าง · หน้านี้อัปเดตอัตโนมัติทุกครั้งที่เปิด
      </p>
    </div>
  );
}
