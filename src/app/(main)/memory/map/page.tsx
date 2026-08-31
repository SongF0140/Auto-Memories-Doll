"use client";

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
    <div className="relative h-[calc(100vh-56px)] min-h-[620px] overflow-hidden bg-background-warm grain-overlay">
      <MemoryMapViewport
        memories={memories}
        loading={loading}
        error={error}
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}
