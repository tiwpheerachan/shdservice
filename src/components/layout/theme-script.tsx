'use client';

import * as React from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { THEME_SCRIPT } from '@/lib/theme-script-source';

/**
 * The theme bootstrap goes into the server HTML only (useServerInsertedHTML — Next's hook for
 * render-time <head> content), never through React on the client. Rendered as an element, a 404
 * from a print view (error shell, then the whole document is client-rendered) made React create the
 * <script> on the client: "Encountered a script tag while rendering React component" — and it would
 * not run there anyway. Same text, so the /track CSP hash (src/proxy.ts) still matches.
 */
export function ThemeScript() {
  const sent = React.useRef(false);
  useServerInsertedHTML(() => {
    if (sent.current) return null; // called on every streamed flush — the first one is in <head>
    sent.current = true;
    return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
  });
  return null;
}
