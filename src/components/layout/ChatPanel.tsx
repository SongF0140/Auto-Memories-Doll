"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ChatIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-[55] flex items-center gap-2 px-4 py-3 rounded-2xl font-medium text-sm transition-all duration-300 ${
          open
            ? "glass shadow-sm text-text-tertiary hover:text-text-primary"
            : "text-accent-text shadow-md"
        }`}
        style={{ background: open ? undefined : "var(--color-accent)" }}
      >
        {open ? <CloseIcon /> : <><ChatIcon /><span className="hidden sm:inline">对话</span></>}
      </button>

      <div
        className={`fixed bottom-20 right-4 z-[55] w-[360px] max-w-[calc(100vw-2rem)] transition-all duration-400 ${
          open
            ? "translate-y-0 opacity-100 scale-100 pointer-events-auto"
            : "translate-y-4 opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="flex flex-col gap-4 rounded-2xl glass-elevated p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">对话入口</h3>
            <button
              onClick={() => setOpen(false)}
              className="text-text-tertiary hover:text-text-primary transition-colors"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="text-[12px] text-text-secondary leading-relaxed">
            在完整对话窗口中与 AI 记忆助手交谈，它会自动检索你的记忆库来增强回答。
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => { router.push("/chat"); setOpen(false); }}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
            >
              打开对话页
            </button>
            <button
              onClick={() => { router.push("/chat"); setOpen(false); }}
              className="px-4 py-2.5 rounded-xl glass shadow-sm text-text-secondary hover:text-text-primary text-[13px] transition-all"
            >
              记忆模式
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
