"use client";

import React from "react";

type MarkdownProps = { content: string; className?: string };

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`${match.index}-code`} className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      if (link) nodes.push(<a key={`${match.index}-link`} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{link[1]}</a>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function Markdown({ content, className = "" }: MarkdownProps) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`} className="mb-4 leading-8">{renderInline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`ul-${blocks.length}`} className="mb-4 list-disc space-y-1 pl-6">{list.map((item, i) => <li key={`${i}-${item}`}>{renderInline(item)}</li>)}</ul>);
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(<blockquote key={`quote-${blocks.length}`} className="mb-4 border-l-4 border-accent/40 pl-4 italic">{renderInline(quote.join(" "))}</blockquote>);
    quote = [];
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      flushParagraph(); flushList(); flushQuote();
      if (inCode) blocks.push(<pre key={`code-${blocks.length}`} className="mb-4 overflow-x-auto rounded-lg bg-black/5 p-4 text-sm"><code>{code.join("\n")}</code></pre>);
      code = []; inCode = !inCode; return;
    }
    if (inCode) { code.push(line); return; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      const Heading = `h${heading[1].length}` as keyof JSX.IntrinsicElements;
      blocks.push(React.createElement(Heading, { key: `h-${blocks.length}`, className: "mb-3 mt-6 font-semibold" }, renderInline(heading[2])));
      return;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (item) { flushParagraph(); flushQuote(); list.push(item[1]); return; }
    if (/^\s*>\s?/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^\s*>\s?/, "")); return; }
    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); return; }
    flushList(); flushQuote(); paragraph.push(line.trim());
  });
  flushParagraph(); flushList(); flushQuote();
  return <div className={`break-words ${className}`}>{blocks}</div>;
}
