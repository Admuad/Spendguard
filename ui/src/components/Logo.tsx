/**
 * SpendGuard mark: a white keyhole in a flat accent rounded square. The
 * square is the vault; the keyhole is the session key: one opening, shaped
 * by the bounds. One flat color, no gradient, drawn to survive 16px. The
 * artwork here is the same as public/brand/logo-mark.svg and
 * public/favicon.svg; keep all three in sync (see BRANDING.md).
 */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="SpendGuard logo"
    >
      <rect x="6" y="6" width="52" height="52" rx="15" fill="#0346FF" />
      <g fill="#fff">
        <circle cx="32" cy="25" r="8.5" />
        <path d="M27.5 28H36.5L40 43.5Q40.4 47 36.6 47H27.4Q23.6 47 24 43.5Z" />
      </g>
    </svg>
  );
}

/** Mark plus wordmark, for the navbar and footer. The wordmark is live text
 * in the brand font, never baked into an image, so it stays crisp. */
export function LogoLockup({ size = 34 }: { size?: number }) {
  return (
    <>
      <LogoMark size={size} />
      <span className="logo-wordmark">SpendGuard</span>
    </>
  );
}
