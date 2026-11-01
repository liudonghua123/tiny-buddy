# MCP Guide

> TinyBuddy sits on **both ends** of MCP: it connects to external MCP servers to lend their tools to the agent, and it exposes its own capabilities as a standard MCP server. This guide covers both directions.

## Contents

- [1. Two directions](#1-two-directions)
- [2. As a client](#2-as-a-client)
- [3. As a server](#3-as-a-server)
- [4. Tool reference](#4-tool-reference)
- [5. Client configuration](#5-client-configuration)
- [6. Auth and scoped keys](#6-auth-and-scoped-keys)
- [7. Implementation notes](#7-implementation-notes)
- [8. End-to-end test](#8-end-to-end-test)
- [9. Troubleshooting](#9-troubleshooting)

---

## 1. Two directions

```
External MCP servers ──tools──▶ Agent toolbox ──▶ model
                                     ▲
                                     │
Your MCP client ──platform tools (memory/knowledge/skills/chat/schedules)──┘
```

- **Inbound (client)** — add servers under "MCP → Connections"; their tools register as `mcp__<server>__<tool>` and become callable by the model.
- **Outbound (server)** — mint an API key under "MCP → Server"; any MCP client can then use the platform via `POST /api/mcp`.

---

## 2. As a client

### 2.1 Add a connection

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

| Field | Description |
| --- | --- |
| `name` | Display name and tool namespace |
| `url` | MCP endpoint |
| `transport` | `http` (Streamable HTTP, recommended) or `sse` (legacy) |
| `headers` | Forwarded to the upstream server, usually for auth |

### 2.2 Connection flow

1. Open the transport.
2. `initialize` handshake (negotiated version `2025-06-18`).
3. `tools/list`, cached into `mcp_servers.tools`.
4. Each tool enters the `ToolRegistry` as `mcp__<server>__<tool>` with `source = "mcp"`.
5. On failure the server is marked `status = "error"` without affecting other connections.

### 2.3 Calling and debugging

- Model side: tools appear automatically, no extra configuration.
- Manual: `POST /api/mcp/servers/:id/call` with `{ "tool": "...", "arguments": {...} }`.
- After an upstream change: `POST /api/mcp/servers/:id/sync`.

---

## 3. As a server

### 3.1 Mint a key

From "MCP → Server", or:

```http
POST /api/keys
{ "name": "Claude Desktop", "scopes": ["memory:read", "knowledge:read", "agent:run"] }
```

The returned `key` (`tb_...`) is shown **once**. An empty `scopes` array inherits all of the user's permissions.

### 3.2 Endpoints

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/mcp` | POST | Recommended |
| `/mcp` | POST | Short alias |

`GET /mcp` returns 405 when `Accept: text/event-stream` (stateless mode, no long-lived SSE); plain browser requests fall through to the SPA.

### 3.3 Raw JSON-RPC

In stateless mode every request carries its own auth and body:

```bash
KEY=tb_xxxxxxxx
BASE=https://your-domain.com

curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -s -X POST $BASE/api/mcp \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"release window","limit":3}}}'
```

---

## 4. Tool reference

| Tool | Arguments | Returns | Permission |
| --- | --- | --- | --- |
| `whoami` | — | User, role, permissions, scopes | — |
| `memory_search` | `query`, `limit?` | Memory hits with scores | `memory:read` |
| `memory_write` | `content`, `kind?`, `importance?`, `tags?` | `{ ok, deduped, memory }` | `memory:write` |
| `memory_list` | `page?`, `pageSize?` | `{ items, total }` | `memory:read` |
| `knowledge_search` | `query`, `limit?`, `kb_ids?` | Chunks with document name and score | `knowledge:read` |
| `knowledge_list` | — | Bases and document counts | `knowledge:read` |
| `skill_list` | `only_enabled?` | Skill summaries | `skill:read` |
| `chat` | `message`, `session_id?`, `skill_key?` | Final answer text | `agent:run` |
| `schedule_list` | — | Schedules | `schedule:read` |
| `schedule_create` | `name`, `prompt`, `cron`, `timezone?` | `{ ok, schedule }` | `schedule:write` |

`chat` is the most powerful one: it runs a full agent turn (memory recall → skill activation → multi-step tool calls) and returns the final text. Pass `session_id` to keep context across successive MCP calls.

---

## 5. Client configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

`~/.cursor/mcp.json`:

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

### SDK clients

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("https://your-domain.com/api/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.TB_KEY}` } },
});

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({ name: "chat", arguments: { message: "Summarise this week" } });
```

---

## 6. Auth and scoped keys

```
Authorization: Bearer tb_...  →  sha256 against api_keys.key_hash
                              →  load user + scopes
                              →  per call: user.permissions ∩ scopes
```

Rules:

- Only the hash and an 8-character prefix are stored; plaintext is returned once.
- Empty `scopes` inherits everything the user has.
- Non-empty `scopes` are **intersected** — a key can never exceed its owner.
- Missing permission returns `isError: true` with text like `缺少权限：memory:write` rather than a protocol error, so the model can read and explain it.

Use `whoami` to verify:

```json
{
  "id": "usr_mvxftqygtc9s14",
  "name": "Lin Xiaoman",
  "role": "owner",
  "permissions": ["*"],
  "scopes": "inherit"
}
```

---

## 7. Implementation notes

- **Stateless** — every HTTP request creates a fresh `McpServer` plus `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`) and closes them when the response ends. Any instance can serve any request, which scales horizontally and suits serverless; the cost is no server-initiated push.
- **Path coexistence** — `POST /api/mcp` is registered before the management router (`/api/mcp/servers` etc.) so the router doesn't swallow it; `GET /mcp` uses the `Accept` header to separate protocol traffic from page requests.
- **Error strategy** — tool failures become `{ isError: true, content: [...] }` rather than JSON-RPC errors, so clients always receive readable text.
- **Audit** — every key-authenticated `chat` writes a run and audit entry tagged `kind: "mcp"`.

---

## 8. End-to-end test

The repo ships a script that connects to this very server with the official SDK:

```bash
pnpm --filter @tiny-buddy/server exec tsx scripts/test-mcp.ts
```

Sample output:

```
API key: tb_Rt_XYE-vPhK...
✓ connected, server = { name: 'tiny-buddy', version: '0.1.0' }
✓ tools: whoami, memory_search, memory_write, memory_list, knowledge_search,
         knowledge_list, skill_list, chat, schedule_list, schedule_create

→ whoami({})
   { "id": "usr_...", "name": "林小满", "role": "owner", "permissions": ["*"], "scopes": "inherit" }
→ knowledge_search({"query":"发布流程","limit":2})
   [ { "content": "## 发布\n- 每周四下午发布…", "docName": "团队协作规范.md", "score": 0.431 } ]
→ chat({"message":"用一句话说明你能做什么"})
   我理解你的问题是…
✓ all MCP calls passed
```

The script creates a temporary API key and revokes it on exit.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 unauthorized` | Bad/revoked key, or missing header | Mint a new key, keep the `Bearer` prefix |
| `405` mentioning SSE | Client opened a long-lived `GET` | Use `POST` + Streamable HTTP |
| `tools/list` empty | Key scopes too narrow | Check scopes; verify with `whoami` |
| Timeout connecting upstream | Network, server down, missing auth header | Debug with `/servers/:id/call` |
| Tool name collision | Same server added twice | Remove the old entry; names are namespaced |
| Mojibake in Chinese | Client not decoding UTF-8 | Ensure `Content-Type: application/json; charset=utf-8` |

---

See also [API.en.md](./API.en.md) for REST endpoints and [ARCHITECTURE.en.md](./ARCHITECTURE.en.md) for how the two directions are implemented internally.
