"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MemoryList from "@/components/memory/MemoryList";
import MemorySearch from "@/components/memory/MemorySearch";

function MemoryPageContent() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");

  if (mode === "search") {
    return <MemorySearch />;
  }
  return <MemoryList />;
}

export default function MemoryPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <p className="text-text-tertiary text-sm">加载中…</p>
      </div>
    }>
      <MemoryPageContent />
    </Suspense>
  );
}
