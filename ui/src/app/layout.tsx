import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { BASE_PATH, SITE_URL } from "@/lib/site";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Inter Tight, self-hosted (SIL OFL 1.1, see ./fonts/OFL.txt). Vellure's
 * typeface is Neue Montreal, a commercial font; Inter Tight is the closest
 * free match (verified side-by-side, same 500-weight/-0.02em heading
 * treatment). The variable font covers weights 100-900 in one 45KB file,
 * and self-hosting keeps the app free of external font dependencies.
 */
const interTight = localFont({
  src: "./fonts/inter-tight-latin.woff2",
  variable: "--font-inter-tight",
  weight: "100 900",
  display: "swap",
});

const TITLE = "SpendGuard: scoped session-key vault for tUSD8 on Aevum";
const DESCRIPTION =
  "Give an agent a key that can only spend a little, only to approved merchants, only until Friday. Take it back in one click. A scoped session-key vault for tUSD8 on the QDay Aevum testnet.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "session keys",
    "scoped keys",
    "tUSD8",
    "Aevum",
    "QDay",
    "smart contract vault",
    "AI agents",
    "spending caps",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "SpendGuard",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "SpendGuard. Give an agent a key that can only spend a little.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/og-image.png`],
  },
  icons: {
    icon: [
      { url: `${BASE_PATH}/favicon.svg`, type: "image/svg+xml" },
      { url: `${BASE_PATH}/favicon-32.png`, sizes: "32x32", type: "image/png" },
    ],
    apple: `${BASE_PATH}/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: "SpendGuard",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // No themeColor here: the single theme-color meta in <head> is kept in
  // step with the app theme by the init script and the toggle. A
  // media-query pair would follow the OS preference, not the user's
  // in-app choice.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={interTight.variable}>
      <head>
        {/* Single theme-color meta, before the init script so the script can
            sync it before first paint. */}
        <meta name="theme-color" content="#ffffff" />
        {/* Resolve the theme before first paint: no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="manifest" href={`${BASE_PATH}/manifest.webmanifest`} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
