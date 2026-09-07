"use client";

import { Eye, Pencil, Ban, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors";

export function RowActions({
  onView,
  onEdit,
  onCancel,
  onDelete,
}: {
  onView?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {onView && (
        <button onClick={onView} title="ดูรายละเอียด" className={cn(BTN, "hover:bg-primary-soft hover:text-primary")}>
          <Eye className="h-3.5 w-3.5" />
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit} title="แก้ไข" className={cn(BTN, "hover:bg-info-soft hover:text-info")}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onCancel && (
        <button onClick={onCancel} title="ยกเลิก" className={cn(BTN, "hover:bg-warning-soft hover:text-warning")}>
          <Ban className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} title="ลบ" className={cn(BTN, "hover:bg-danger-soft hover:text-danger")}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
