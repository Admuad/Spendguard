import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { VaultApp } from "@/components/VaultApp";
import { Footer } from "@/components/Sections";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "SpendGuard app: manage your vault",
  description:
    "Deposit tUSD8, grant bounded session keys, pay within caps, and revoke in one click. Live on the QDay Aevum testnet.",
  alternates: { canonical: "/app/" },
  openGraph: {
    title: "SpendGuard app: manage your vault",
    description:
      "Deposit tUSD8, grant bounded session keys, pay within caps, and revoke in one click. Live on the QDay Aevum testnet.",
    url: `${SITE_URL}/app/`,
  },
};

export default function AppPage() {
  return (
    <>
      <Navbar />
      <main>
        <VaultApp />
      </main>
      <Footer />
    </>
  );
}
