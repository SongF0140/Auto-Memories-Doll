"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import MemoryCard from "@/components/memory/MemoryCard";
import Markdown from "@/components/common/Markdown";
import {
  getMemoryClient,
  memoryDetailHref,
  recordMemoryAccessClient,
} from "@/lib/memory-api-client";
import type { MemoryRecord } from "@/types/memory";

export default function MemoryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const memoryId = params.id;
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMemory() {
      setLoading(true);
      setError("");

      try {
        const loadedMemory = await getMemoryClient(memoryId, controller.signal);
        setMemory(loadedMemory);
        void recordMemoryAccessClient(memoryId).catch(() => {
          // 访问计数失败不应阻断详情阅读。
        });
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "记忆加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMemory();
    return () => controller.abort();
  }, [memoryId]);

  const handleDelete = useCallback(async () => {
    if (!memory || !confirm(`确定要删除“${memory.titleZh || memory.title}”吗？`)) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(memory.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`删除失败 (${response.status})`);
      router.push("/memory");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }, [memory, router]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="text-center">
          <div className="loading-dots mb-4">
            <span />
            <span />
            <span />
          </div>
          <p className="text-sm text-text-secondary">正在加载记忆...</p>
        </div>
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="card max-w-md text-center">
          <h1 className="text-2xl font-bold">记忆不存在</h1>
          <p className="mt-3 text-sm text-text-secondary">{error || "没有找到对应的记忆内容。"}</p>
          <Link href="/memory" className="btn mt-6">
            返回检索库
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-6 text-sm font-mono text-text-tertiary" aria-label="面包屑">
          <Link href="/" className="transition-colors hover:text-accent">
            首页
          </Link>
          <span className="mx-2">/</span>
          <Link href="/memory" className="transition-colors hover:text-accent">
            检索库
          </Link>
          <span className="mx-2">/</span>
          <span className="text-text-primary">记忆详情</span>
        </nav>

        {error ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-error/20 bg-error-bg px-4 py-3 text-sm text-error"
          >
            {error}
          </div>
        ) : null}

        <MemoryCard memory={memory} />

        <section className="card mt-6" aria-labelledby="memory-content-title">
          <h2 id="memory-content-title" className="font-mono text-lg font-bold">
            完整内容
          </h2>
          <Markdown
            className="mt-4 text-base text-text-secondary"
            content={memory.content || memory.summaryZh || memory.summary || "（暂无详细内容）"}
          />
        </section>

        <section className="card mt-6" aria-labelledby="memory-meta-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="memory-meta-title" className="font-mono text-lg font-bold">
                记录信息
              </h2>
              <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-text-tertiary">记忆 ID</dt>
                  <dd className="mt-1 break-all font-mono text-text-primary">{memory.id}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary">来源</dt>
                  <dd className="mt-1 text-text-primary">{memory.source}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary">创建时间</dt>
                  <dd className="mt-1 text-text-primary">
                    {new Date(memory.createdAt).toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-tertiary">最后更新</dt>
                  <dd className="mt-1 text-text-primary">
                    {new Date(memory.updatedAt).toLocaleString("zh-CN")}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-danger"
            >
              {deleting ? "删除中..." : "删除记忆"}
            </button>
          </div>

          {memory.graphLinks.length > 0 ? (
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-medium text-text-secondary">关联记忆</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {memory.graphLinks.map((linkedId) => (
                  <Link
                    key={linkedId}
                    href={memoryDetailHref(linkedId)}
                    className="tag hover:border-accent hover:text-accent"
                  >
                    {linkedId}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
