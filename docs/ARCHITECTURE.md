# 架构设计

> 本文说明 TinyBuddy 的分层、请求链路、核心算法与扩展点。接口清单见 [API.md](./API.md)，MCP 接入见 [MCP.md](./MCP.md)，部署见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 目录

- [1. 设计目标](#1-设计目标)
- [2. 包结构与依赖方向](#2-包结构与依赖方向)
- [3. 一次对话的完整链路](#3-一次对话的完整链路)
- [4. DSH 运行时](#4-dsh-运行时)
- [5. 数据模型](#5-数据模型)
- [6. 记忆系统](#6-记忆系统)
- [7. 知识库](#7-知识库)
- [8. 技能系统](#8-技能系统)
- [9. MCP 双向通道](#9-mcp-双向通道)
- [10. 调度器](#10-调度器)
- [11. 权限与安全](#11-权限与安全)
- [12. 前端架构](#12-前端架构)
- [13. 扩展点](#13-扩展点)
- [14. 已知限制与演进方向](#14-已知限制与演进方向)

---

## 1. 设计目标

TinyBuddy 的目标不是「再做一个聊天界面」，而是把 AI 当成团队成员来建模。由此推出四条硬约束：

| 约束 | 具体做法 |
| --- | --- |
| **可离线、可演示** | 内置 `MockProvider`，无 API Key 也能跑通流式输出、工具调用、记忆写入的完整链路 |
| **零外部依赖即可部署** | SQLite + 本地哈希向量 + 进程内调度，单文件数据库，`pnpm start` 就能跑 |
| **一个内核、三个入口** | 网页对话、MCP 调用、定时任务共用同一个 `AgentRuntime` |
| **前后端同源策略** | RBAC 判定、事件契约、领域类型都在 `shared` 包里，只有一份实现 |

取舍逻辑很简单：**能让一个人十分钟跑起来，比能让一千人分布式跑起来更重要**——后者可以演进，前者决定别人愿不愿意开始。

---

## 2. 包结构与依赖方向

```
        apps/web  ──────────┐
             │             │
             ▼             ▼
     packages/shared ◄── packages/dsh
             ▲             ▲
             └──── packages/server
```

| 包 | 职责 | 依赖 |
| --- | --- | --- |
| `@tiny-buddy/shared` | 领域类型、RBAC 权限模型、Agent 事件契约、MCP 协议常量 | 无 |
| `@tiny-buddy/dsh` | 响应式 Agent 运行时：信号、工具注册表、模型适配、多步循环 | `shared` |
| `@tiny-buddy/server` | HTTP 层、持久化、业务服务、MCP 服务端 | `shared` + `dsh` |
| `@tiny-buddy/web` | React SPA | `shared` |

依赖**只向下**，`dsh` 不认识数据库、不认识 Express，因此可以单独抽出去做别的产品。反过来，服务层只通过端口（`MemoryPort` / `KnowledgePort` / `ToolRegistry`）与内核交互。

---

## 3. 一次对话的完整链路

```mermaid
sequenceDiagram
  participant U as 浏览器
  participant API as Express
  participant AG as agentService
  participant RT as AgentRuntime
  participant P as Provider
  participant T as Tools

  U->>API: POST /api/sessions/:id/messages (JWT)
  API->>API: requireAuth → requirePermission("agent:run")
  API->>AG: runAgent({ runId, userId, ... })
  AG->>AG: 落库 user message / 创建 run 记录
  AG->>RT: runtime.run()
  RT-->>API: run.start
  RT->>RT: resolveSkills(input) 触发词匹配
  RT-->>API: skill.active（命中时）
  RT->>AG: memory.recall → 端口回调
  RT-->>API: memory.recall
  loop 最多 maxSteps 轮
    RT->>P: chat(messages, tools, stream)
    P-->>RT: text.delta / tool_call
    RT-->>API: text.delta（SSE 直出）
    RT->>T: execute(tool)
    T-->>RT: ToolResult
    RT-->>API: tool.start / tool.end
  end
  RT-->>API: message.end → run.end
  API-->>U: data: {...}\n\n（逐条推送）
  U<-API: data: [DONE]
```

要点：

- **SSE 帧格式**：每条事件一行 `data: {"type": "...", ...}\n\n`，结束写 `data: [DONE]`，另有 15 秒一次的 `: ping` 注释帧防止中间层断连。
- **断连处理**：监听 `res` 的 `close` 且 `!res.writableEnded` 时才 `abort()`，否则正常结束会被误判成用户取消。
- **落库时机**：用户消息在进入运行时前写入；助手消息在 `message.end` 时整体写入（含工具调用片段），保证刷新页面能看到完整过程。

---

## 4. DSH 运行时

`packages/dsh/src` 共 5 个文件、约 900 行。

### 4.1 reactive.ts — 响应式基元

| 类 | 作用 |
| --- | --- |
| `Signal<T>` | 单值可订阅容器，`get/set/subscribe`，用于运行状态 |
| `ReactiveStore<S>` | 对象级容器，`patch()` 浅合并，用于 `RuntimeState` / `RuntimeMetrics` |
| `AsyncQueue<T>` | 把回调式的流事件转成 `AsyncIterable`，`run()` 的产出通道 |
| `Emitter<E>` | 轻量事件总线，用于生命周期钩子 |

`AsyncQueue` 是流式体验的关键：Provider 在回调里 `push(delta)`，`run()` 在 `for await` 里消费，背压由队列自然吸收，不需要手写 Promise 编排。

### 4.2 tools.ts — 统一工具契约

```ts
interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  source: "platform" | "mcp" | "skill";   // 来源用于 UI 着色与审计
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

平台工具、MCP 工具、技能工具走同一张注册表。`source` 字段让前端能区分「这是平台能力还是外部 MCP」，也让审计日志更可读。

### 4.3 provider.ts — 模型适配

`LlmProvider` 只有两个成员：`name` / `model` 和 `chat(req): AsyncIterable<ProviderEvent>`。两个实现：

- `OpenAICompatProvider`：POST `/chat/completions`，`stream: true`，手写 SSE 解析（不引入 SDK，方便替换任意兼容端点），支持 `tools` 与 `tool_calls` 增量拼接。
- `MockProvider`：本地规则生成，但**同样产出 `text.delta` 与 `tool_call` 事件**——这是它能验证整条链路的原因。

> Mock 不是摆设。它让 CI、演示、离线开发都能真实触发工具执行与记忆写入，只是文本由模板生成。

### 4.4 prompt.ts — System prompt 组装

按固定顺序拼接：身份设定 → 工作区上下文 → 激活技能的指令 → 记忆片段 → 知识片段 → 行为准则。顺序有意为之：**身份最稳定，检索结果最易变**，把易变的放后面，缓存命中率更高。

### 4.5 runtime.ts — 多步推理循环

```
run(opts):
  emit run.start
  skills ← resolveSkills(input, skillKey)          # 显式指定优先，否则触发词
  emit skill.active
  memories ← memory.recall(query)                   # 端口，失败不阻断
  emit memory.recall
  messages ← [system(buildSystemPrompt), ...history, user]
  for step in 1..maxSteps(=6):
    emit step.start
    stream ← provider.chat(messages, tools)
    for ev of stream:
      text.delta → emit；tool_call → 收集
    if 没有 tool_call: break                        # 正常收敛
    for call of toolCalls:
      emit tool.start
      result ← toolRegistry.execute(call)
      emit tool.end
      messages.push(tool result)
  否则若达到 maxSteps：追加一条"请基于已有信息作答"的收尾提示
  emit message.end, run.end
```

三个细节值得说明：

1. **取消**：外部 `AbortSignal` 与内部 `AbortController` 级联，Provider 的读流循环与工具执行都会 `throwIfAborted`，`run.end` 标记为 `cancelled`。
2. **失败不致命**：记忆召回、知识检索抛错只记日志，不中断对话——检索是增强，不是前置条件。
3. **兜底轮**：达到 `maxSteps` 仍在调工具时，注入一条系统提示要求收敛，避免「无限调工具」把 token 烧光。

---

## 5. 数据模型

15 张表，全部在 `packages/server/src/db/index.ts` 里以 `CREATE TABLE IF NOT EXISTS` 定义，启动即建，可重复执行。

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `roles` | `key`, `permissions`(JSON), `is_builtin` | 角色与权限点；内置角色不可删 |
| `users` | `email`, `password_hash`, `role_id`, `locale`, `theme`, `status` | 账号；密码 scrypt 加盐 |
| `api_keys` | `key_hash`, `prefix`, `scopes`(JSON), `last_used_at` | 对外 MCP 的凭据，只存哈希 |
| `sessions` | `user_id`, `title`, `kind`, `ref_id`, `pinned`, `share_token`, `share_expires_at` | 会话；`kind` 区分 chat / schedule，`share_token` 支撑只读分享 |
| `messages` | `session_id`, `role`, `content`, `parts`(JSON), `usage`(JSON) | 消息；`parts` 存工具调用片段 |
| `memories` | `user_id`, `kind`, `scope`, `content`, `embedding`(JSON), `importance` | 记忆；`embedding` 独立列便于换模型 |
| `skills` | `key`, `instructions`, `triggers`(JSON), `resources`(JSON), `tools`(JSON) | 技能 |
| `knowledge_bases` | `name`, `description` | 知识库 |
| `documents` | `kb_id`, `name`, `content`, `size`, `chunks` | 文档原文 |
| `chunks` | `doc_id`, `kb_id`, `content`, `embedding`, `ord` | 分块，检索单位 |
| `mcp_servers` | `name`, `url`, `transport`, `headers`(JSON), `status`, `tools`(JSON) | 外部 MCP 连接 |
| `schedules` | `cron`, `timezone`, `prompt`, `session_id`, `enabled`, `next_run_at` | 定时任务 |
| `runs` | `status`, `steps`, `tool_calls`, `tokens`, `duration_ms`, `error` | 每次 Agent 运行的记录 |
| `audit_logs` | `user_id`, `action`, `target`, `meta`(JSON), `ip` | 审计 |
| `settings` | `key`, `value` | 平台级配置（键值） |

索引覆盖高频查询路径：`messages(session_id, created_at)`、`memories(user_id, created_at)`、`chunks(kb_id)`、`sessions(user_id, updated_at)`、`audit_logs(created_at)`、`runs(started_at)`。

SQLite 开启 WAL，读写不互相阻塞；`better-sqlite3` 的同步 API 让事务代码保持线性（不需要 async/await 编排），这对一个自托管单实例产品是划算的。

---

## 6. 记忆系统

### 6.1 五种记忆

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `fact` | 客观事实 | 「发布窗口是每周四 20:00」 |
| `preference` | 个人偏好 | 「回答要结论先行，不要客套」 |
| `episode` | 发生过的事 | 「上周三排查过一次网关 502」 |
| `procedure` | 流程步骤 | 「提测需要先跑 smoke 套件」 |
| `entity` | 实体档案 | 「order-service 归属于交易团队」 |

类型不是装饰：前端按类型筛选，Agent 在召回时也能按类型裁剪（例如写周报时只取 `episode`）。

### 6.2 写入：先查重

```ts
// services/memory.ts
const recent = 最近 300 条;
if (存在 content 完全相同) return { deduped: true, ... };
if (max cosine(vec, recentVec) > 0.94) 更新该条的 updated_at / importance;
else 插入新记忆
```

「复读机效应」是多轮 Agent 最常见的退化方式：用户说一句，Agent 就写一条「用户喜欢 X」。查重让记忆量随使用时间保持线性而不是爆炸。

### 6.3 召回：混合打分

```
score = 0.62 × lexicalScore(query, content)
      + 0.30 × cosine(embed(query), embedding)
      + 0.08 × importance
```

- `lexicalScore`：中英文分词 + 中文 bigram，`1 + log(tf)` 抑制高频词，短语完全命中加 0.35，Markdown 标题命中再加最多 0.22。
- 向量：128 维哈希向量（token → 维度桶，权重按出现次数归一），余弦相似度。
- `importance`：0~1，默认 0.6，用户可手动调整，Agent 写入时可自评。

召回时扫描最近 800 条，过滤 `score < 0.05`，取 Top-N（默认 5），并回写 `last_used_at` 供后续做「记忆衰减」策略。

> 为什么权重是 0.62/0.30/0.08？词法对精确术语（服务名、内部黑话）几乎不会错，向量负责同义泛化，重要度只做微调。经验值来自演示语料的调参，代码里是一处常量，方便按业务替换。

---

## 7. 知识库

### 7.1 分块：按标题切，按长度兜底

```
原文 → 按 Markdown 标题切 section
     → section ≤ 480 字：整块保留（过短的并入上一块）
     → section > 480 字：按段落切，子块前加回章节标题
                        → 段落仍超长：按句子切，带 60 字重叠
```

保留章节标题是刻意的：一个 chunk 只有「第 3 步：合并 PR 并打 tag」时，检索很难判断它属于哪个主题；补上 `## 发布流程` 就完全不同。

### 7.2 检索

全量扫描 chunk（上限 4000，足够单实例规模），逐条计算与记忆相同的混合分，`score > 0.08` 才返回，结果带 `docName` / `kbName` / `score`，前端展示出处。

实测效果（内置演示语料）：

| 查询 | Top-1 | 得分 |
| --- | --- | --- |
| 发布流程 | 《团队协作规范 · 发布》 | 0.43 |
| 周会 | 《团队协作规范 · 沟通》 | 0.73 |
| 密码策略 | 《信息安全规范 · 账号与密码》 | 0.52 |

### 7.3 为什么不用向量库

单实例、万级 chunk 的场景里，暴力扫描 + 混合打分的延迟在 10ms 量级，引入 Qdrant / pgvector 只会增加部署负担。但接口留好了：`chunks.embedding` 是独立列，`searchKnowledge()` 是唯一检索入口，换实现只改一个函数。

---

## 8. 技能系统

### 8.1 技能是什么

```json
{
  "key": "research",
  "name": "深度调研",
  "triggers": ["调研", "竞品", "research"],
  "instructions": "1. 先拆解为 3-5 个子问题\n2. 每个子问题检索知识库...",
  "resources": [{ "name": "调研模板", "content": "..." }],
  "tools": ["knowledge_search"]
}
```

技能 = **触发词** + **指令** + **参考资料** + **依赖工具**。它不是代码插件，而是「怎么干这件事」的说明书——模型读到就会做，读不到就做不好。

### 8.2 渐进式披露（Progressive Disclosure）

一个平台装 20 个技能时，把所有指令塞进 system prompt 会带来两个问题：token 成本线性上升、指令之间互相干扰。

TinyBuddy 的做法：

1. `resolveSkills(input)` 用触发词匹配，只有命中的技能才把 `instructions` 注入 system prompt；
2. `resources` **完全不注入**，模型需要时调用 `skill_read(skill_key, resource_name)` 读取；
3. 前端「技能」页可显式指定某个技能，用于调试。

这让 prompt 大小与「本次实际用到的技能数」成正比，而不是与「平台技能总数」成正比。

---

## 9. MCP 双向通道

### 9.1 作为客户端

`services/mcp.ts` 维护一个连接池：

```
connect(server) → Client + StreamableHTTPClientTransport / SSEClientTransport
                → client.listTools()
                → 缓存到 mcp_servers.tools
                → 注册为 mcp__<serverKey>__<toolName> 到 ToolRegistry
```

调用时走 `client.callTool()`，结果统一包装成 `ToolResult`。连接失败不阻塞其他工具，只把该 server 标记为 `error`。

### 9.2 作为服务端

`services/mcpServer.ts` 每个请求新建一个 `McpServer` + `StreamableHTTPServerTransport`（stateless 模式），注册 10 个工具：

`whoami`、`memory_search`、`memory_list`、`memory_write`、`knowledge_search`、`knowledge_list`、`skill_list`、`chat`、`schedule_list`、`schedule_create`。

无状态的好处：任何实例都能处理任何请求，天然水平扩展；代价是不支持服务端主动推送（MCP 的 sampling / notification 能力受限）。

鉴权在传输层之前完成：`Authorization: Bearer tb_xxx` → 查 `api_keys`（比对哈希）→ 还原「用户 + scopes」→ 每次工具调用前用 `hasPermission` 再校验一次。

### 9.3 路由共存

`POST /mcp` 与 `POST /api/mcp` 都指向 MCP 处理器；`GET /mcp` 只有在 `Accept: text/event-stream` 时才按 MCP 处理，否则交给 SPA 路由——这样浏览器里 `/mcp` 页面和 MCP 协议端点可以共用路径，不需要给用户解释「为什么访问页面会报错」。

---

## 10. 调度器

`services/scheduler.ts` 每 30 秒扫描一次 `schedules`：

```
for task of schedules where enabled and next_run_at <= now:
    mark running
    session ← task.session_id ?? 新建会话
    runAgent({ userId: task.created_by, input: task.prompt, sessionId: session })
    next_run_at ← 由 cron 表达式推算下一次
    last_run_at / last_status 更新
```

三个设计决定：

1. **以创建者身份运行**：权限、记忆、知识库范围都跟人一致，不会出现「机器人的记忆是空的」这种割裂。
2. **结果落会话**：用户打开网页就能看到它做了什么，而不是去翻日志文件。
3. **进程内轮询**：实现简单、无外部依赖；多实例时会重复触发，因此生产多副本需要换成分布式锁或独立 worker（见限制）。

cron 解析在 `lib/cron.ts`，支持标准 5 段表达式（`* / , - `），带时区偏移计算。

---

## 11. 权限与安全

### 11.1 判定链

```
JWT (HS256, 7 天)
  → 解出 userId → 查 users + roles
  → 得到 permissions[]（role.permissions，["*"] 表示全量）
  → requirePermission("memory:write")
       ├─ 用户权限含该点 或 含 "*" → 放行
       └─ 否则 403 { error: { code: "forbidden" } }
```

`hasPermission()` 在 `shared/src/rbac.ts`，前后端同一份。前端 `useAuth().can("mcp:write")` 决定按钮是否渲染；后端中间件独立校验。**永远不要因为前端藏了按钮就省掉后端校验。**

### 11.2 API Key 的二次收窄

对外 MCP 用 API Key，Key 上可挂 `scopes`（权限点子集）。实际权限 = `user.permissions ∩ key.scopes`，Key 为空表示继承用户全部权限。这样「给外部系统的 Key」永远不可能比「人」权限更大。

Key 只存 `sha256` 哈希与 8 位前缀用于展示，明文仅在创建时返回一次。

### 11.3 其他安全措施

| 项 | 做法 |
| --- | --- |
| 密码 | `scrypt` + 随机盐，恒定时间比较 |
| 注入 | 全部 SQL 使用参数化查询；`parseBody/parseQuery` 用 Zod 校验并裁剪 |
| XSS | Markdown 渲染走 `react-markdown`，不开 `dangerouslySetInnerHTML` |
| 审计 | 登录、成员变更、Key 创建/删除、MCP 连接、定时任务触发全部落 `audit_logs` |
| 越权 | 所有资源查询带 `user_id = ?`，即使是管理员也只能改自己的记忆（跨用户靠角色与显式接口） |

---

## 12. 前端架构

```
apps/web/src
├── lib/
│   ├── api.ts       # fetch 封装：token 注入、错误归一、401 自动登出
│   ├── sse.ts       # POST + ReadableStream 解析 SSE（EventSource 不支持自定义头）
│   ├── i18n.tsx     # 文案字典 + Provider + useI18n
│   ├── theme.tsx    # light / dark / system，localStorage + prefers-color-scheme
│   ├── auth.tsx     # 用户上下文 + can() 权限判定
│   └── toast.tsx    # 轻量提示
├── components/
│   ├── Layout.tsx   # 侧栏（≥lg）+ 底部导航（<lg），MoreSheet 收纳次级入口
│   └── ui.tsx       # Button / Card / Modal / Sheet / Field / Empty / Tabs
└── pages/           # 9 个页面
```

### 12.1 移动端优先

- 断点策略：`< lg` 视为移动端，隐藏侧栏，启用底部 Tab（对话 / 记忆 / 知识 / MCP + 更多）。
- 安全区：`env(safe-area-inset-bottom)` 处理 iPhone 底部横条。
- 触摸目标 ≥ 40px；hover-only 的删除按钮在移动端常显。
- 输入框 `font-size ≥ 16px`，避免 iOS 聚焦自动缩放。

### 12.2 流式渲染

`EventSource` 不支持自定义请求头（没法带 JWT），所以用 `fetch` + `ReadableStream` 手写解析：

```ts
const reader = res.body.getReader();
// 按 \n\n 切帧 → 取 data: 行 → JSON.parse → 按 type 分发
```

对话页把事件映射为 UI 状态：`text.delta` 追加到气泡，`tool.start` 插入一张「正在调用 memory_search」的折叠卡片，`tool.end` 变绿并显示耗时，`run.end` 收尾并刷新会话列表。

### 12.3 i18n 与主题

文案字典是纯 TS 对象（`locales.ts`），`t()` 支持 `{n}` 占位。语言与主题选择写入用户 profile（服务端持久化），同时镜像到 localStorage 以避免首屏闪烁；`<html class="dark">` 由 ThemeProvider 同步。

---

## 13. 扩展点

| 想扩展 | 改哪里 |
| --- | --- |
| 换模型供应商 | 实现 `LlmProvider`（约 80 行），或只改 `.env` 的三项 |
| 换数据库 | 改 `db/` + `services/`，`dsh` 与 `web` 不动 |
| 加平台工具 | `services/agent.ts` 的 `buildPlatformTools()`，前端自动出现在工具列表 |
| 加 MCP 对外工具 | `services/mcpServer.ts`，`registerTool` 一次即可 |
| 加技能 | 页面创建，或写进 `db/seed.ts` 作为内置技能 |
| 加页面 | `apps/web/src/pages/` + `App.tsx` 路由 + `locales.ts` 文案 + `NAV_ITEMS` |
| 换向量方案 | 替换 `lib/text.ts` 的 `embed()` 与 `services/knowledge.ts` 的 `searchKnowledge()` |

---

## 14. 已知限制与演进方向

| 限制 | 影响 | 演进方向 |
| --- | --- | --- |
| 文档仅支持纯文本 | PDF/Word 需先转换 | 接入 `pdf-parse` / `mammoth`，或加 OCR |
| 哈希向量语义弱 | 同义词泛化不如真 embedding | `embedding` 列已就绪，换 API 即可；再上 pgvector |
| 调度为进程内轮询 | 多实例会重复触发 | Redis 分布式锁或独立 scheduler worker |
| 无流式工具进度 | 长工具调用只有「运行中」 | 工具内 `ctx.emit(progress)`，事件通道已预留 |
| MCP 无 OAuth | 第三方授权体验一般 | 接入 OAuth 2.1 + DCR，符合 MCP 授权规范 |
| 单租户 | 一个部署一套人 | `users.org_id` + 行级隔离 |

这些都不影响「一个人跑起来用」，但会决定它能不能长成一个真正的团队基础设施。
