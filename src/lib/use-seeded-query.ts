import * as React from 'react';

/**
 * A picker's search box that opens holding the current choice: the trigger is a button, so its text can't be
 * selected to copy — the box can (select it on focus). The held text searches nothing until it is edited, so the
 * list opens as it would empty; typing over the selection replaces it.
 */
export function useSeededQuery() {
  const [q, setQ] = React.useState('');
  const [seed, setSeed] = React.useState('');
  return {
    q,
    setQ,
    /** what to search / filter by */
    query: q === seed ? '' : q,
    /** open with this text in the box */
    seed: (text: string) => {
      setQ(text);
      setSeed(text);
    },
  };
}
