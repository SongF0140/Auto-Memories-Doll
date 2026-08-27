"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MemoryMapViewport from "@/components/memory/MemoryMapViewport";
import { listMemoriesClient, memoryTopicHref } from "@/lib/memory-api-client";
import type { KnowledgeNode } from "@/components/memory/KnowledgeMap";
import type { MemoryRecord } from "@/types/memory";

export default function MemoryMapPage() {
  const router = useRouter();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    listMemoriesClient(100)
      .then((data) => {
        if (!cancelled) setMemories(data.items);
      })
      .catch((loadError) => {
        if (!cancelled)
          setError(loadError instanceof Error ? loadError.message : "知识图谱加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleNodeClick = (node: KnowledgeNode) => {
    router.push(memoryTopicHref(node.id));
  };

  return (
    <div className="relative h-[calc(100vh-56px)] min-h-[620px] overflow-hidden bg-background-warm">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-white/80 px-5 py-4 backdrop-blur-sm sm:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-tertiary">
            Memory Map
          </p>
          <h1 className="mt-1 font-mono text-xl font-bold text-text-primary">知识图谱</h1>
        </div>
        <Link href="/memory" className="btn-secondary">
          返回检索库
        </Link>
      </header>

      <div className="absolute inset-0 pt-[76px]">
        <MemoryMapViewport
          memories={memories}
          loading={loading}
          error={error}
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  );
}
