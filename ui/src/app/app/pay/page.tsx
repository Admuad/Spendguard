import type { Metadata } from "next";
import { PayPage } from "@/components/app/Pages";

export const metadata: Metadata = {
  title: "SpendGuard app: pay as a key",
  alternates: { canonical: "/app/pay/" },
};

export default function Page() {
  return <PayPage />;
}
