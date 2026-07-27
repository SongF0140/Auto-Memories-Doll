/**
 * Auto-Memories-Doll 浏览器桥接脚本
 *
 * 用法：
 *   1. 浏览器书签栏：新建书签，将本脚本压缩后填入 URL 栏
 *   2. 浏览器控制台：复制粘贴到 DevTools Console 运行
 *   3. Tampermonkey：作为用户脚本安装
 *
 * 功能：捕获当前页面 AI 对话内容，发送到本地 Auto-Memories-Doll 后台
 */

(function () {
  "use strict";

  const LISTEN_URL = "http://localhost:3000/api/listen";

  // ====== 页面平台检测 ======
  function detectPlatform() {
    const host = location.hostname;
    if (host.includes("chatgpt") || host.includes("chat.openai")) return "chatgpt-web";
    if (host.includes("claude")) return "claude-web";
    if (host.includes("gemini")) return "gemini-web";
    if (host.includes("deepseek")) return "deepseek-web";
    if (host.includes("kimi")) return "kimi-web";
    return "ai-chat";
  }

  // ====== 消息提取器（不同平台） ======
  function extractMessages() {
    const platform = detectPlatform();
    const messages = [];

    // ChatGPT 风格
    const chatGptArticles = document.querySelectorAll('article[data-testid^="conversation-turn"]');
    if (chatGptArticles.length > 0) {
      chatGptArticles.forEach((article) => {
        const isUser = article.querySelector('[data-message-author-role="user"]');
        const textEl = article.querySelector(".whitespace-pre-wrap") || article.querySelector('[data-message-content]');
        if (textEl) {
          messages.push({
            role: isUser ? "user" : "assistant",
            content: textEl.textContent?.trim() || "",
          });
        }
      });
      if (messages.length > 0) return messages;
    }

    // Claude 风格
    const claudeMessages = document.querySelectorAll('[data-test-render-count] .font-claude-message');
    if (claudeMessages.length > 0) {
      claudeMessages.forEach((el) => {
        const parent = el.closest(".flex-1");
        const isUser = parent?.textContent?.includes("You") || parent?.querySelector(".text-text-100");
        messages.push({
          role: isUser ? "user" : "assistant",
          content: el.textContent?.trim() || "",
        });
      });
      if (messages.length > 0) return messages;
    }

    // 通用回退：查找常见的 AI 对话 DOM 结构
    const selectors = [
      ".message", ".chat-message", ".conversation-item",
      '[class*="message"]', '[class*="chat-bubble"]',
      ".prose", '[class*="prose"]',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length >= 2) {
        els.forEach((el, i) => {
          const text = el.textContent?.trim();
          if (text && text.length > 10) {
            messages.push({
              role: i % 2 === 0 ? "user" : "assistant",
              content: text.substring(0, 2000),
            });
          }
        });
        if (messages.length > 0) break;
      }
    }

    return messages;
  }

  // ====== 提取页面标题 ======
  function extractTitle() {
    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent?.trim() || "";
    return document.title.replace(/ - ChatGPT$| - Claude$| - Gemini$/i, "").trim();
  }

  // ====== 创建浮动 UI ======
  function showUI(messages) {
    // 移除已有 UI
    const existing = document.getElementById("amd-capture-ui");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "amd-capture-ui";
    container.innerHTML = `
      <style>
        #amd-capture-ui { position:fixed; bottom:24px; right:24px; z-index:99999; font-family:system-ui,sans-serif; }
        .amd-card { background:#1a1a2e; border:1px solid #333; border-radius:16px; padding:20px; color:#e0e0e0; width:340px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
        .amd-card h3 { margin:0 0 4px; font-size:16px; color:#fff; }
        .amd-card .amd-sub { font-size:12px; color:#888; margin-bottom:12px; }
        .amd-card .amd-stats { font-size:13px; margin-bottom:16px; color:#aaa; }
        .amd-card input { width:100%; padding:8px 12px; border:1px solid #444; border-radius:8px; background:#16213e; color:#fff; font-size:13px; margin-bottom:8px; box-sizing:border-box; }
        .amd-card .amd-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
        .amd-card .amd-tag { padding:4px 10px; border-radius:20px; background:#0f3460; color:#a8d8ff; font-size:11px; cursor:pointer; border:none; }
        .amd-card .amd-tag.active { background:#e94560; color:#fff; }
        .amd-card .amd-btn { width:100%; padding:10px; border:none; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; transition:.2s; }
        .amd-card .amd-btn-primary { background:linear-gradient(135deg,#e94560,#c23152); color:#fff; }
        .amd-card .amd-btn-primary:hover { opacity:.9; transform:translateY(-1px); }
        .amd-card .amd-btn-primary:disabled { opacity:.5; cursor:not-allowed; transform:none; }
        .amd-card .amd-close { position:absolute; top:12px; right:14px; background:none; border:none; color:#666; font-size:18px; cursor:pointer; }
        .amd-card .amd-result { margin-top:10px; padding:8px 12px; border-radius:8px; font-size:12px; }
        .amd-card .amd-result.success { background:#0a3d1a; color:#4caf50; }
        .amd-card .amd-result.error { background:#3d0a0a; color:#f44336; }
        .amd-toast { position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#e94560; color:#fff; padding:10px 24px; border-radius:30px; font-size:13px; z-index:999999; animation:amdFadeIn .3s ease; }
        @keyframes amdFadeIn { from{opacity:0;transform:translateX(-50%) translateY(-10px);} to{opacity:1;transform:translateX(-50%) translateY(0);} }
      </style>
      <div class="amd-card" style="position:relative">
        <button class="amd-close" id="amd-close">&times;</button>
        <h3>记忆导入</h3>
        <div class="amd-sub">${detectPlatform()} | ${messages.length} 条消息</div>
        <div class="amd-stats">
          将发送到本地 Auto-Memories-Doll<br>
          自动分类并生成知识卡片
        </div>
        <div class="amd-tags" id="amd-tags">
          ${["ai-coding","daily-notes","learning","ideas","meetings"].map(t =>
            `<button class="amd-tag" data-tag="${t}">${t}</button>`
          ).join("")}
        </div>
        <input id="amd-topic" placeholder="话题目录名（可选，自动提取）" />
        <button class="amd-btn amd-btn-primary" id="amd-send">发送到记忆库</button>
        <div id="amd-result"></div>
      </div>
    `;

    document.body.appendChild(container);

    // 标签选择
    const selectedTags = [];
    container.querySelectorAll(".amd-tag").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        const tag = btn.dataset.tag;
        if (btn.classList.contains("active")) {
          selectedTags.push(tag);
        } else {
          const idx = selectedTags.indexOf(tag);
          if (idx > -1) selectedTags.splice(idx, 1);
        }
      });
    });

    // 关闭
    container.querySelector("#amd-close").addEventListener("click", () => container.remove());

    // 发送
    container.querySelector("#amd-send").addEventListener("click", async () => {
      const btn = container.querySelector("#amd-send");
      const resultEl = container.querySelector("#amd-result");
      const topic = container.querySelector("#amd-topic").value.trim();

      btn.disabled = true;
      btn.textContent = "发送中...";
      resultEl.className = "amd-result";
      resultEl.textContent = "";

      try {
        const body = {
          source: detectPlatform(),
          sourceType: "listen",
          title: extractTitle(),
          messages: messages,
          tags: selectedTags,
          topic: topic || undefined,
          metadata: {
            platform: detectPlatform(),
            url: location.href,
          },
        };

        const resp = await fetch(LISTEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await resp.json();

        if (data.success) {
          resultEl.className = "amd-result success";
          resultEl.textContent = `已保存！话题: ${data.topic}，记忆 ID: ${data.memoryId}`;
          showToast("记忆已成功导入！");
          setTimeout(() => container.remove(), 2000);
        } else {
          throw new Error(data.error || "未知错误");
        }
      } catch (err) {
        resultEl.className = "amd-result error";
        resultEl.textContent = `失败: ${err.message}`;
        btn.disabled = false;
        btn.textContent = "重试发送";
      }
    });
  }

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "amd-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  // ====== 主流程 ======
  const messages = extractMessages();

  if (messages.length === 0) {
    // 回退模式：提取页面全部可见文本，让用户手动选择
    const bodyText = document.body.innerText?.substring(0, 5000) || "";
    if (bodyText.length > 100) {
      showUI([{ role: "user", content: `页面内容快照:\n\n${bodyText}` }]);
      return;
    }
    showToast("未检测到 AI 对话内容。请在 AI 聊天页面使用此书签。");
    return;
  }

  showUI(messages);
})();
