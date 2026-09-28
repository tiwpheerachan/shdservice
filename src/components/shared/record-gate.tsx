"use client";

import * as React from "react";
import { FileSearch, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The edit / workflow screens that start with "ระบุหมายเลข…": until a record is loaded the form and
 * its save bar are hidden and one of these shows instead —
 *  - nothing loaded yet → a card that points at the search box (its button focuses / opens it)
 *  - loading → a skeleton in the form's place
 *  - lookup failed → the error, with a button to search again
 *
 * The form stays mounted (only hidden) so its state and effects behave exactly as when visible.
 */
export function RecordGate({
  ready,
  loading,
  error,
  noun,
  searchId,
  children,
}: {
  /** a record is loaded — show the form */
  ready: boolean;
  loading?: boolean;
  error?: string | null;
  /** what is looked up: "งาน" / "ใบเสนอราคา" / "ใบสั่งขาย" */
  noun: string;
  /** id of the page's search control (JobSearch trigger / lookup input) */
  searchId: string;
  children: React.ReactNode;
}) {
  const focusSearch = () => {
    const el = document.getElementById(searchId);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    if (el instanceof HTMLButtonElement) el.click(); // JobSearch: open its list
    else if (el instanceof HTMLInputElement) el.select();
  };

  return (
    <>
      {!ready &&
        (loading ? (
          <div role="status" aria-label={`กำลังเรียกข้อมูล${noun}`} className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface space-y-4 p-4">
                <Skeleton className="h-4 w-40" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }, (_, j) => (
                    <div key={j} className="space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface flex flex-col items-center gap-3 px-4 py-14 text-center">
            <div className={`grid h-12 w-12 place-items-center rounded-full ${error ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary"}`}>
              {error ? <SearchX className="h-6 w-6" aria-hidden /> : <FileSearch className="h-6 w-6" aria-hidden />}
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{error ? `เรียกข้อมูล${noun}ไม่สำเร็จ` : `ระบุหมายเลข${noun}เพื่อเรียกข้อมูล`}</h2>
              <p className="max-w-md text-sm text-muted-foreground" role={error ? "alert" : undefined}>
                {error ?? `ค้นหาหรือพิมพ์หมายเลข${noun}ในช่องด้านบน ข้อมูลและปุ่มบันทึกจะแสดงเมื่อเรียกข้อมูลสำเร็จ`}
              </p>
            </div>
            <Button variant={error ? "outline" : "primary"} size="md" type="button" onClick={focusSearch}>
              {error ? "ค้นหาใหม่" : `ค้นหา${noun}`}
            </Button>
          </div>
        ))}
      <div hidden={!ready} className="space-y-4">
        {children}
      </div>
    </>
  );
}
