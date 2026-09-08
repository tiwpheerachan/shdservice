import * as React from "react";

/**
 * Split auth layout — form/content on the left, brand hero on the right.
 * Adapted for OneService: SSO-only (no email/password), brand colours, and a
 * graceful gradient behind the hero image so it never looks broken.
 */
export function AuthSplit({
  children,
  heroImageSrc,
  overlayCard,
  fit = "cover",
}: {
  children: React.ReactNode;
  heroImageSrc?: string;
  overlayCard?: React.ReactNode;
  /** "contain" shows a full designed poster without cropping */
  fit?: "cover" | "contain";
}) {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col md:flex-row">
      <section className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </section>

      <section className="relative hidden flex-1 md:block">
        <div
          className="animate-slide-right absolute inset-0 bg-center bg-no-repeat"
          style={{
            backgroundImage: heroImageSrc
              ? `url(${heroImageSrc})`
              : "linear-gradient(135deg,#43a6f8,#55d5a1)",
            backgroundSize: fit,
            backgroundColor: "#fafafa",
          }}
        >
          {overlayCard && (
            <div className="absolute inset-x-6 bottom-6 flex justify-center">
              {overlayCard}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Small frosted card for the hero panel. */
export function HeroCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-element animate-delay-500 w-full max-w-sm rounded-3xl border border-white/20 bg-white/10 p-5 text-white backdrop-blur-xl">
      {children}
    </div>
  );
}
