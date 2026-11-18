import { useId } from "react";

/**
 * SpendGuard mark: a shield holding a session key. The key's teeth are three
 * ascending steps, the three bounds every session carries: per-transaction
 * cap, total spend cap, expiry. The artwork here is the same as
 * public/brand/logo-mark.svg; keep the two in sync (see BRANDING.md).
 */
export function LogoMark({ size = 34 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gid = `sg-mark-${id}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="SpendGuard logo"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2384FF" />
          <stop offset=".5" stopColor="#0346FF" />
          <stop offset="1" stopColor="#002C90" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gid})`}
        d="M32 4C38 4 46 7 52 10.5 53.2 11.1 54 12.2 54 13.5V30C54 44.5 45 55 33.8 59.6 32.6 60.1 31.4 60.1 30.2 59.6 19 55 10 44.5 10 30V13.5C10 12.2 10.8 11.1 12 10.5 18 7 26 4 32 4Z"
      />
      <g fill="#fff">
        <path
          fillRule="evenodd"
          d="M30 13.5a7.5 7.5 0 1 0 .001 0M30 17.2a3.8 3.8 0 1 1-.001 0Z"
        />
        <rect x="28.2" y="27" width="3.6" height="20.5" rx="1.8" />
        <rect x="31.8" y="34" width="5.5" height="3.5" rx="1.2" />
        <rect x="31.8" y="39" width="8.5" height="3.5" rx="1.2" />
        <rect x="31.8" y="44" width="11.5" height="3.5" rx="1.2" />
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
