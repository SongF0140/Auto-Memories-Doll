"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

/* ── SVG Icons ───────────────────────────────────────────── */
const Icons = {
  home:      () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>,
  chat:      () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  memory:    () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  profile:   () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0113 0"/></svg>,
  settings:  () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  audit:     () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>,
  chevron:   () => <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>,
  search:    () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
};

type IconName = keyof typeof Icons;

/* ── Navigation Data ──────────────────────────────────────── */
interface NavItem { id: string; label: string; href: string; icon?: IconName; }
interface NavGroup { id: string; label: string; icon: IconName; items?: NavItem[]; href?: string; }

const navGroups: NavGroup[] = [
  { id: "dashboard", label: "概览", icon: "home", href: "/" },
  { id: "chat",     label: "对话", icon: "chat", href: "/chat" },
  {
    id: "memory", label: "记忆库", icon: "memory",
    items: [
      { id: "memory-list",   label: "全部记忆", href: "/memory" },
      { id: "memory-search", label: "搜索记忆", href: "/memory?mode=search" },
    ],
  },
  { id: "profile",  label: "画像", icon: "profile", href: "/profile" },
  {
    id: "settings", label: "设置", icon: "settings",
    items: [
      { id: "settings-ai",      label: "AI 模型",   href: "/settings/ai" },
      { id: "settings-storage", label: "存储路径",  href: "/settings/storage" },
      { id: "settings-tools",   label: "工具监听",  href: "/settings/tools" },
      { id: "settings-mcp",     label: "MCP 服务",  href: "/settings/mcp" },
      { id: "settings-skills",  label: "技能管理",  href: "/settings/skills" },
      { id: "settings-prompts", label: "提示词",    href: "/settings/prompts" },
    ],
  },
  { id: "audit",    label: "审计", icon: "audit", href: "/audit" },
];

/* ── Sidebar Component ────────────────────────────────────── */
interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set(expanded);
    for (const g of navGroups) {
      if (g.items?.some((i) => pathname.startsWith(i.href.split("?")[0]))) next.add(g.id);
    }
    setExpanded(next);
  }, [pathname]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  }, []);

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return pathname === base || (base !== "/" && pathname.startsWith(base + "/"));
  };

  const isGroupActive = (g: NavGroup) => {
    if (g.href && isActive(g.href)) return true;
    return !!(g.items?.some((i) => isActive(i.href)));
  };

  const W = collapsed ? 64 : 220;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="fixed top-4 z-[60] rounded-full p-2 glass shadow-sm text-text-tertiary hover:text-text-primary transition-all duration-300"
        style={{ left: collapsed ? 12 : W - 40 }}
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className="fixed left-0 top-0 z-50 flex h-screen flex-col glass transition-all duration-300"
        style={{ width: W }}
      >
        {/* Brand */}
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-3 px-4 py-5 border-b border-border hover:bg-muted transition-colors"
        >
          <div className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}>
            <span className="text-[11px] font-extrabold tracking-tight">A</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-[13px] font-bold text-text-primary tracking-tight truncate">Auto-Memories</h1>
              <p className="text-[10px] text-text-tertiary">AI 记忆伴侣</p>
            </div>
          )}
        </button>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {navGroups.map((group) => {
            const Icon = Icons[group.icon];
            const active = isGroupActive(group);
            return (
              <div key={group.id}>
                <button
                  onClick={() => {
                    if (group.href) router.push(group.href);
                    if (group.items) toggle(group.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group relative ${
                    active
                      ? "bg-muted text-accent font-medium"
                      : "text-text-tertiary hover:text-text-primary hover:bg-muted/50"
                  }`}
                  title={collapsed ? group.label : undefined}
                >
                  <span className="flex-shrink-0">{Icon()}</span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left text-[13px]">{group.label}</span>
                      {group.items && (
                        <span className={`text-[9px] text-text-tertiary transition-transform duration-200 ${expanded.has(group.id) ? "rotate-90" : ""}`}>
                          <Icons.chevron />
                        </span>
                      )}
                    </>
                  )}
                </button>

                {/* Sub-items */}
                {group.items && expanded.has(group.id) && !collapsed && (
                  <div className="ml-5 mt-0.5 mb-1 space-y-0.5 border-l border-border pl-3">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => router.push(item.href)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all duration-150 ${
                          isActive(item.href)
                            ? "bg-muted text-accent font-semibold"
                            : "text-text-tertiary hover:text-text-secondary hover:bg-muted/40"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <p className="text-[10px] text-text-tertiary text-center">
            {collapsed ? "v1" : "v1.0 · Auto-Memories-Doll"}
          </p>
        </div>
      </aside>
    </>
  );
}
