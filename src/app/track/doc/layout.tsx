import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "เอกสารงานซ่อม",
  robots: { index: false, follow: false },
};

/** Customer document (print view) — same A4 sheet as the staff print pages, without their login. */
export default function TrackDocLayout({ children }: { children: React.ReactNode }) {
  return <div className="print-root min-h-screen bg-neutral-200 py-6 text-black print:bg-white print:py-0">{children}</div>;
}
