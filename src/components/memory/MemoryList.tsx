"use client";

import { useState, useEffect } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";
import EmptyState from "../common/EmptyState";
import MemoryViewer from "./MemoryViewer";
import { requestApi } from "../../lib/api-client";
import { IngestResponse, MemoryListResponse } from "../../types/api";

// Photo by Léonard Cotte on Unsplash (free to use, no attribution required)
const memoryGardenImage =
  "https://images.unsplash.com/photo-1499002238440-d264edd596ec?w=1200&q=80";

export default function MemoryList() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);

  useEffect(() => {
    fetchMemoryList();
  }, []);

  const fetchMemoryList = async () => {
    setLoading(true);
    try {
      const response = await requestApi<MemoryListResponse>("/api/memory");
      setMemories(response.data.items);
    } catch (error) {
      console.error("Failed to fetch memories:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    const content = importContent.trim();
    if (!content || importing) return;

    setImporting(true);
    setImportMessage("正在导入...");

    try {
      const response = await requestApi<IngestResponse>("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format: "text" }),
      });

      setImportContent("");
      setImportMessage(
        `导入任务已提交（${response.data.status}），处理完成后会出现在记忆列表中。`,
      );
      await fetchMemoryList();
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg.includes("fetch failed") || errMsg.includes("Failed to fetch")) {
        setImportMessage("导入失败: 无法连接到服务，请确保开发服务器正在运行");
      } else {
        setImportMessage(`导入失败: ${errMsg}`);
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="card overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-6 sm:p-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-text-tertiary">
                Memory Archive
              </p>
              <h2 className="section-title">我的记忆</h2>
              <p className="section-subtitle mt-2 max-w-xl">
                把片段、想法和重要经历整理成长期记忆。粘贴文本后点击导入，系统会自动生成标题、摘要和标签。
              </p>

              <div className="mt-6 space-y-3">
                <textarea
                  value={importContent}
                  onChange={(event) => setImportContent(event.target.value)}
                  placeholder="粘贴要导入的记忆内容..."
                  className="input min-h-[112px] resize-y"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-text-tertiary">
                    {importMessage || `${memories.length} 条记忆已保存`}
                  </p>
                  <button
                    onClick={handleImport}
                    disabled={importing || !importContent.trim()}
                    className="btn h-11 px-5"
                  >
                    {importing ? "导入中..." : "导入记忆"}
                  </button>
                </div>
              </div>
            </div>
            <div className="relative min-h-[260px] overflow-hidden lg:min-h-full">
              <img
                src={memoryGardenImage}
                alt="记忆花园中的信纸与打字机"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-l from-transparent via-brand-blue/5 to-brand-blue/20 lg:bg-gradient-to-r" />
            </div>
          </div>
        </div>

        {loading ? (
          <EmptyState title="加载记忆中" description="正在获取你的记忆库..." />
        ) : memories.length === 0 ? (
          <EmptyState
            title="暂无记忆"
            description="先在上方导入一段文字，或在记忆模式下开始对话。"
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 stagger-list md:grid-cols-2 xl:grid-cols-3">
            {memories.map((memory) => (
              <div
                key={memory.id}
                onClick={() => setSelectedMemoryId(memory.id)}
                className="cursor-pointer"
              >
                <MemoryCard key={memory.id} memory={memory} className="animate-slide-up" />
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedMemoryId && (
        <MemoryViewer
          memoryId={selectedMemoryId}
          onClose={() => setSelectedMemoryId(null)}
          onDeleted={fetchMemoryList}
          onUpdated={fetchMemoryList}
        />
      )}
    </div>
  );
}
