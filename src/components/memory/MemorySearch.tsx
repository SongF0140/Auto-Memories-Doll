"use client";

import { useState } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";
import EmptyState from "../common/EmptyState";
import { SpotlightCard } from "../ui/spotlight-card";
import { MagneticButton } from "../ui/magnetic-button";

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
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h2 className="section-title text-gradient">Search Memories</h2>
          <p className="section-subtitle mt-1">Find memories by meaning, not just keywords</p>
        </div>

        <SpotlightCard className="p-2 mb-8 max-w-2xl">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What are you looking for?"
              className="input border-0 shadow-none bg-transparent flex-1"
            />
            <MagneticButton
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="whitespace-nowrap"
            >
              Search
            </MagneticButton>
          </div>
        </SpotlightCard>

        {loading && <EmptyState title="Searching" description={`Finding memories related to "${query}"...`} />}

        {!loading && searched && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-text-primary">
                {results.length > 0 ? "Results" : "No matches"}
              </h3>
              <span className="text-sm text-text-tertiary">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            </div>

            {results.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-list">
                {results.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} className="animate-slide-up" />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-text-secondary mb-2">No results for "{query}"</p>
                <p className="text-sm text-text-tertiary">Try a different phrase or check your spelling</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
