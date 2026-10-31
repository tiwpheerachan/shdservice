'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { unpack } from '@/lib/obscure';

const subscribe = () => () => {};
/** false while the server renders (and while the browser hydrates that HTML), true after — no effect, no flash */
export const useHydrated = () =>
  React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/** <Email>'s browser half: the address only after hydration; until then an empty box of its width (no shift) */
export function EmailText({ code, size, className }: { code: string; size: number; className?: string }) {
  const hydrated = useHydrated();
  if (hydrated) return <span className={className}>{unpack(code)}</span>;
  return <span aria-hidden className={cn('invisible inline-block', className)} style={{ width: `${size}ch` }} />;
}
