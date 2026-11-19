import type { Metadata } from "next";
import { Overview } from "@/components/app/Overview";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "SpendGuard app: overview",
  description:
    "Your vault at a glance: balance, what keys can still spend, live usage per key, and recent activity. Live on the QDay Aevum testnet.",
  alternates: { canonical: "/app/" },
  openGraph: { title: "SpendGuard app", url: `${SITE_URL}/app/` },
};

export default function AppOverviewPage() {
  return <Overview />;
}
