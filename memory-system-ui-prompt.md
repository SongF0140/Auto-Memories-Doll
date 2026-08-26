# 本地长期记忆系统 —— 前端实现级设计提示词

> 目标：基于 amagine.ai 硬科技 AI 美学，为本地长期记忆系统生成可直接落地的前端界面。所有尺寸、颜色、间距、动画参数均已给出，GLM 可据此直接产出 HTML/CSS/JS 或 React/Tailwind 代码。

---

## 1. 全局设计系统

### 1.1 色彩（Color Tokens）

```
Background Primary:    #FFFFFF    /* 主背景 */
Background Secondary:  #F7F8FA    /* 卡片/左侧栏背景 */
Background Tertiary:   #EEF0F4    /* 悬停/分隔背景 */
Border Default:        #E5E7EB    /* 默认边框 */
Border Hover:          #D1D5DB    /* 悬停边框 */

Text Primary:          #111827    /* 主文字 */
Text Secondary:        #6B7280    /* 次要文字 */
Text Tertiary:         #9CA3AF    /* 占位符/禁用 */
Text Inverse:          #FFFFFF    /* 反白文字 */

Brand Blue:            #2563EB    /* 主蓝色：选中、高亮、强调线 */
Brand Blue Light:      #DBEAFE    /* 蓝色浅背景 */
Brand Blue Glow:       rgba(37, 99, 235, 0.15)  /* 蓝色光晕 */

Brand Orange:          #F97316    /* 主橙色：行动、关注 */
Brand Orange Light:    #FFEDD5    /* 橙色浅背景 */

Brand Brown:           #5D4037    /* 循环标志深棕色 */
Brand Brown Dark:      #3E2723    /* 标志阴影/深色模式 */
```

### 1.2 字体系统（Typography）

```
字体族：
  Sans:   "Geist", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif
  Mono:   "Geist Mono", "SF Mono", "Consolas", "PingFang SC", monospace

标题：
  H1:  font-size: 32px; font-weight: 600; line-height: 40px; letter-spacing: -0.02em;
  H2:  font-size: 24px; font-weight: 600; line-height: 32px; letter-spacing: -0.01em;
  H3:  font-size: 18px; font-weight: 500; line-height: 26px;

正文：
  Body Large:  font-size: 16px; line-height: 24px; font-weight: 400;
  Body:        font-size: 14px; line-height: 22px; font-weight: 400;
  Caption:     font-size: 12px; line-height: 18px; font-weight: 400;

等宽编号：
  Mono:        font-family: "Geist Mono"; font-size: 13px; letter-spacing: 0.02em;
```

### 1.3 间距系统（Spacing Scale）

```
4px   --space-1
8px   --space-2
12px  --space-3
16px  --space-4
24px  --space-5
32px  --space-6
48px  --space-7
64px  --space-8
```

### 1.4 圆角与阴影

```
Radius Small:   6px    /* 按钮、标签 */
Radius Default: 10px    /* 卡片、输入框 */
Radius Large:   16px   /* 大卡片、面板 */
Radius Full:    9999px /* 胶囊 */

Shadow Card:       0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
Shadow Card Hover: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
Shadow Focus:      0 0 0 3px rgba(37, 99, 235, 0.2);
```

---

## 2. 页面整体结构

```
┌─────────────────────────────────────────────────────────┐
│  顶部导航栏（Nav）   高度 56px                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  主内容区                                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │  根据 Tab 切换：首页 / 检索库 / API Key / 提示词   │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.1 顶部导航栏

```
高度：56px
背景：#FFFFFF
底部边框：1px solid #E5E7EB
内边距：0 32px
固定顶部：position: sticky; top: 0; z-index: 50;

左侧：系统 Logo + 系统名称
  Logo: 深棕色循环形状，24px × 24px
  标题：font-size: 16px; font-weight: 600; color: #111827;

右侧：导航 Tab 列表
  首页 / 检索库 / API Key / 提示词与画像
  Tab 样式：
    font-size: 14px; font-weight: 500; color: #6B7280;
    padding: 8px 16px; border-radius: 8px;
  当前 Tab：
    color: #2563EB; background: #DBEAFE;
```

---

## 3. 首页（Home）

```
布局：垂直居中，最大宽度 720px，水平居中
内边距：padding-top: 120px;
```

### 3.1 循环标志（Logo Animation）

```
位置：标题正上方，居中
尺寸：48px × 48px
颜色：#5D4037
动画：
  形状按 方形 → 圆形 → 三角形 → 方形 循环
  每个形状停留 0.8s
  形状切换过渡 0.4s
  整体循环 3.2s
  easing: cubic-bezier(0.4, 0, 0.2, 1)
