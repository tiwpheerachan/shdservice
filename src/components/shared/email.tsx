import { pack } from '@/lib/obscure';
import { EmailText } from './email-text';

/**
 * An e-mail address on any page or print: never in the server HTML (Cloudflare Email Address Obfuscation — see
 * src/lib/obscure.ts). Usable from a server component too: the address crosses to the browser packed, and shows
 * once the page has hydrated (prints print after that — AutoPrint waits for it).
 */
export function Email({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return <EmailText code={pack(value)} size={[...value].length} className={className} />;
}

/** an e-mail address anywhere in a text (an audit line's key / summary: "owner · owner@x.co.th") */
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** text that may hold e-mail addresses: the rest as it is, each address as <Email> (never in the server HTML) */
export function WithEmails({ text }: { text?: string | null }) {
  if (!text) return null;
  const parts = text.split(new RegExp(`(${ADDRESS.source})`, 'g'));
  return parts.map((p, i) => (i % 2 ? <Email key={i} value={p} /> : p));
}
