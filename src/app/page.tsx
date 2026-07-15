"use client";

import { useState } from "react";
import Navbar from "../components/common/Navbar";
import ChatInterface from "../components/chat/ChatInterface";
import MemoryList from "../components/memory/MemoryList";
import MemorySearch from "../components/memory/MemorySearch";
import PromptList from "../components/prompt/PromptList";

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
      default:
        return <ChatInterface />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
}
