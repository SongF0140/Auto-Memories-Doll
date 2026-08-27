/**
 * 检索评测固件 —— 手工构造的记忆库与查询集
 *
 * 设计原则：
 * - 记忆覆盖 5 个话题，字段措辞互相区分，避免"全都匹配"的退化情况；
 * - 查询分三类：标题级精确查询、关键词片段查询、口语化问句；
 * - 每条查询只有一个标准答案（expected），用于 Recall@k / MRR 计算。
 */

export type EvalMemory = {
  id: string;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  topic: string;
};

export type EvalQuery = {
  query: string;
  expected: string;
  /** 查询类型标签，用于分组统计 */
  kind: "title" | "keyword" | "colloquial";
};

export const EVAL_MEMORIES: EvalMemory[] = [
  // ── C++ 学习 ──
  {
    id: "mem-cpp-01",
    title: "C++智能指针使用笔记",
    content:
      "unique_ptr 独占所有权，适合 RAII 场景；shared_ptr 用引用计数共享所有权，注意循环引用要用 weak_ptr 打破。",
    summary: "unique_ptr 与 shared_ptr 的区别和典型用法",
    tags: ["c++", "智能指针", "shared_ptr"],
    topic: "cpp-learning",
  },
  {
    id: "mem-cpp-02",
    title: "CMake构建配置要点",
    content:
      "CMakeLists 里用 target_link_libraries 管理依赖，file(COPY) 会在 configure 阶段复制配置文件到构建目录。",
    summary: "CMake 依赖管理与文件复制的坑",
    tags: ["cmake", "构建"],
    topic: "cpp-learning",
  },
  {
    id: "mem-cpp-03",
    title: "虚函数与多态总结",
    content:
      "基类指针调用虚函数走虚表查找实现运行时多态，析构函数必须声明为 virtual 防止派生类泄漏。",
    summary: "虚函数表机制与多态的条件",
    tags: ["c++", "多态", "虚函数"],
    topic: "cpp-learning",
  },
  {
    id: "mem-cpp-04",
    title: "STL容器选择指南",
    content: "vector 连续内存适合随机访问，list 适合频繁插拔，unordered_map 哈希查找平均 O(1)。",
    summary: "常用 STL 容器的适用场景对比",
    tags: ["stl", "容器"],
    topic: "cpp-learning",
  },
  {
    id: "mem-cpp-05",
    title: "内存泄漏排查方法",
    content:
      "用 valgrind 或 AddressSanitizer 定位泄漏点，重点检查 new 之后有没有配对的 delete 路径。",
    summary: "内存泄漏的定位工具与常见原因",
    tags: ["内存泄漏", "valgrind"],
    topic: "cpp-learning",
  },

  // ── 树莓派泊车项目 ──
  {
    id: "mem-park-01",
    title: "树莓派5泊车引导系统方案",
    content:
      "树莓派5 8GB 做边缘节点，Camera Module 3 采集车位画面，选用 YOLOv8n 模型做车位检测，实现智能泊车引导。",
    summary: "边缘计算泊车引导的整体技术方案",
    tags: ["树莓派", "泊车", "边缘计算"],
    topic: "edge-parking",
  },
  {
    id: "mem-park-02",
    title: "YOLOv8n模型INT8量化",
    content:
      "YOLOv8n 导出 ONNX 后做 INT8 量化，用 onnxruntime 在树莓派上推理，帧率能满足实时车位检测。",
    summary: "模型量化与 ONNXRuntime 部署细节",
    tags: ["yolo", "量化", "onnx"],
    topic: "edge-parking",
  },
  {
    id: "mem-park-03",
    title: "MQTT通信协议设计",
    content:
      "边缘端通过 MQTT 把车位状态发布到 broker，JavaWeb 后端订阅主题更新数据库，QoS 设为 1 保证送达。",
    summary: "边缘到后端的 MQTT 消息链路",
    tags: ["mqtt", "通信"],
    topic: "edge-parking",
  },
  {
    id: "mem-park-04",
    title: "Camera Module 3调试记录",
    content: "摄像头排线要插紧，libcamera 预览正常后再调曝光参数，逆光场景需要开启 HDR 模式。",
    summary: "树莓派摄像头模组调试踩坑",
    tags: ["摄像头", "树莓派"],
    topic: "edge-parking",
  },
  {
    id: "mem-park-05",
    title: "乱停治理闭环流程",
    content:
      "检测到乱停后生成工单，通知车主挪车，超时未处理则推送给管理员，形成检测-通知-处置闭环。",
    summary: "乱停车辆从发现到处置的闭环",
    tags: ["泊车", "治理"],
    topic: "edge-parking",
  },

  // ── CRM 项目 ──
  {
    id: "mem-crm-01",
    title: "CRM客户管理模块设计",
    content: "客户管理模块包含客户档案、跟进记录、商机漏斗三个子功能，权限按角色划分。",
    summary: "CRM 客户管理的功能拆分",
    tags: ["crm", "客户管理"],
    topic: "crm-project",
  },
  {
    id: "mem-crm-02",
    title: "CRM答辩PPT要点",
    content: "答辩先讲需求背景和系统架构图，再演示核心流程，最后准备老师可能问的并发与安全问题。",
    summary: "项目答辩的讲述结构",
    tags: ["答辩", "crm"],
    topic: "crm-project",
  },
  {
    id: "mem-crm-03",
    title: "数据库表结构设计",
    content: "MySQL 里客户表与跟进记录是一对多，跟进记录加联合索引加速按时间查询，外键保证一致性。",
    summary: "CRM 的表关系与索引设计",
    tags: ["数据库", "mysql"],
    topic: "crm-project",
  },

  // ── Agent 开发 ──
  {
    id: "mem-agent-01",
    title: "Vercel AI SDK流式输出",
    content:
      "用 streamText 驱动 agent 循环，前端消费 ReadableStream 事件增量渲染，isStepCount 限制最大轮次。",
    summary: "AI SDK 流式 agent 循环的实现方式",
    tags: ["ai-sdk", "流式"],
    topic: "agent-dev",
  },
  {
    id: "mem-agent-02",
    title: "记忆系统审计队列设计",
    content:
      "候选记忆先写入 pending_events 待审计队列，按 memoryId 串行消费，冲突三级分级后再落盘。",
    summary: "审计队列的写入治理机制",
    tags: ["审计队列", "记忆"],
    topic: "agent-dev",
  },
  {
    id: "mem-agent-03",
    title: "向量检索MMR重排",
    content: "向量召回后用 MMR 在相关性与多样性之间平衡，避免注入提示词的记忆主题重复。",
    summary: "检索结果的重排策略",
    tags: ["检索", "mmr", "重排"],
    topic: "agent-dev",
  },
  {
    id: "mem-agent-04",
    title: "MCP服务器配置笔记",
    content:
      "stdio 型 MCP 服务器要在连接器页面手动粘贴 JSON 配置，mcp.json 格式是 mcpServers 包裹 name 与 command。",
    summary: "MCP 服务器的接入方式",
    tags: ["mcp", "配置"],
    topic: "agent-dev",
  },
  {
    id: "mem-agent-05",
    title: "提示词模板管理",
    content: "系统提示词拆成模板加动态区块，模板内容哈希变更时缓存自动失效，支持热重载。",
    summary: "提示词模板的组织与缓存失效",
    tags: ["提示词", "模板"],
    topic: "agent-dev",
  },

  // ── 学习生活 ──
  {
    id: "mem-daily-01",
    title: "暑期学习计划安排",
    content: "暑期按 C++、Python、Agent 三个方向推进，每个方向配具体链接、建议时长和项目要求。",
    summary: "暑期三方向学习任务书",
    tags: ["学习计划", "暑期"],
    topic: "daily-notes",
  },
  {
    id: "mem-daily-02",
    title: "湖北文理学院课程表",
    content: "本学期周一有数据结构，周三下午是操作系统实验，周五上午选修课。",
    summary: "本学期课程时间安排",
    tags: ["课程", "学校"],
    topic: "daily-notes",
  },
  {
    id: "mem-daily-03",
    title: "大创项目申报材料清单",
    content: "大创申报需要项目申请书、成员信息表、指导老师意见，团队负责人谭迦木负责汇总。",
    summary: "大创申报要准备的材料",
    tags: ["大创", "申报"],
    topic: "daily-notes",
  },
  {
    id: "mem-daily-04",
    title: "软著申报流程记录",
    content: "软著申报要提交源代码文档和说明书，样例模板在参考文件夹，成品输出到 mine 目录。",
    summary: "软件著作权申报的步骤",
    tags: ["软著", "申报"],
    topic: "daily-notes",
  },
  {
    id: "mem-daily-05",
    title: "读书笔记原子习惯",
    content: "原子习惯讲行为改变的四个定律：让它显而易见、有吸引力、简便易行、令人愉悦。",
    summary: "原子习惯的核心框架",
    tags: ["读书", "习惯"],
    topic: "daily-notes",
  },
  {
    id: "mem-daily-06",
    title: "周末徒步路线收藏",
    content: "城郊那条徒步路线全程八公里，沿途有溪水补给点，适合周末户外活动。",
    summary: "收藏的户外徒步路线",
    tags: ["徒步", "户外"],
    topic: "daily-notes",
  },
];

