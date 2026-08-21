"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MemoryListResponse } from "@/types/api";
import { MemoryRecord } from "@/types/memory";
import { requestApi } from "@/lib/api-client";

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function DashboardPage() {
  const router = useRouter();
  const [memoryData, setMemoryData] = useState<{ items: MemoryRecord[]; total: number } | null>(null);
  const [profileText, setProfileText] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [mem, pro] = await Promise.all([
          requestApi<MemoryListResponse>("/api/memory?sortBy=updatedAt&sortOrder=desc&pageSize=6"),
          fetchJson("/api/profile"),
        ]);
        setMemoryData({ items: mem.data.items, total: mem.data.total });
        setProfileText(pro.content || null);
        setDegraded(pro.degradedMode ?? false);
      } catch { /* ignore */ }
    }
    load();
  }, []);

  const memories = memoryData?.items || [];
  const totalMemories = memoryData?.total ?? 0;

  return (
    <div className="min-h-full">
      {/* Hero */}
      <div className="border-b border-border bg-surface/60">
        <div className="max-w-5xl mx-auto px-6 md:px-10 py-10 md:py-14">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm"
                  style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}>
                  <span className="text-[13px] font-extrabold">A</span>
                </div>
                <h1 className="text-xl md:text-2xl font-bold text-text-primary tracking-tight">
                  Auto-Memories-Doll
                </h1>
              </div>
              <p className="text-sm text-text-tertiary max-w-md">
                AI 记忆伴侣 — 自动整理对话知识，智能检索，静默纠偏
              </p>
              {degraded && (
                <p className="mt-3 text-[11px] text-error bg-error-bg border border-border rounded-lg px-3 py-1.5 inline-block">
                  AI 模型降级模式 | 部分智能功能暂不可用
                </p>
              )}
            </div>

            <div className="flex gap-4 md:gap-6">
              <div className="text-center">
                <p className="text-2xl md:text-3xl font-bold text-text-primary tabular-nums">{totalMemories}</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">条记忆</p>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <p className="text-2xl md:text-3xl font-bold text-text-primary">
                  {profileText ? <span className="text-success">&#10003;</span> : <span className="text-text-tertiary">&mdash;</span>}
                </p>
                <p className="text-[11px] text-text-tertiary mt-0.5">画像</p>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <button
                  onClick={() => router.push("/chat")}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-sm"
                  style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
                >
                  开始对话
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 space-y-8">
        {/* Recent Memories */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-text-primary">最近记忆</h2>
            <button
              onClick={() => router.push("/memory")}
              className="text-[12px] text-accent hover:text-accent-hover transition-colors"
            >
              查看全部 &rarr;
            </button>
          </div>

          {memories.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {memories.map((mem) => (
                <button
                  key={mem.id}
                  onClick={() => router.push(`/memory/${mem.id}`)}
                  className="group relative overflow-hidden rounded-xl glass p-4 text-left transition-all duration-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-[13px] font-semibold text-text-primary line-clamp-1 group-hover:text-accent transition-colors">
                      {mem.titleZh || mem.title}
                    </h3>
                    <span className="flex-shrink-0 text-[10px] text-text-tertiary bg-muted px-1.5 py-0.5 rounded-md">
                      {mem.topic}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
                    {mem.summaryZh || mem.summary}
                  </p>
                  {mem.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {(mem.tagsZh && mem.tagsZh.length > 0 ? mem.tagsZh : mem.tags).slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] text-accent bg-muted px-1.5 py-0.5 rounded-md">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 rounded-xl glass">
              <p className="text-4xl mb-3 opacity-40">&#x1F9E0;</p>
              <p className="text-sm text-text-tertiary mb-4">还没有记忆记录</p>
              <button
                onClick={() => router.push("/chat")}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
              >
                开始对话创建记忆 &rarr;
              </button>
            </div>
          )}
        </section>

        {/* Quick Nav Cards */}
        <section>
          <h2 className="text-[15px] font-semibold text-text-primary mb-4">功能区</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { icon: '\uD83D\uDCAC', label: '对话', desc: 'AI 记忆助手', href: '/chat' },
              { icon: '\uD83E\uDDE0', label: '记忆库', desc: '浏览与管理记忆', href: '/memory' },
              { icon: '\uD83D\uDC64', label: '画像', desc: '用户兴趣档案', href: '/profile' },
              { icon: '\uD83D\uDCCB', label: '审计', desc: '审核与冲突处理', href: '/audit' },
            ] as const).map((card) => (
              <button
                key={card.label}
                onClick={() => router.push(card.href)}
                className="glass rounded-xl p-4 text-left transition-all duration-200 hover:shadow-md"
              >
                <span className="text-xl mb-2 block">{card.icon}</span>
                <h3 className="text-[13px] font-semibold text-text-primary">{card.label}</h3>
                <p className="text-[11px] text-text-tertiary mt-0.5">{card.desc}</p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
