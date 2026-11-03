# API 参考

> 所有接口以 `/api` 为前缀，请求与响应均为 JSON（SSE 除外）。客户端实现可参考 [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)。

## 目录

- [约定](#约定)
- [鉴权](#鉴权)
- [会话与对话](#会话与对话)
- [SSE 事件流](#sse-事件流)
- [记忆](#记忆)
- [技能](#技能)
- [知识库](#知识库)
- [MCP](#mcp)
- [定时任务](#定时任务)
- [API Key](#api-key)
- [成员与角色](#成员与角色)
- [平台](#平台)
- [错误码](#错误码)

---

## 约定

| 项 | 说明 |
| --- | --- |
| Base URL | 开发 `http://localhost:8787`，生产为你的域名 |
| 认证 | `Authorization: Bearer <JWT>`，除登录/注册/健康检查外全部需要 |
| 时间 | ISO 8601 字符串（`2025-11-01T07:03:24.402Z`） |
| 分页 | `?page=1&pageSize=30`，返回 `{ items, total, page, pageSize }` |
| 错误 | `{ "error": { "code": "forbidden", "message": "无权访问", "details": {} } }` |
| 权限 | 每个端点标注所需权限点，缺权限返回 `403 forbidden` |

---

## 鉴权

### 登录

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@tinybuddy.dev", "password": "admin123456" }
```

```json
{ "token": "eyJhbGciOi...", "user": { "id": "usr_x", "email": "...", "role": {...} } }
```

### 注册

```http
POST /api/auth/register

{ "email": "new@team.dev", "password": "至少8位", "name": "新同事" }
```

受 `ALLOW_REGISTER` 控制，关闭时返回 `403 register_disabled`。

### 当前用户

```http
GET /api/auth/me
```

返回用户、角色与**展开后的权限点数组**，前端据此渲染菜单。

### 更新资料 / 改密码

```http
PATCH /api/auth/profile     { "name": "张三", "locale": "en", "theme": "dark" }
POST  /api/auth/change-password  { "currentPassword": "...", "newPassword": "..." }
```

`locale` 只接受 `zh` / `en`，`theme` 只接受 `light` / `dark` / `system`。

---

## 会话与对话

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/sessions` | `agent:run` | 会话列表（置顶优先，其余按更新时间倒序） |
| POST | `/api/sessions` | `agent:run` | 新建会话 `{ title?, skillKey? }` |
| GET | `/api/sessions/:id` | `agent:run` | 会话详情（含消息） |
| PATCH | `/api/sessions/:id` | `agent:run` | 重命名 / 绑定技能 / 置顶 `{ title?, skillKey?, pinned? }` |
| DELETE | `/api/sessions/:id` | `agent:run` | 删除（连带消息与该会话的运行记录） |
| POST | `/api/sessions/bulk-delete` | `agent:run` | 批量删除 `{ ids: string[] }`，最多 100 条 |
| POST | `/api/sessions/:id/messages` | `agent:run` | **发送消息，返回 SSE 流** |
| POST | `/api/sessions/:id/regenerate` | `agent:run` | 重新生成最后一条回答（复用原提问） |
| POST | `/api/sessions/:id/messages/:messageId/retry` | `agent:run` | 编辑提问并重发 `{ content }`，丢弃其后的回答 |
| GET | `/api/sessions/:id/share` | `agent:run` | 查询分享状态 `{ active, token, path, expiresAt, viewCount }` |
| POST | `/api/sessions/:id/share` | `session:share` | 生成 / 续期分享链接 `{ expiresInDays?: 0\|1\|7\|30\|90, rotate?: boolean }` |
| DELETE | `/api/sessions/:id/share` | `session:share` | 撤销分享，链接立即失效 |

### 发送消息

```http
POST /api/sessions/:id/messages
Content-Type: application/json

{ "content": "在知识库中查一下发布流程", "skillKey": null }
```

响应 `text/event-stream`，见下一节。

---

## 会话分享

只读分享：拿到链接的人**无需登录**即可查看这段对话，但不能发消息、看不到工具入参与返回内容。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/sessions/:id/share` | `agent:run` | 当前分享状态；过期的链接按未开启处理 |
| POST | `/api/sessions/:id/share` | `session:share` | `expiresInDays`：0 为长期，上限 90 天；`rotate: true` 换发新 token（旧链接立刻 404） |
| DELETE | `/api/sessions/:id/share` | `session:share` | 撤销并清零浏览计数 |
| GET | `/api/share/:token` | 公开 | 访客读取会话，**无需鉴权**，按 IP 限流 60 次/分钟 |

```json
{
  "token": "DXFM4EebPfx0kQTKiKE3fA",
  "title": "如何接入外部 MCP 工具",
  "ownerName": "林小满",
  "createdAt": "2026-11-02T23:57:59.521Z",
  "updatedAt": "2026-11-03T00:17:06.038Z",
  "expiresAt": "2026-12-03T00:17:06.038Z",
  "messages": [{ "id": "msg_...", "role": "user", "content": "…", "parts": [], "createdAt": "…" }]
}
```

错误码：`404 share_not_found`（不存在或已撤销）、`410 share_expired`（已过期）、`429 rate_limited`。

> 分享页只暴露 `role / content / parts`，工具卡片保留名称与状态，`input` 与 `output` 会被清空。

---

## SSE 事件流

每帧一行 `data: <json>\n\n`，结束时 `data: [DONE]`，另有 `: ping` 心跳。事件类型定义在 [`packages/shared/src/protocol.ts`](../packages/shared/src/protocol.ts)。

| 事件 | 载荷 | 前端用途 |
| --- | --- | --- |
| `run.start` | `runId`, `sessionId`, `model`, `provider` | 建立占位气泡 |
| `skill.active` | `key`, `name`, `icon` | 显示「已激活技能」徽标 |
| `memory.recall` | `items[]`（`id`, `content`, `score`, `kind`） | 展示召回片段（折叠） |
| `step.start` | `step` | 显示第几轮推理 |
| `message.start` | `messageId` | 初始化消息容器 |
| `text.delta` | `messageId`, `delta` | **追加文本** |
| `tool.start` | `toolCallId`, `name`, `title`, `input`, `source` | 插入工具卡片（运行中） |
| `tool.end` | `toolCallId`, `name`, `ok`, `output`, `durationMs`, `source` | 卡片变成功/失败，显示耗时 |
| `memory.write` | `memoryId`, `content` | 提示「已记住」 |
| `message.end` | `messageId`, `message`（完整消息） | 用最终消息替换草稿 |
| `run.end` | `runId`, `status`, `usage`, `durationMs` | 收尾、刷新会话列表 |
| `error` | `message` | 展示错误条 |

客户端示例（浏览器）：

```ts
const res = await fetch(`/api/sessions/${id}/messages`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ content }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const frames = buf.split("\n\n");
  buf = frames.pop() ?? "";
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;                       // ": ping"
    const payload = line.slice(6);
    if (payload === "[DONE]") return;
    const event = JSON.parse(payload);
    // 按 event.type 分发
  }
}
```

> 用 `fetch` 而不是 `EventSource`，因为后者无法携带 `Authorization` 头。

---

## 记忆

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/memories` | `memory:read` | `?q=&kind=&page=&pageSize=` |
| GET | `/api/memories/stats` | `memory:read` | 按类型的数量统计 |
| GET | `/api/memories/search` | `memory:read` | `?q=...&limit=8` 召回测试，返回带 `score` |
| POST | `/api/memories` | `memory:write` | 新增 |
| PATCH | `/api/memories/:id` | `memory:write` | 修改内容 / 类型 / 重要度 / 标签 |
| DELETE | `/api/memories/:id` | `memory:delete` | 删除 |

```http
POST /api/memories
{
  "content": "发布窗口固定为每周四 20:00，需提前一天冻结主干",
  "kind": "fact",
  "importance": 0.8,
  "tags": ["发布", "运维"]
}
```

`kind` ∈ `fact | preference | episode | procedure | entity`，`importance` ∈ `[0,1]`。

写入返回 `{ memory, deduped }`：`deduped: true` 表示命中已有记忆（内容相同或余弦 > 0.94），此时只更新了时间与重要度。

召回示例：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8787/api/memories/search?q=%E5%8F%91%E5%B8%83&limit=3"
```

```json
{ "items": [{ "id": "mem_x", "content": "...", "score": 0.71, "kind": "fact" }] }
```

---

## 技能

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/skills` | `skill:read` | 全部技能（含未启用的） |
| GET | `/api/skills/:key` | `skill:read` | 按 key 查询 |
| POST | `/api/skills` | `skill:write` | 创建，`key` 冲突返回 409 |
| PATCH | `/api/skills/:id` | `skill:write` | 部分更新 |
| DELETE | `/api/skills/:id` | `skill:write` | 删除 |

```http
POST /api/skills
{
  "key": "weekly-report",
  "name": "周报生成",
  "description": "汇总本周进展并生成周报",
  "icon": "📝",
  "triggers": ["周报", "weekly"],
  "instructions": "1. 检索本周 episode 类型记忆\n2. 按「进展/风险/下周计划」组织\n3. 控制在 300 字内",
  "tools": ["memory_search", "knowledge_search"],
  "resources": [{ "name": "周报模板", "content": "## 进展\n## 风险\n## 下周计划" }]
}
```

`key` 只能是小写字母、数字和短横线（2–40 字符）。

---

## 知识库

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/knowledge/bases` | `knowledge:read` | 知识库列表（含文档数与分块数） |
| POST | `/api/knowledge/bases` | `knowledge:write` | 新建 `{ name, description? }` |
| DELETE | `/api/knowledge/bases/:id` | `knowledge:write` | 删除（连带文档与分块） |
| GET | `/api/knowledge/bases/:id/documents` | `knowledge:read` | 文档列表 |
| POST | `/api/knowledge/bases/:id/documents` | `knowledge:write` | 上传文档 |
| DELETE | `/api/knowledge/documents/:id` | `knowledge:write` | 删除文档 |
| GET | `/api/knowledge/search` | `knowledge:read` | `?q=&limit=&kbId=` |

```http
POST /api/knowledge/bases/kb_x/documents
{
  "name": "发布规范.md",
  "content": "# 发布流程\n\n...",
  "mime": "text/markdown"
}
```

入库时自动按 Markdown 标题分块（默认 480 字 / 60 重叠），并计算向量。返回 `{ document: { id, chunks: 12, size: 5231 } }`。

检索示例：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8787/api/knowledge/search?q=%E5%8F%91%E5%B8%83%E6%B5%81%E7%A8%8B&limit=3"
```

```json
{
  "items": [
    {
      "id": "chk_x",
      "content": "## 发布\n\n每周四 20:00 发布...",
      "docName": "团队协作规范.md",
      "kbName": "团队手册",
      "score": 0.431
    }
  ]
}
```

---

## MCP

### 作为客户端的连接管理

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/mcp/servers` | `mcp:read` | 已配置的外部服务 |
| POST | `/api/mcp/servers` | `mcp:write` | 新建并立即连接 |
| PATCH | `/api/mcp/servers/:id` | `mcp:write` | 修改（改完会重连） |
| DELETE | `/api/mcp/servers/:id` | `mcp:write` | 删除并断开 |
| POST | `/api/mcp/servers/:id/sync` | `mcp:write` | 手动重新发现工具 |
| POST | `/api/mcp/servers/:id/call` | `mcp:invoke` | 调试调用 `{ tool, arguments }` |
| GET | `/api/mcp/tools` | `mcp:read` | 所有外部工具汇总 |
| GET | `/api/mcp/stats` | `mcp:read` | 连接数 / 工具数 |

```http
POST /api/mcp/servers
{
  "name": "filesystem",
  "url": "http://localhost:3001/mcp",
  "transport": "http",
  "headers": { "Authorization": "Bearer xxx" }
}
```

`transport` ∈ `http`（Streamable HTTP）| `sse`。连接失败不会抛 500，而是返回 `status: "error"` 与错误信息，便于前端提示而不阻断其他功能。

### 作为服务端的入口

```http
POST /api/mcp      Authorization: Bearer tb_xxxxxxxx
POST /mcp          Authorization: Bearer tb_xxxxxxxx
```

MCP JSON-RPC 端点（Streamable HTTP，无状态）。工具清单与客户端配置见 [MCP.md](./MCP.md)。

---

## 定时任务

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/schedules` | `schedule:read` | 列表（含 `nextRunAt` / `lastStatus`） |
| POST | `/api/schedules` | `schedule:write` | 创建 |
| PATCH | `/api/schedules/:id` | `schedule:write` | 修改 / 启停 |
| DELETE | `/api/schedules/:id` | `schedule:write` | 删除 |
| POST | `/api/schedules/:id/run` | `schedule:write` | 立即执行一次 |

```http
POST /api/schedules
{
  "name": "工作日晨间简报",
  "cron": "0 9 * * 1-5",
  "timezone": "Asia/Shanghai",
  "prompt": "汇总昨天团队进展与今天待办，300 字以内",
  "skillKey": "weekly-report"
}
```

`cron` 为标准 5 段表达式（分 时 日 月 周），支持 `* , - /`。执行时以**创建者身份**运行，结果写入该任务绑定的会话。

立即执行返回 `{ runId, sessionId }`，随后可在会话中查看完整过程。

---

## 用量洞察

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/usage/overview` | `agent:run` | `?days=7\|14\|30&scope=me\|platform`；`scope=platform` 额外需要 `audit:read` |

返回按天补齐的序列（没有数据的日子也会出现，前端可直接画图）：

```json
{
  "range": { "days": 7, "from": "2026-10-28T00:00:00.000Z", "to": "2026-11-03T00:00:00.000Z", "scope": "me" },
  "totals": { "runs": 10, "messages": 40, "sessions": 17, "tokens": 6276, "toolCalls": 13, "successRate": 90, "avgDurationMs": 1200 },
  "series": [{ "date": "2026-11-03", "runs": 4, "messages": 12, "toolCalls": 3, "tokens": 1682, "failed": 0 }],
  "byKind": [{ "kind": "chat", "runs": 7, "tokens": 3174 }],
  "topTools": [{ "name": "knowledge_search", "count": 7, "avgMs": 2 }],
  "topSkills": [{ "key": "writing", "name": "文档写作", "usage": 1 }],
  "recent": [
    { "id": "run_...", "kind": "chat", "status": "success", "input": "根据附件整理发布检查清单", "steps": 2, "toolCalls": 1, "tokens": 505, "durationMs": 1900, "startedAt": "..." }
  ]
}
```

> 日期按**服务器本地时区**切分；`runs.input` 与消息预览都已剥离附件正文。

---

## API Key

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/keys` | `apikey:read` | 列表（只显示前缀） |
| POST | `/api/keys` | `apikey:write` | 创建，**明文仅返回一次** |
| DELETE | `/api/keys/:id` | `apikey:write` | 吊销 |
| GET | `/api/keys/mcp-config` | `apikey:read` | 生成 MCP 客户端配置 JSON |

```http
POST /api/keys
{ "name": "Cursor", "scopes": ["memory:read", "knowledge:read"] }
```

```json
{
  "key": "tb_a1b2c3d4...",
  "apiKey": { "id": "key_x", "prefix": "tb_a1b2c3", "scopes": ["memory:read", "knowledge:read"] }
}
```

`scopes` 为空表示继承该用户全部权限；否则实际权限 = 用户权限 ∩ scopes。

---

## 成员与角色

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/users` | `user:read` | 成员列表 |
| POST | `/api/users` | `user:write` | 新建成员 `{ email, name, password, roleKey }` |
| PATCH | `/api/users/:id` | `user:write` | 改角色 / 姓名 / 密码 / 状态 |
| DELETE | `/api/users/:id` | `user:write` | 删除（不能删自己） |
| GET | `/api/roles` | `user:read` | 角色与权限点清单 |
| POST | `/api/roles` | `role:write` | 自定义角色 `{ key, name, permissions[] }` |
| PATCH | `/api/roles/:id` | `role:write` | 修改（内置角色不可改 key） |
| DELETE | `/api/roles/:id` | `role:write` | 删除（有成员在用则拒绝） |

权限点全量清单见 [`packages/shared/src/rbac.ts`](../packages/shared/src/rbac.ts)，共 23 个。

---

## 平台

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | 健康检查，含 provider 信息 |
| GET | `/api/meta` | 登录 | 平台名称、版本、provider、权限点 |
| GET | `/api/stats` | 登录 | 用户 / 会话 / 记忆 / 知识 / MCP / 技能 / 定时任务统计 |
| GET | `/api/memory/overview` | `memory:read` | 记忆总览（类型分布、最近写入） |
| GET | `/api/admin/audit` | `audit:read` | 审计日志，`?action=&userId=&page=` |
| GET | `/api/admin/runs` | `audit:read` | 运行记录（步数 / token / 耗时 / 状态） |

```json
// GET /api/stats
{
  "users": 4, "sessions": 4, "messages": 8, "memories": 5,
  "runs24h": 2, "tokens24h": 791,
  "knowledgeBases": 1, "documents": 4, "chunks": 16,
  "mcpServers": 0, "mcpTools": 0, "skills": 5, "schedules": 1
}
```

---

## 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `bad_request` | 参数校验失败，`details` 为字段错误 |
| 401 | `unauthorized` | 缺少或无效的 Token |
| 403 | `forbidden` | 缺少权限点 |
| 403 | `register_disabled` | 已关闭自助注册 |
| 404 | `not_found` | 资源不存在 |
| 409 | `duplicate_key` / `conflict` | 唯一键冲突（如技能 key） |
| 429 | `rate_limited` | 触发限流 |
| 500 | `internal_error` | 服务端异常，详见日志 |

错误响应结构固定：

```json
{ "error": { "code": "forbidden", "message": "缺少权限：mcp:write", "details": null } }
```

---

## 附：一条完整的 curl 流程

```bash
BASE=http://localhost:8787

TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@tinybuddy.dev","password":"admin123456"}' | jq -r .token)

# 新建会话
SID=$(curl -s -X POST $BASE/api/sessions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"API 测试"}' | jq -r .session.id)

# 发消息（流式）
curl -N -X POST $BASE/api/sessions/$SID/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"记住：我喜欢简洁的回答"}'

# 检索记忆
curl -s -H "authorization: Bearer $TOKEN" \
  "$BASE/api/memories/search?q=%E7%AE%80%E6%B4%81&limit=3" | jq
```
