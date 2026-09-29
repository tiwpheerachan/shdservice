"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, Pencil, Ban, Trash2, History } from "lucide-react";
import { cn } from "@/lib/utils";

const BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors";

/**
 * The icon buttons of a table row. Going to another page = a link (`viewHref` / `editHref`):
 * client-side navigation, and Ctrl/⌘-click or middle-click opens it in a new tab. Actions that
 * stay on the page (a modal, a confirm) take a callback.
 */
export function RowActions({
  onView,
  viewHref,
  onEdit,
  editHref,
  onCancel,
  onDelete,
  onHistory,
}: {
  onView?: () => void;
  viewHref?: string;
  onEdit?: () => void;
  editHref?: string;
  onCancel?: () => void;
  onDelete?: () => void;
  /** e.g. ประวัติงานซ่อมของลูกค้า */
  onHistory?: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <Action href={viewHref} onClick={onView} label="ดูรายละเอียด" className="hover:bg-primary-soft hover:text-primary">
        <Eye className="h-3.5 w-3.5" />
      </Action>
      <Action href={editHref} onClick={onEdit} label="แก้ไข" className="hover:bg-info-soft hover:text-info">
        <Pencil className="h-3.5 w-3.5" />
      </Action>
      <Action onClick={onHistory} label="ประวัติงานซ่อม" className="hover:bg-accent hover:text-foreground">
        <History className="h-3.5 w-3.5" />
      </Action>
      <Action onClick={onCancel} label="ยกเลิก" className="hover:bg-warning-soft hover:text-warning">
        <Ban className="h-3.5 w-3.5" />
      </Action>
      <Action onClick={onDelete} label="ลบ" className="hover:bg-danger-soft hover:text-danger">
        <Trash2 className="h-3.5 w-3.5" />
      </Action>
    </div>
  );
}

function Action({
  href,
  onClick,
  label,
  className,
  children,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  className: string;
  children: React.ReactNode;
}) {
  if (href)
    return (
      // no prefetch: a page of 25 rows would fetch 50 screens nobody opens
      <Link href={href} prefetch={false} title={label} aria-label={label} className={cn(BTN, className)}>
        {children}
      </Link>
    );
  if (!onClick) return null;
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={cn(BTN, className)}>
      {children}
    </button>
  );
}
