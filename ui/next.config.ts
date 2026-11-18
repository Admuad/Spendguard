import type { NextConfig } from "next";

/**
 * GitHub Pages project-site deployment (DEPLOY_TARGET=github-pages): a
 * static export served under /Spendguard. Local dev and `next start` keep
 * the default server build with no base path. The Pages build also sets
 * NEXT_PUBLIC_BASE_PATH=/Spendguard so metadata icon/manifest links match
 * (see src/lib/site.ts and ui/README.md).
 */
const isGhPages = process.env.DEPLOY_TARGET === "github-pages";

const nextConfig: NextConfig = isGhPages
  ? { output: "export", basePath: "/Spendguard", trailingSlash: true }
  : {};

export default nextConfig;
