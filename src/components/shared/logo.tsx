import { cn } from "@/lib/utils";

/**
 * The real "one service" wordmark — transparent PNG, two variants that swap by
 * theme: navy on light, white on dark. The blue→green check is preserved in both.
 * Set the size with a height class (e.g. `h-9 w-auto`).
 */
export function Logo({
  className,
  variant,
}: {
  className?: string;
  /** force a single variant (for pages with a fixed background) */
  variant?: "navy" | "white";
}) {
  if (variant === "white") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo-dark.png" alt="OneService" className={className} />;
  }
  if (variant === "navy") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo.png" alt="OneService" className={className} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="OneService" className={cn("block dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="OneService" className={cn("hidden dark:block", className)} />
    </>
  );
}
