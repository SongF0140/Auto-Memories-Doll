"use client";

import { useState } from "react";
import Navbar from "../components/common/Navbar";
import { AuroraBackground } from "../components/ui/aurora-background";
import { AnimatedGridPattern } from "../components/ui/animated-grid-pattern";
import ChatInterface from "../components/chat/ChatInterface";
import MemoryList from "../components/memory/MemoryList";
import MemorySearch from "../components/memory/MemorySearch";
import PromptList from "../components/prompt/PromptList";
import SettingsPanel from "../components/settings/SettingsPanel";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("chat");

  const renderContent = () => {
    switch (activeTab) {
      case "chat":
        return <ChatInterface />;
      case "memory":
        return <MemoryList />;
      case "search":
        return <MemorySearch />;
      case "prompt":
        return <PromptList />;
      case "settings":
        return <SettingsPanel />;
      default:
        return <ChatInterface />;
    }
  };

  return (
    <AuroraBackground>
      <AnimatedGridPattern />
      <div className="pointer-events-none absolute inset-x-0 top-20 h-64 bg-[radial-gradient(ellipse_at_top,rgba(142,113,166,0.18),transparent_62%)]" />
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="relative z-10 flex-1 flex flex-col overflow-hidden" key={activeTab}>
        {renderContent()}
      </main>
    </AuroraBackground>
  );
}
