# API Reference

> Every endpoint is served under `/api` and speaks JSON (except SSE). The reference client lives in [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts).

## Contents

- [Conventions](#conventions)
- [Authentication](#authentication)
- [Sessions and chat](#sessions-and-chat)
- [SSE event stream](#sse-event-stream)
- [Memory](#memory)
- [Skills](#skills)
- [Knowledge base](#knowledge-base)
- [MCP](#mcp)
- [Schedules](#schedules)
- [API keys](#api-keys)
- [Members and roles](#members-and-roles)
- [Platform](#platform)
- [Error codes](#error-codes)

---

## Conventions

| Item | Value |
| --- | --- |
| Base URL | `http://localhost:8787` in dev, your domain in production |
| Auth | `Authorization: Bearer <JWT>`; only login/register/health are public |
| Timestamps | ISO 8601 (`2025-11-01T07:03:24.402Z`) |
| Pagination | `?page=1&pageSize=30` → `{ items, total, page, pageSize }` |
| Errors | `{ "error": { "code": "forbidden", "message": "...", "details": {} } }` |
| Permissions | Each endpoint lists its required permission; missing it returns `403 forbidden` |

---

## Authentication

### Login

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@tinybuddy.dev", "password": "admin123456" }
```

```json
{ "token": "eyJhbGciOi...", "user": { "id": "usr_x", "email": "...", "role": { } } }
```

### Register

```http
POST /api/auth/register

{ "email": "new@team.dev", "password": "at-least-8-chars", "name": "New Teammate" }
```

Gated by `ALLOW_REGISTER`; returns `403 register_disabled` when disabled.

### Current user

```http
GET /api/auth/me
```

Returns the user, role and the **flattened permission list** the UI uses to render navigation.

### Profile and password

```http
PATCH /api/auth/profile           { "name": "Zhang", "locale": "en", "theme": "dark" }
POST  /api/auth/change-password   { "currentPassword": "...", "newPassword": "..." }
```

`locale` ∈ `zh | en`; `theme` ∈ `light | dark | system`.

---

## Sessions and chat

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/sessions` | `agent:run` | List sessions, pinned first then newest |
| POST | `/api/sessions` | `agent:run` | Create `{ title?, skillKey? }` |
| GET | `/api/sessions/:id` | `agent:run` | Session detail with messages |
| PATCH | `/api/sessions/:id` | `agent:run` | Rename / bind skill / pin `{ title?, skillKey?, pinned? }` |
| DELETE | `/api/sessions/:id` | `agent:run` | Delete messages and that session's runs |
| POST | `/api/sessions/bulk-delete` | `agent:run` | Bulk delete `{ ids: string[] }`, up to 100 |
| POST | `/api/sessions/:id/messages` | `agent:run` | **Send message, returns SSE** |
| POST | `/api/sessions/:id/regenerate` | `agent:run` | Regenerate the last answer (reuses the question) |
| POST | `/api/sessions/:id/messages/:messageId/retry` | `agent:run` | Edit a question and resend `{ content }`, discarding later answers |

```http
POST /api/sessions/:id/messages
Content-Type: application/json

{ "content": "Search the knowledge base for the release process", "skillKey": null }
```

---

## SSE event stream

Each frame is `data: <json>\n\n`; the stream ends with `data: [DONE]`; `: ping` comment frames act as heartbeats. Types are defined in [`packages/shared/src/protocol.ts`](../packages/shared/src/protocol.ts).

| Event | Payload | Client use |
| --- | --- | --- |
| `run.start` | `runId`, `sessionId`, `model`, `provider` | Create placeholder bubble |
| `skill.active` | `key`, `name`, `icon` | Show activated-skill badge |
| `memory.recall` | `items[]` (`id`, `content`, `score`, `kind`) | Collapsible recall list |
| `step.start` | `step` | Show reasoning step |
| `message.start` | `messageId` | Initialise message container |
| `text.delta` | `messageId`, `delta` | **Append text** |
| `tool.start` | `toolCallId`, `name`, `title`, `input`, `source` | Insert running tool card |
| `tool.end` | `toolCallId`, `name`, `ok`, `output`, `durationMs`, `source` | Card turns green/red + duration |
| `memory.write` | `memoryId`, `content` | "Remembered" hint |
| `message.end` | `messageId`, `message` | Replace draft with final message |
| `run.end` | `runId`, `status`, `usage`, `durationMs` | Finalise, refresh session list |
| `error` | `message` | Error banner |

Browser example:

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
    if (!line) continue;               // ": ping"
    const payload = line.slice(6);
    if (payload === "[DONE]") return;
    const event = JSON.parse(payload); // dispatch by event.type
  }
}
```

> `fetch` instead of `EventSource`, because `EventSource` cannot send an `Authorization` header.

---

## Memory

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/memories` | `memory:read` | `?q=&kind=&page=&pageSize=` |
| GET | `/api/memories/stats` | `memory:read` | Counts per kind |
| GET | `/api/memories/search` | `memory:read` | `?q=&limit=8` recall test, includes `score` |
| POST | `/api/memories` | `memory:write` | Create |
| PATCH | `/api/memories/:id` | `memory:write` | Update content / kind / importance / tags |
| DELETE | `/api/memories/:id` | `memory:delete` | Delete |

```http
POST /api/memories
{
  "content": "Release window is Thursday 20:00; main branch freezes one day before",
  "kind": "fact",
  "importance": 0.8,
  "tags": ["release", "ops"]
}
```

`kind` ∈ `fact | preference | episode | procedure | entity`; `importance` ∈ `[0,1]`.

The response is `{ memory, deduped }` — `deduped: true` means an identical or near-identical memory (cosine > 0.94) was found and only its timestamp and importance were refreshed.

---

## Skills

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/skills` | `skill:read` | All skills, enabled or not |
| GET | `/api/skills/:key` | `skill:read` | Lookup by key |
| POST | `/api/skills` | `skill:write` | Create, 409 on duplicate key |
| PATCH | `/api/skills/:id` | `skill:write` | Partial update |
| DELETE | `/api/skills/:id` | `skill:write` | Delete |

```http
POST /api/skills
{
  "key": "weekly-report",
  "name": "Weekly report",
  "description": "Summarise the week and draft the report",
  "icon": "📝",
  "triggers": ["weekly report", "周报"],
  "instructions": "1. Recall episode memories from this week\n2. Structure as Progress / Risks / Next week\n3. Keep under 300 words",
  "tools": ["memory_search", "knowledge_search"],
  "resources": [{ "name": "Template", "content": "## Progress\n## Risks\n## Next week" }]
}
```

`key` allows lowercase letters, digits and hyphens, 2–40 characters.

---

## Knowledge base

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/knowledge/bases` | `knowledge:read` | Bases with document and chunk counts |
| POST | `/api/knowledge/bases` | `knowledge:write` | Create `{ name, description? }` |
| DELETE | `/api/knowledge/bases/:id` | `knowledge:write` | Delete with documents and chunks |
| GET | `/api/knowledge/bases/:id/documents` | `knowledge:read` | List documents |
| POST | `/api/knowledge/bases/:id/documents` | `knowledge:write` | Upload a document |
| DELETE | `/api/knowledge/documents/:id` | `knowledge:write` | Delete a document |
| GET | `/api/knowledge/search` | `knowledge:read` | `?q=&limit=&kbId=` |

```http
POST /api/knowledge/bases/kb_x/documents
{
  "name": "release.md",
  "content": "# Release process\n\n...",
  "mime": "text/markdown"
}
```

Ingestion chunks on Markdown headings (480 chars / 60 overlap by default) and stores embeddings. Response: `{ document: { id, chunks: 12, size: 5231 } }`.

```json
// GET /api/knowledge/search?q=release&limit=3
{
  "items": [
    {
      "id": "chk_x",
      "content": "## Release\n\nEvery Thursday at 20:00...",
      "docName": "team-handbook.md",
      "kbName": "Team Handbook",
      "score": 0.431
    }
  ]
}
```

---

## MCP

### Client connections

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/mcp/servers` | `mcp:read` | Configured external servers |
| POST | `/api/mcp/servers` | `mcp:write` | Create and connect immediately |
| PATCH | `/api/mcp/servers/:id` | `mcp:write` | Update (reconnects) |
| DELETE | `/api/mcp/servers/:id` | `mcp:write` | Delete and disconnect |
| POST | `/api/mcp/servers/:id/sync` | `mcp:write` | Re-discover tools |
| POST | `/api/mcp/servers/:id/call` | `mcp:invoke` | Debug call `{ tool, arguments }` |
| GET | `/api/mcp/tools` | `mcp:read` | All external tools |
| GET | `/api/mcp/stats` | `mcp:read` | Connection and tool counts |

```http
POST /api/mcp/servers
{
  "name": "filesystem",
  "url": "http://localhost:3001/mcp",
  "transport": "http",
  "headers": { "Authorization": "Bearer xxx" }
}
```

`transport` ∈ `http` (Streamable HTTP) | `sse`. A failed connection returns `status: "error"` with a message rather than a 500, so one broken server can't take down the page.

### Server endpoint

```http
POST /api/mcp      Authorization: Bearer tb_xxxxxxxx
POST /mcp          Authorization: Bearer tb_xxxxxxxx
```

Stateless Streamable HTTP MCP endpoint. Tool list and client config: [MCP.en.md](./MCP.en.md).

---

## Schedules

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/schedules` | `schedule:read` | List with `nextRunAt` / `lastStatus` |
| POST | `/api/schedules` | `schedule:write` | Create |
| PATCH | `/api/schedules/:id` | `schedule:write` | Update or toggle |
| DELETE | `/api/schedules/:id` | `schedule:write` | Delete |
| POST | `/api/schedules/:id/run` | `schedule:write` | Run once now |

```http
POST /api/schedules
{
  "name": "Weekday morning briefing",
  "cron": "0 9 * * 1-5",
  "timezone": "Asia/Shanghai",
  "prompt": "Summarise yesterday's progress and today's tasks in under 300 words",
  "skillKey": "weekly-report"
}
```

`cron` is a standard 5-field expression (`* , - /`). Runs execute **as the task owner** and write into the bound session.

---

## Usage insights

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/usage/overview` | `agent:run` | `?days=7\|14\|30&scope=me\|platform`; `scope=platform` also requires `audit:read` |

The series is zero-filled per day so charts can render it directly:

```json
{
  "range": { "days": 7, "from": "2026-10-28T00:00:00.000Z", "to": "2026-11-03T00:00:00.000Z", "scope": "me" },
  "totals": { "runs": 10, "messages": 40, "sessions": 17, "tokens": 6276, "toolCalls": 13, "successRate": 90, "avgDurationMs": 1200 },
  "series": [{ "date": "2026-11-03", "runs": 4, "messages": 12, "toolCalls": 3, "tokens": 1682, "failed": 0 }],
  "byKind": [{ "kind": "chat", "runs": 7, "tokens": 3174 }],
  "topTools": [{ "name": "knowledge_search", "count": 7, "avgMs": 2 }],
  "topSkills": [{ "key": "writing", "name": "文档写作", "usage": 1 }],
  "recent": [
    { "id": "run_...", "kind": "chat", "status": "success", "input": "Summarise the attached release checklist", "steps": 2, "toolCalls": 1, "tokens": 505, "durationMs": 1900, "startedAt": "..." }
  ]
}
```

> Days are bucketed in the server's local timezone; attachment bodies are stripped from `runs.input` and previews.

---

## API keys

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/keys` | `apikey:read` | List (prefix only) |
| POST | `/api/keys` | `apikey:write` | Create — **plaintext returned once** |
| DELETE | `/api/keys/:id` | `apikey:write` | Revoke |
| GET | `/api/keys/mcp-config` | `apikey:read` | Generate MCP client config JSON |

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

Empty `scopes` inherits the user's full permission set; otherwise effective permissions = user ∩ scopes.

---

## Members and roles

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/users` | `user:read` | List members |
| POST | `/api/users` | `user:write` | Create `{ email, name, password, roleKey }` |
| PATCH | `/api/users/:id` | `user:write` | Role / name / password / status |
| DELETE | `/api/users/:id` | `user:write` | Delete (can't delete yourself) |
| GET | `/api/roles` | `user:read` | Roles and permission catalogue |
| POST | `/api/roles` | `role:write` | Custom role `{ key, name, permissions[] }` |
| PATCH | `/api/roles/:id` | `role:write` | Update (built-in keys are fixed) |
| DELETE | `/api/roles/:id` | `role:write` | Delete (rejected while in use) |

The 22 permissions are defined in [`packages/shared/src/rbac.ts`](../packages/shared/src/rbac.ts).

---

## Platform

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Health check with provider info |
| GET | `/api/meta` | auth | Platform name, version, provider, permissions |
| GET | `/api/stats` | auth | Counts across users, sessions, memory, knowledge, MCP, skills, schedules |
| GET | `/api/memory/overview` | `memory:read` | Memory distribution and recent writes |
| GET | `/api/admin/audit` | `audit:read` | Audit log, `?action=&userId=&page=` |
| GET | `/api/admin/runs` | `audit:read` | Run records (steps / tokens / latency / status) |

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

## Error codes

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Validation failed; `details` lists field errors |
| 401 | `unauthorized` | Missing or invalid token |
| 403 | `forbidden` | Missing permission |
| 403 | `register_disabled` | Self-service signup disabled |
| 404 | `not_found` | Resource missing |
| 409 | `duplicate_key` / `conflict` | Unique constraint (e.g. skill key) |
| 429 | `rate_limited` | Throttled |
| 500 | `internal_error` | Server fault; see logs |

```json
{ "error": { "code": "forbidden", "message": "Missing permission: mcp:write", "details": null } }
```

---

## End-to-end curl

```bash
BASE=http://localhost:8787

TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@tinybuddy.dev","password":"admin123456"}' | jq -r .token)

SID=$(curl -s -X POST $BASE/api/sessions \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"API test"}' | jq -r .session.id)

curl -N -X POST $BASE/api/sessions/$SID/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"Remember: I prefer concise answers"}'

curl -s -H "authorization: Bearer $TOKEN" \
  "$BASE/api/memories/search?q=concise&limit=3" | jq
```
