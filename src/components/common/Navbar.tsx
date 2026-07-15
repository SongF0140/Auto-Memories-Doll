"use client";

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "memory", label: "Memory" },
    { id: "search", label: "Search" },
    { id: "prompt", label: "Prompt" },
  ];

  return (
    <header className="bg-surface border-b border-border">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <h1 className="text-base font-semibold tracking-tight text-text-primary">
            Auto-Memories-Doll
          </h1>

          <nav className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`nav-tab ${activeTab === tab.id ? "nav-tab-active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
