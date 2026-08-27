"use client";

import TopNavbar from "@/components/common/TopNavbar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--background-warm)" }}
    >
      {/* 顶部导航栏 */}
      <TopNavbar />

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