export const EVAL_QUERIES: EvalQuery[] = [
  // 标题级精确查询
  { query: "智能指针", expected: "mem-cpp-01", kind: "title" },
  { query: "CMake配置", expected: "mem-cpp-02", kind: "title" },
  { query: "虚函数与多态", expected: "mem-cpp-03", kind: "title" },
  { query: "STL容器选择", expected: "mem-cpp-04", kind: "title" },
  { query: "内存泄漏排查", expected: "mem-cpp-05", kind: "title" },
  { query: "泊车引导系统方案", expected: "mem-park-01", kind: "title" },
  { query: "INT8量化", expected: "mem-park-02", kind: "title" },
  { query: "MQTT通信协议", expected: "mem-park-03", kind: "title" },
  { query: "Camera Module调试", expected: "mem-park-04", kind: "title" },
  { query: "乱停治理闭环", expected: "mem-park-05", kind: "title" },

  // 关键词片段查询
  { query: "shared_ptr", expected: "mem-cpp-01", kind: "keyword" },
  { query: "valgrind", expected: "mem-cpp-05", kind: "keyword" },
  { query: "onnxruntime", expected: "mem-park-02", kind: "keyword" },
  { query: "客户管理", expected: "mem-crm-01", kind: "keyword" },
  { query: "数据库表结构", expected: "mem-crm-03", kind: "keyword" },
  { query: "审计队列", expected: "mem-agent-02", kind: "keyword" },
  { query: "MMR重排", expected: "mem-agent-03", kind: "keyword" },
  { query: "MCP服务器", expected: "mem-agent-04", kind: "keyword" },
  { query: "提示词模板", expected: "mem-agent-05", kind: "keyword" },
  { query: "课程表", expected: "mem-daily-02", kind: "keyword" },
  { query: "软著申报", expected: "mem-daily-04", kind: "keyword" },
  { query: "原子习惯", expected: "mem-daily-05", kind: "keyword" },
  { query: "徒步路线", expected: "mem-daily-06", kind: "keyword" },

  // 口语化问句
  { query: "树莓派上做泊车用的是什么方案", expected: "mem-park-01", kind: "colloquial" },
  { query: "模型量化之后怎么在树莓派跑起来", expected: "mem-park-02", kind: "colloquial" },
  { query: "摄像头画面调不出来怎么办", expected: "mem-park-04", kind: "colloquial" },
  { query: "答辩的时候PPT怎么讲", expected: "mem-crm-02", kind: "colloquial" },
  { query: "流式输出是怎么实现的", expected: "mem-agent-01", kind: "colloquial" },
  { query: "暑假打算学点什么", expected: "mem-daily-01", kind: "colloquial" },
  { query: "大创要交哪些材料", expected: "mem-daily-03", kind: "colloquial" },
];
