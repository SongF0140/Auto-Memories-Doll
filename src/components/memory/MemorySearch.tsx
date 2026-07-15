"use client";

import { useState } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";

export default function MemorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const response = await fetch(`/api/memory/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error("Search failed:", error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories..."
            className="input"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="btn whitespace-nowrap"
          >
            Search
          </button>
        </div>

        {loading && (
          <div className="empty-state py-12">
            <div className="loading-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {!loading && searched && (
          <>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-base font-medium text-text-primary">Results</h2>
              <span className="text-sm text-text-tertiary">{results.length} found</span>
            </div>

            {results.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary py-8 text-center">
                No results for "{query}"
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
