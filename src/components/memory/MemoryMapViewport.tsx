"use client";

import React from "react";
import EmptyState from "@/components/common/EmptyState";
import KnowledgeMap, { type KnowledgeNode } from "@/components/memory/KnowledgeMap";
import type { MemoryRecord } from "@/types/memory";

interface MemoryMapViewportProps {
  memories: MemoryRecord[];
  loading: boolean;
  error: string;
  onNodeClick: (node: KnowledgeNode) => void;
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center bg-background-warm">
      <div className="text-center">
        <div className="loading-dots mb-4">
          <span />
          <span />
          <span />
        </div>
        <p className="text-sm text-text-secondary">正在加载知识图谱...</p>
      </div>
    </div>
  );
}

export default function MemoryMapViewport({
  memories,
  loading,
  error,
  onNodeClick,
}: MemoryMapViewportProps) {
  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div role="alert" className="card max-w-md text-center">
          <h2 className="text-xl font-bold text-text-primary">知识图谱加载失败</h2>
          <p className="mt-3 text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          title="暂无知识图谱"
          description="有记忆内容后，系统会按话题和标签聚合知识节点。"
        />
      </div>
    );
  }

  return <KnowledgeMap memories={memories} onNodeClick={onNodeClick} />;
}
