import * as React from "react";
import type { Column } from "@/components/ui/data-table";

/**
 * Columns that several tables share — one definition so their width rules stay the same everywhere.
 */

/** minimum widths for the text columns people read — the auto table layout squeezes whatever has none */
export const COL_MIN_WIDTH = { customer: "160px", brandModel: "180px", status: "140px" } as const;

/** "ยี่ห้อ, รุ่น" — long model names ("Dreame Robot Vacuum X10") keep to 1–2 lines */
export function brandModelColumn<T extends { brandModel?: string }>(): Column<T> {
  return { key: "brandModel", header: "ยี่ห้อ, รุ่น", hideBelow: "md", minWidth: COL_MIN_WIDTH.brandModel };
}

/** "2026-09-22 15:27" in a narrow column: may break before the time, never inside the date */
export function DateTimeCell({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const [d, ...t] = value.split(" ");
  return (
    <span className="num text-xs">
      <span className="whitespace-nowrap">{d}</span>
      {t.length > 0 && ` ${t.join(" ")}`}
    </span>
  );
}
