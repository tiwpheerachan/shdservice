import { cn } from "@/lib/utils";

/** Loading placeholder that keeps the final element's footprint (no layout shift). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
