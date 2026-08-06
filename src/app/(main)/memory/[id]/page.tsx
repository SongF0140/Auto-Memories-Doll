"use client";

import { useParams, useRouter } from "next/navigation";
import MemoryViewer from "@/components/memory/MemoryViewer";

export default function MemoryDetailPage() {
  const params = useParams();
  const router = useRouter();

  return (
    <MemoryViewer
      memoryId={params.id as string}
      onClose={() => router.push("/memory")}
      onDeleted={() => router.push("/memory")}
      onUpdated={() => router.refresh()}
    />
  );
}
