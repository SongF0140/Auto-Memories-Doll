"use client";

import { useState, useCallback } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatPanel from "@/components/layout/ChatPanel";

const SIDEBAR_EXPANDED = 220;
const SIDEBAR_COLLAPSED = 64;

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const sidebarW = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main
        className="h-full overflow-hidden relative transition-[padding] duration-300"
        style={{ paddingLeft: sidebarW }}
      >
        <div className="relative z-10 h-full overflow-y-auto">
          {children}
        </div>
      </main>
      <ChatPanel />
    </div>
  );
}
