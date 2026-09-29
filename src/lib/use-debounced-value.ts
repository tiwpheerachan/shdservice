"use client";

import * as React from "react";

/** `value`, but only after it has stopped changing for `ms` — for search-as-you-type */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
