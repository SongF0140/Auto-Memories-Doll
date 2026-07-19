"use client";

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "memory", label: "Memories" },
    { id: "search", label: "Search" },
    { id: "prompt", label: "Prompts" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-surface/80 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-accent-text text-sm font-bold">A</span>
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-text-primary leading-none">
                Auto-Memories-Doll
              </h1>
              <p className="text-xs text-text-tertiary mt-0.5">AI memory companion</p>
            </div>
          </div>

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
