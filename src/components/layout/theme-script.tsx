'use client';

import * as React from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { THEME_SCRIPT } from '@/lib/theme-script-source';

/**
 * Server HTML only (useServerInsertedHTML), never rendered by React on the client: a client-rendered 404 shell made
 * React create the <script> ("Encountered a script tag…") and it would not run there anyway. Keep the text as is:
 * the /track CSP hash (src/proxy.ts) matches it.
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
