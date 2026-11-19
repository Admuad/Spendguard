import type { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Sections";
import { AppProvider } from "@/components/app/AppProvider";
import { AppShell } from "@/components/app/AppShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <main>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </main>
      <Footer />
    </>
  );
}
