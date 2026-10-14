import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/layout/theme-script";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm";

// Self-hosted at build time (next/font): no request to fonts.googleapis.com on
// every page load and no render-blocking external stylesheet. Exposed as CSS
// variables that globals.css folds into --font-sans.
// Noto Sans Thai only: it carries Latin too and comes first in --font-sans, so Inter never drew
// a glyph — it was 7 files (48 KB preloaded) for nothing. No `weight`: it is a variable font, one
// file per subset covers 400–700 (all four are used: font-medium/semibold/bold, <th>).
const notoThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-noto-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "OneService",
    template: "%s · OneService",
  },
  description: "ระบบบริหารงานบริการและงานซ่อม — OneService by SHD Technology",
  // internal staff system: nothing here is meant for search engines
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={notoThai.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
