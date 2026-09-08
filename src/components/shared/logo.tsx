import * as React from "react";

/**
 * OneService wordmark — inline SVG, transparent background, theme-aware.
 * "One" uses currentColor (inherits text color), "Service" uses the brand
 * gradient, and the mark is a gradient rounded square with a check.
 */
export function Logo({
  className,
  showMark = true,
  title = "OneService",
}: {
  className?: string;
  showMark?: boolean;
  title?: string;
}) {
  const gid = React.useId();
  return (
    <svg
      viewBox={showMark ? "0 0 210 44" : "44 0 166 44"}
      role="img"
      aria-label={title}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#43a6f8" />
          <stop offset="1" stopColor="#55d5a1" />
        </linearGradient>
      </defs>

      {showMark && (
        <>
          <rect x="2" y="6" width="32" height="32" rx="9.5" fill={`url(#${gid})`} />
          <path
            d="M11 22.5 l5 5 l9.5 -11.5"
            stroke="#fff"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      <text
        x="44"
        y="30"
        fontFamily="'Inter','IBM Plex Sans Thai',system-ui,sans-serif"
        fontSize="26"
        fontWeight="800"
        letterSpacing="-0.5"
      >
        <tspan fill="currentColor">One</tspan>
        <tspan fill={`url(#${gid})`}>Service</tspan>
      </text>
    </svg>
  );
}