实现：可用 SVG + CSS clip-path 动画，或三个 SVG 切换 opacity
```

### 3.2 标题与强调线

```
标题："记忆中枢"（或你实际的系统名）
样式：font-size: 32px; font-weight: 600; color: #111827; text-align: center;

副标题："搜索、整理、连接你的一切知识"
样式：font-size: 16px; color: #6B7280; text-align: center; margin-top: 12px;

蓝色强调线：
  width: 40px; height: 3px; background: #2563EB; border-radius: 2px;
  margin: 24px auto 0;
```

### 3.3 搜索框

```
容器：
  width: 100%; max-width: 640px; margin: 48px auto 0;

输入框：
  width: 100%; height: 56px;
  padding: 0 24px;
  border: 1px solid #E5E7EB; border-radius: 16px;
  background: #FFFFFF;
  font-size: 16px; color: #111827;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);

占位符：color: #9CA3AF;
聚焦态：
  border-color: #2563EB;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);

搜索图标：
  position: absolute; right: 20px; top: 50%; transform: translateY(-50%);
  color: #9CA3AF;
```

### 3.4 顶部选项栏

```
位置：搜索框正上方
布局：flex, gap: 8px, justify-content: center

选项项：
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 13px; font-weight: 500;
  color: #6B7280;
  cursor: pointer;

当前项：
  background: #DBEAFE; color: #2563EB;

非当前项悬停：
  background: #F7F8FA;
```

### 3.5 右侧历史记录

```
位置：搜索框右侧，绝对定位或跟随布局
最大宽度：220px

标题："最近访问" font-size: 12px; color: #9CA3AF; margin-bottom: 12px;

历史条目：
  padding: 10px 14px;
  border-radius: 10px;
  background: #F7F8FA;
  margin-bottom: 8px;
  font-size: 13px; color: #374151;
  cursor: pointer;
  transition: background 150ms ease;

悬停：background: #EEF0F4;
```

---

## 4. 检索库（Retrieval Library）

```
整体布局：
  display: flex; height: calc(100vh - 56px);

左侧信息面板：
  width: 20%; min-width: 240px; max-width: 320px;
  background: #F7F8FA;
  border-right: 1px solid #E5E7EB;

右侧内容区：
  flex: 1; overflow-y: auto; padding: 32px;
```

### 4.1 左侧空态面板

```
内容居中显示
图标：一个镂空的书架/图书馆图标，48px，stroke #D1D5DB
文案：
  主文案："选择一个知识板块"
  次文案："从右侧选择一个板块，开始探索你的记忆"
  color: #6B7280 / #9CA3AF;
```

### 4.2 右侧图书馆视图

```
标题区：
  H2: "知识图书馆"
  副标题："已自动归纳 {n} 个知识板块"
  margin-bottom: 32px;

网格布局：
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;

知识板块卡片：
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
  cursor: pointer;

悬停态：
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  border-color: #2563EB;

卡片内容：
  板块名称：font-size: 18px; font-weight: 600; color: #111827;
  元数据行：font-family: "Geist Mono"; font-size: 12px; color: #6B7280;
  关键词标签：display: inline-flex; gap: 8px; margin-top: 16px;
    标签样式：
      padding: 4px 10px; border-radius: 6px;
      background: #F7F8FA; color: #374151;
      font-size: 12px;
```

### 4.3 进入知识板块后的左侧目录

```
面板结构：
  ┌─────────────────────────────┐
  │  思维导图目录入口              │
  │  （镂空科技风节点 + 微动效）   │
  ├─────────────────────────────┤
  │  分类目录                     │
  │  - 知识归纳                   │
  │  - 工作经验                   │
  │  - 项目沉淀                   │
  └─────────────────────────────┘

思维导图入口：
  padding: 16px;
  border-radius: 12px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  margin-bottom: 16px;
  cursor: pointer;

预览节点（3-4 个节点示意）：
  每个节点：
    width: 24px; height: 24px;
    border: 2px solid #2563EB;
    border-radius: 6px;
    background: transparent;
    /* 镂空科技风 */

节点动画：
  呼吸效果：scale 1.0 → 1.1 → 1.0，循环 2s
  描边流动：stroke-dashoffset 动画（可选）

