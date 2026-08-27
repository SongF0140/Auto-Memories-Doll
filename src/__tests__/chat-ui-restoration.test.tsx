import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
}));

import ChatInterface from "../components/chat/ChatInterface";
import TopNavbar from "../components/common/TopNavbar";

describe("chat UI restoration", () => {
  it("keeps the existing top navigation limited to its three designed entries", () => {
    const html = renderToStaticMarkup(<TopNavbar />);

    expect(html).toContain('href="/"');
    expect(html).toContain('href="/memory"');
    expect(html).toContain('href="/settings/ai"');
    expect(html).not.toContain('href="/chat"');
  });

  it("renders the restored chat and multi-session controls", () => {
    const html = renderToStaticMarkup(<ChatInterface />);

    expect(html).toContain("与你的 AI 伙伴对话");
    expect(html).toContain("新会话");
    expect(html).toContain("正在恢复会话");
  });
});
