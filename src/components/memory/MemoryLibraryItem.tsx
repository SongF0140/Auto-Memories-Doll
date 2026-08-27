"use client";

import Link from "next/link";
import React from "react";
import MemoryCard from "@/components/memory/MemoryCard";
import { memoryDetailHref, memoryTopicHref } from "@/lib/memory-api-client";
import { getTopicLabelClient } from "@/config/topics-data";
import type { MemoryRecord } from "@/types/memory";

export default function MemoryLibraryItem({ memory }: { memory: MemoryRecord }) {
  return (
    <article className="group flex h-full flex-col">
      <Link
        href={memoryDetailHref(memory.id)}
        className="block h-full rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        aria-label={`查看记忆：${memory.titleZh || memory.title}`}
      >
        <MemoryCard
          memory={memory}
          className="h-full transition-transform duration-200 group-hover:-translate-y-0.5"
        />
      </Link>
      <div className="flex items-center justify-between gap-3 px-1 pt-3 text-xs text-text-tertiary">
        <Link href={memoryTopicHref(memory.topic)} className="truncate hover:text-accent">
          话题：{memory.topicZh || getTopicLabelClient(memory.topic)}
        </Link>
        <Link href={memoryDetailHref(memory.id)} className="shrink-0 font-medium hover:text-accent">
          查看详情 →
        </Link>
      </div>
    </article>
  );
}
