import type { Metadata } from "next";
import { SettingsPage } from "@/components/app/Pages";

export const metadata: Metadata = {
  title: "SpendGuard app: settings",
  alternates: { canonical: "/app/settings/" },
};

export default function Page() {
  return <SettingsPage />;
}