分类目录项：
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 14px; color: #374151;
  cursor: pointer;
  transition: background 150ms ease;

当前选中项：
  background: #DBEAFE; color: #2563EB; font-weight: 500;
```

### 4.4 右侧详情区

```
思维导图展示区：
  height: 320px;
  background: linear-gradient(180deg, #F7F8FA 0%, #FFFFFF 100%);
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  margin-bottom: 32px;
  position: relative;
  overflow: hidden;

节点设计：
  默认节点：
    width: 120px; padding: 10px 14px;
    border: 2px solid #2563EB;
    border-radius: 10px;
    background: rgba(255,255,255,0.9);
    font-size: 13px; color: #111827;
    text-align: center;
  
  选中/悬停节点：
    background: #DBEAFE;
    box-shadow: 0 0 12px rgba(37, 99, 235, 0.2);

  连线：stroke: #CBD5E1; stroke-width: 2px;

分类知识卡片：
  标题：font-size: 18px; font-weight: 600; margin-bottom: 16px;
  卡片列表：
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
```

---

## 5. API Key 配置页

```
布局：最大宽度 480px，居中
标题："API 配置"
描述文字：font-size: 14px; color: #6B7280; margin-bottom: 24px;

表单字段：
  label: font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 8px;
  input: 同首页搜索框样式

状态标签：
  未配置：background: #FEF3C7; color: #D97706;
  校验中：background: #DBEAFE; color: #2563EB;
  已配置：background: #D1FAE5; color: #059669;
  padding: 4px 10px; border-radius: 6px; font-size: 12px;

保存按钮：
  background: #2563EB; color: #FFFFFF;
  padding: 10px 24px; border-radius: 10px;
  font-weight: 500;
  hover: background: #1D4ED8;
```

---

## 6. 个人提示词 + 经典用户画像

```
布局：左右分栏
  左侧分类列表：width: 260px; border-right: 1px solid #E5E7EB;
  右侧编辑/预览区：flex: 1; padding: 32px;

左侧分类项：
  padding: 14px 20px;
  border-radius: 10px;
  font-size: 14px; color: #374151;
  cursor: pointer;
  当前项：background: #DBEAFE; color: #2563EB; font-weight: 500;

用户画像卡片：
  width: 100%;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 16px;
  
  卡片内容：
    头像占位：48px × 48px 圆角，深棕色背景 + 白色首字母
    画像名称：font-size: 16px; font-weight: 600;
    描述：font-size: 13px; color: #6B7280;
    应用按钮：同保存按钮样式，尺寸更小

编辑区：
  textarea:
    width: 100%; min-height: 200px;
    border: 1px solid #E5E7EB; border-radius: 12px;
    padding: 16px;
    font-size: 14px; line-height: 22px;
    focus: border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
```

---

## 7. 动效规范

```
默认过渡：
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);

按钮悬停：
  transform: translateY(-1px);
  transition: transform 150ms ease, box-shadow 150ms ease;

卡片悬停：
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);

聚焦光环：
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);

循环标志动画：
  duration: 3.2s;
  easing: cubic-bezier(0.4, 0, 0.2, 1);
  按 方形(0.8s) → 圆形(0.8s) → 三角形(0.8s) → 方形(0.8s) 循环

思维导图节点呼吸：
  animation: breathe 2s ease-in-out infinite;
  @keyframes breathe {
    0%, 100% { transform: scale(1); opacity: 0.9; }
    50% { transform: scale(1.1); opacity: 1; }
  }
```

---

## 8. 响应式适配

```
Desktop (>= 1024px):
  左侧检索库面板 20%
  右侧内容区 80%

Tablet (768px - 1023px):
  左侧检索库面板固定 240px
  右侧内容区 flex: 1

Mobile (< 768px):
  左侧面板折叠为抽屉（Drawer），通过左上角按钮触发
  右侧内容区 100% 宽度，padding: 16px
  首页搜索框 max-width: 100%
```

---

## 9. 交付要求

请基于以上规范，生成一个完整的单文件 HTML（包含内联 CSS 与 JS）或 React 组件，要求：

1. 顶部导航栏可切换四个 Tab
2. 首页搜索框 + 循环标志动画正常播放
3. 检索库左侧空态 + 进入板块后目录切换
4. 知识板块卡片悬停效果与分类展示
5. 所有颜色、间距、字体严格按照上述数值实现
6. 支持浅色/深色模式切换（可选加分项）
7. 代码注释清晰，便于后续接入真实数据
