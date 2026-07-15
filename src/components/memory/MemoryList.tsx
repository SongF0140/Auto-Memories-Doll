"use client";

import { useState, useEffect } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";

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
      setMemories(result);
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="loading-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="empty-state">
        <p>No memories found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Memories</h2>
          <span className="text-sm text-text-tertiary">{memories.length} total</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories.map(memory => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </div>
      </div>
    </div>
  );
}
