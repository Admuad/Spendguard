"use client";

import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { DemoModal } from "@/components/DemoModal";
import { VaultApp } from "@/components/VaultApp";
import {
  About,
  Bento,
  Capabilities,
  CtaBanner,
  Faq,
  Footer,
  HowItWorks,
  RoleTabs,
  SetupGuide,
  StatStrip,
  StatsBand,
} from "@/components/Sections";
import { useVaultData } from "@/lib/useVaultData";

export default function Home() {
  const vault = useVaultData();
  const [demoOpen, setDemoOpen] = useState(false);

  return (
    <>
      <Navbar />
      <main>
        <Hero vault={vault} onWatchDemo={() => setDemoOpen(true)} />
        <StatStrip vault={vault} />
        <About />
        <Capabilities />
        <RoleTabs />
        <StatsBand />
        <Bento />
        <SetupGuide />
        <VaultApp vault={vault} />
        <HowItWorks />
        <Faq />
        <CtaBanner onWatchDemo={() => setDemoOpen(true)} />
      </main>
      <Footer />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </>
  );
}
