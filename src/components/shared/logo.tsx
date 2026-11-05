import { cn } from '@/lib/utils';

/** Navy on light, white on dark. Size it with a height class (e.g. `h-9 w-auto`). */
export function Logo({
  className,
  variant,
}: {
  className?: string;
  /** force a single variant (for pages with a fixed background) */
  variant?: 'navy' | 'white';
}) {
  if (variant === 'white') {
    return <img src="/logo-dark.png" alt="OneService" className={className} />;
  }
  if (variant === 'navy') {
    return <img src="/logo.png" alt="OneService" className={className} />;
  }
  // theme = the `dark` class on <html> (manual toggle), so <picture media> cannot pick the file.
  // loading="lazy": a display:none image is never fetched, so only the visible variant downloads
  // (the other one loads on the first theme switch).
  return (
    <>
      <img src="/logo.png" alt="OneService" loading="lazy" className={cn('block dark:hidden', className)} />
      <img src="/logo-dark.png" alt="OneService" loading="lazy" className={cn('hidden dark:block', className)} />
    </>
  );
}
