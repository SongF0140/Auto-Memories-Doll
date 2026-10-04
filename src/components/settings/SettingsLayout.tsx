"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SettingsTab {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const settingsTabs: SettingsTab[] = [
  {
    id: "ai",
    label: "AI 模型",
    href: "/settings/ai",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "skills",
    label: "技能配置",
    href: "/settings/skills",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: "prompts",
    label: "提示词模板",
    href: "/settings/prompts",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "mcp",
    label: "MCP 服务",
    href: "/settings/mcp",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
  },
  {
    id: "storage",
    label: "存储路径",
    href: "/settings/storage",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "tools",
    label: "工具监听",
    href: "/settings/tools",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4L15 12l-3-3 2.7-2.7Z" />
        <path d="m16 4 4 4" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "人物画像",
    href: "/settings/profile",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col lg:flex-row">
      {/* 窄屏：顶部横向可滚动导航；宽屏：左侧固定侧栏（路由不变，仅布局切换） */}
      <aside
        className="shrink-0 border-b lg:border-b-0 lg:border-r lg:w-64 overflow-y-auto"
        style={{
          background: "var(--color-bg-secondary)",
          borderColor: "var(--color-border-default)",
        }}
      >
        <div className="px-4 pt-4 lg:px-6 lg:pt-6 lg:pb-0 pb-3">
          <h2 className="text-lg font-bold text-[#3E3224] mb-1 font-mono">系统设置</h2>
          <p className="text-xs text-[#B8AE9A] hidden lg:block">配置 AI 模型、技能和个性化选项</p>
        </div>

        {/* 窄屏横向滚动（隐藏滚动条但保留键盘/触摸滚动），宽屏纵向列表 */}
        <nav
          className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible px-3 pb-3 lg:pb-6 pt-1 lg:pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="设置导航"
        >
          {settingsTabs.map((tab) => {
            const isActive =
              pathname === tab.href ||
              (tab.href !== "/settings/ai" && pathname.startsWith(tab.href));

            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? "bg-[#A67C00] text-white shadow-md"
                    : "text-[#5D4E37] hover:bg-[#F0EBE1]"
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
