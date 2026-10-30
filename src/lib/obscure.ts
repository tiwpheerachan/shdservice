/**
 * E-mail addresses never go into the server HTML: Cloudflare's Email Address Obfuscation (kept ON) rewrites any
 * address it finds there into a "[email protected]" link plus a decode script our nonce CSP blocks — a hydration error
 * (#418) and "[email protected]" on paper. A value that crosses the server → browser boundary (a client component's
 * props, the prefetched answers) goes as base64 (no "@" in its alphabet) and is read back in the browser.
 * Same code on the server and in the browser (TextEncoder / btoa / atob are in both).
 */
export function pack(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function unpack(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}
