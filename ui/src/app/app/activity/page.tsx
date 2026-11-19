import type { Metadata } from "next";
import { ActivityPage } from "@/components/app/Pages";

export const metadata: Metadata = {
  title: "SpendGuard app: activity",
  alternates: { canonical: "/app/activity/" },
};

export default function Page() {
  return <ActivityPage />;
}
