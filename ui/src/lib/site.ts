/**
 * Canonical public URL of the deployed site. Overridable at build time via
 * NEXT_PUBLIC_SITE_URL; defaults to the GitHub Pages home so link previews
 * and canonical tags always point at the live site, even from local builds.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://admuad.github.io/Spendguard";

/**
 * Path prefix when the site is served under a subpath (GitHub Pages project
 * site). Empty for local dev and root deployments. Set to "/Spendguard" for
 * the Pages build (see next.config.ts and ui/README.md).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
