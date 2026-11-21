"use client";

import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { DemoModal } from "@/components/DemoModal";
import {
  About,
  Bento,
  Capabilities,
  CtaBanner,
  DevelopersSection,
  Faq,
  Footer,
  HowItWorks,
  RoleTabs,
  SetupGuide,
  StatStrip,
  VerifySection,
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
        <HowItWorks />
        <Capabilities />
        <VerifySection />
        <DevelopersSection />
        <Bento />
        <RoleTabs />
        <SetupGuide />
        <Faq />
        <CtaBanner onWatchDemo={() => setDemoOpen(true)} />
      </main>
      <Footer />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </>
  );
}
