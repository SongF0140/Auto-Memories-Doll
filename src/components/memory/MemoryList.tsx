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
      setMemories(result);
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <EmptyState title="Loading memories" description="Fetching your memory collection..." />;
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        title="No memories yet"
        description="Start chatting in Memory mode or import data to build your collection."
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="section-title text-gradient">Your Memories</h2>
            <p className="section-subtitle mt-1">A curated collection of meaningful moments</p>
          </div>
          <span className="text-sm text-text-tertiary">{memories.length} memories</span>
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
