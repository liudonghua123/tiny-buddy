# MCP 接入指南

> TinyBuddy 同时扮演 MCP 的**两端**：既能连接外部 MCP 服务把工具借给 Agent 用，也能把平台能力以标准 MCP 服务对外开放。本文覆盖这两条链路。

## 目录

- [1. 两条链路](#1-两条链路)
- [2. 作为客户端：接入外部 MCP](#2-作为客户端接入外部-mcp)
- [3. 作为服务端：对外开放](#3-作为服务端对外开放)
- [4. 工具清单](#4-工具清单)
- [5. 客户端配置示例](#5-客户端配置示例)
- [6. 鉴权与权限收窄](#6-鉴权与权限收窄)
- [7. 实现说明](#7-实现说明)
- [8. 端到端自测](#8-端到端自测)
- [9. 排错](#9-排错)

---

## 1. 两条链路

```
外部 MCP 服务  ──工具──▶  Agent 工具箱  ──▶  模型
                                   ▲
                                   │
你的 MCP 客户端 ──平台工具（记忆/知识/技能/对话/定时）──┘
```

- **入站（客户端）**：在「MCP → 连接」里添加服务，工具以 `mcp__<server>__<tool>` 注册，模型可直接调用。
- **出站（服务端）**：在「MCP → 服务端」生成 API Key，任何 MCP 客户端都能通过 `POST /api/mcp` 使用平台能力。

---

## 2. 作为客户端：接入外部 MCP

### 2.1 添加连接

```http
POST /api/mcp/servers
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "name": "filesystem",
  "url": "http://localhost:3001/mcp",
  "transport": "http",
  "headers": { "Authorization": "Bearer xxx" }
}
```

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名，同时用于工具命名空间（会转成合法标识符） |
| `url` | MCP 服务地址 |
| `transport` | `http`（Streamable HTTP，推荐）或 `sse`（旧版 HTTP+SSE） |
| `headers` | 透传给外部服务的请求头，常用于鉴权 |

### 2.2 连接过程

1. 建立传输层连接；
2. 调用 `initialize` 完成协议握手（当前协商版本 `2025-06-18`）；
3. 调用 `tools/list` 拉取工具，缓存到 `mcp_servers.tools`；
4. 每个工具注册到 `ToolRegistry`，名字为 `mcp__<server>__<tool>`，`source = "mcp"`；
5. 失败则标记该 server `status = "error"`，不影响其他连接。

### 2.3 调用与调试

- 模型侧：自动出现在工具列表里，无需额外配置；
- 人工调试：`POST /api/mcp/servers/:id/call`，body `{ "tool": "...", "arguments": {...} }`；
- 工具变更后：`POST /api/mcp/servers/:id/sync` 重新发现。

> 如果外部服务需要长时间初始化，首次连接可能较慢；连接是懒加载的，超时不会阻塞页面渲染。

---

## 3. 作为服务端：对外开放

### 3.1 生成 API Key

在「MCP → 服务端」点击生成，或：

```http
POST /api/keys
{ "name": "Claude Desktop", "scopes": ["memory:read", "knowledge:read", "agent:run"] }
```

返回的 `key`（`tb_...`）**只显示一次**，请立即保存。`scopes` 留空表示继承用户全部权限。

### 3.2 端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/mcp` | POST | 推荐地址 |
| `/mcp` | POST | 短地址，等价 |

`GET /mcp` 在 `Accept: text/event-stream` 时返回 405（本实现为无状态模式，不提供 SSE 长连接）；普通浏览器访问会落到前端页面。

### 3.3 协议交互（裸 JSON-RPC）

无状态模式下，每条请求都独立携带鉴权与 body：

```bash
KEY=tb_xxxxxxxx
BASE=https://your-domain.com

# 初始化
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 列出工具
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 调用工具
curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"发布日期","limit":3}}}'
```

---

## 4. 工具清单

| 工具 | 参数 | 返回 | 所需权限 |
| --- | --- | --- | --- |
| `whoami` | — | 用户、角色、权限、scopes | — |
| `memory_search` | `query`, `limit?` | 记忆片段 + 得分 | `memory:read` |
| `memory_write` | `content`, `kind?`, `importance?`, `tags?` | `{ ok, deduped, memory }` | `memory:write` |
| `memory_list` | `page?`, `pageSize?` | `{ items, total }` | `memory:read` |
| `knowledge_search` | `query`, `limit?`, `kb_ids?` | 片段 + 文档名 + 得分 | `knowledge:read` |
| `knowledge_list` | — | 知识库与文档数 | `knowledge:read` |
| `skill_list` | `only_enabled?` | 技能概要 | `skill:read` |
| `chat` | `message`, `session_id?`, `skill_key?` | 最终回答文本 | `agent:run` |
| `schedule_list` | — | 定时任务列表 | `schedule:read` |
| `schedule_create` | `name`, `prompt`, `cron`, `timezone?` | `{ ok, schedule }` | `schedule:write` |

`chat` 是最有威力的一个：它会让平台 Agent 走完整的「记忆召回 → 技能激活 → 多步工具调用」，然后把最终文本返回给调用方。传 `session_id` 可以跨多次 MCP 调用保持上下文。

---

## 5. 客户端配置示例

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "tiny-buddy": {
      "type": "http",
      "url": "https://your-domain.com/api/mcp",
      "headers": { "Authorization": "Bearer tb_xxxxxxxxxxxx" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "tiny-buddy": {
      "url": "https://your-domain.com/api/mcp",
      "headers": { "Authorization": "Bearer tb_xxxxxxxxxxxx" }
    }
  }
}
```

### 其他 SDK 客户端

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("https://your-domain.com/api/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.TB_KEY}` } },
});

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({ name: "chat", arguments: { message: "总结一下本周进展" } });
```

---

## 6. 鉴权与权限收窄

```
Authorization: Bearer tb_...  →  sha256 比对 api_keys.key_hash
                              →  取 user + scopes
                              →  每次工具调用：user.permissions ∩ scopes
```

规则：

- Key 只存哈希 + 8 位前缀，明文仅创建时返回一次；
- `scopes` 为空 → 继承用户全部权限；
- `scopes` 非空 → 实际权限取**交集**，Key 永远不会比人权限更大；
- 缺权限时返回 `isError: true` 与类似 `缺少权限：memory:write` 的文本，而不是协议错误——这样模型能读懂并解释给用户。

`whoami` 可以用来验证权限是否符合预期：

```json
{
  "id": "usr_mvxftqygtc9s14",
  "name": "林小满",
  "role": "owner",
  "permissions": ["*"],
  "scopes": "inherit"
}
```

---

## 7. 实现说明

- **无状态**：每个 HTTP 请求新建 `McpServer` + `StreamableHTTPServerTransport`（`sessionIdGenerator: undefined`），请求结束即 `close()`。好处是任意实例都能处理任意请求，天然支持水平扩容与 serverless；代价是无法做服务端主动推送。
- **路由共存**：`POST /api/mcp` 在管理路由（`/api/mcp/servers` 等）之前注册，避免被 Router 先吃掉；`GET /mcp` 用 `Accept` 头区分协议请求与页面请求。
- **错误策略**：工具内部异常包装成 `{ isError: true, content: [...] }`，而不是让 JSON-RPC 返回 error，保证客户端能拿到可读文本。
- **审计**：每次通过 API Key 触发的 `chat` 都会带 `kind: "mcp"` 写入 runs 与 audit。

---

## 8. 端到端自测

仓库自带脚本，用官方 SDK 作为客户端连自己的服务：

```bash
pnpm --filter @tiny-buddy/server exec tsx scripts/test-mcp.ts
```

输出示例：

```
API key: tb_Rt_XYE-vPhK...
✓ connected, server = { name: 'tiny-buddy', version: '0.1.0' }
✓ tools: whoami, memory_search, memory_write, memory_list, knowledge_search,
         knowledge_list, skill_list, chat, schedule_list, schedule_create

→ whoami({})
   { "id": "usr_...", "name": "林小满", "role": "owner", "permissions": ["*"], "scopes": "inherit" }
→ memory_search({"query":"回答偏好","limit":3})
   [ { "content": "用户偏好简洁、结论先行的中文回答…", "score": 0.382, "kind": "preference" } ]
→ knowledge_search({"query":"发布流程","limit":2})
   [ { "content": "## 发布\n- 每周四下午发布…", "docName": "团队协作规范.md", "score": 0.431 } ]
→ chat({"message":"用一句话说明你能做什么"})
   我理解你的问题是「用一句话说明你能做什么」…
✓ all MCP calls passed
```

脚本会自己创建临时 API Key 并在结束后吊销。

---

## 9. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `401 unauthorized` | Key 错误 / 已吊销 / 没带 `Authorization` | 重新生成 Key，确认 `Bearer` 前缀 |
| `405` 且提示不支持 SSE | 客户端尝试 `GET` 建立长连接 | 使用 `POST` + Streamable HTTP |
| `tools/list` 为空 | Key scopes 过窄 | 检查 scopes，或用 `whoami` 验证 |
| 连接外部服务超时 | 网络 / 目标未启动 / 需要鉴权头 | 用 `/servers/:id/call` 单独调试 |
| 工具名冲突 | 同名 server 被添加两次 | 删掉旧的再建，工具前缀含 server 标识 |
| 中文乱码 | 客户端未按 UTF-8 解析 | 确认 `Content-Type: application/json; charset=utf-8` |

---

更多内容见 [API.md](./API.md)（REST 接口）与 [ARCHITECTURE.md](./ARCHITECTURE.md)（MCP 双向的内部实现）。
