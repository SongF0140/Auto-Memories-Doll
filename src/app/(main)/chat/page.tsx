import type { Metadata } from "next";
import ChatInterface from "@/components/chat/ChatInterface";

export const metadata: Metadata = {
  title: "开始对话 | Auto-Memories-Doll",
};

export default function ChatPage() {
  return <ChatInterface />;
}
