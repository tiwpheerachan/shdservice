import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("surface", className)} {...props} />;
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  icon: Icon,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { icon?: React.ElementType }) {
  return (
    <h3
      className={cn(
        "flex items-center gap-2 text-sm font-semibold tracking-tight",
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 text-primary" />}
      {children}
    </h3>
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-3",
        className
      )}
      {...props}
    />
  );
}
