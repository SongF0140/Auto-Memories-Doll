"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavTab {
  id: string;
  label: string;
  href: string;
}

const navTabs: NavTab[] = [
  { id: "home", label: "首页", href: "/" },
  { id: "library", label: "检索库", href: "/memory" },
  { id: "settings", label: "设置", href: "/settings/ai" },
];

export default function TopNavbar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between h-14 px-8 nav-dark">
      {/* 左侧：Logo + 系统名称 */}
      <Link href="/" className="flex items-center gap-2.5 group">
        {/* 循环标志 Logo：暗金色 */}
        <div
          className="w-7 h-7 animate-logo-morph flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #A67C00, #C9A227)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8L8 3L13 8L8 13Z" fill="white" opacity="0.95" />
          </svg>
        </div>
        <span className="text-base font-bold tracking-tight text-[#F5F0E8] group-hover:text-[#D4B84A] transition-colors duration-200">
          记忆中枢
        </span>
      </Link>

      {/* 右侧：导航 Tab 列表 */}
      <nav className="flex items-center gap-1">
        {navTabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                active
                  ? "text-[#D4B84A] bg-white/10"
                  : "text-[rgba(245,240,232,0.65)] hover:text-[#F5F0E8] hover:bg-white/5"
              }`}
            >
              {tab.label}
              {active && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-[#C9A227]"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
