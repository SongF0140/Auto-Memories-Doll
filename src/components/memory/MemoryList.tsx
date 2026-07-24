"use client";

import { useState, useEffect } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";
import EmptyState from "../common/EmptyState";

export default function MemoryList() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMemoryList();
  }, []);

  const fetchMemoryList = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/memory");
      const result = await response.json();
      setMemories(result.items || []);
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <EmptyState title="加载记忆中" description="正在获取你的记忆库..." />;
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        title="暂无记忆"
        description="在记忆模式下开始对话，或导入数据来构建你的记忆库。"
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="section-title text-gradient">我的记忆</h2>
            <p className="section-subtitle mt-1">精心收藏的重要时刻</p>
          </div>
          <span className="text-sm text-text-tertiary">{memories.length} 条记忆</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-list">
          {memories.map(memory => (
            <MemoryCard key={memory.id} memory={memory} className="animate-slide-up" />
          ))}
        </div>
      </div>
    </div>
  );
}
