import type { Metadata } from "next";
import { KeysPage } from "@/components/app/Pages";

export const metadata: Metadata = {
  title: "SpendGuard app: access keys",
  alternates: { canonical: "/app/keys/" },
};

export default function Page() {
  return <KeysPage />;
}
