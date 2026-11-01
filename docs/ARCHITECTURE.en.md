# Architecture

> This document covers the layering, request flow, core algorithms and extension points. For endpoints see [API.en.md](./API.en.md), for MCP see [MCP.en.md](./MCP.en.md), for deployment see [DEPLOYMENT.en.md](./DEPLOYMENT.en.md).

## Contents

- [1. Design goals](#1-design-goals)
- [2. Packages and dependency direction](#2-packages-and-dependency-direction)
- [3. Anatomy of one conversation](#3-anatomy-of-one-conversation)
- [4. The DSH runtime](#4-the-dsh-runtime)
- [5. Data model](#5-data-model)
- [6. Memory](#6-memory)
- [7. Knowledge base](#7-knowledge-base)
- [8. Skills](#8-skills)
- [9. Bidirectional MCP](#9-bidirectional-mcp)
- [10. Scheduler](#10-scheduler)
- [11. Permissions and security](#11-permissions-and-security)
- [12. Front end](#12-front-end)
- [13. Extension points](#13-extension-points)
- [14. Limitations and roadmap](#14-limitations-and-roadmap)

---

## 1. Design goals

TinyBuddy is not "another chat UI"; it models the AI as a team member. That produces four hard constraints:

| Constraint | How it's met |
| --- | --- |
| **Works offline, demos well** | Built-in `MockProvider` exercises streaming, tool calls and memory writes without an API key |
| **Deployable with zero external services** | SQLite + local hashed vectors + in-process scheduler; one file database, `pnpm start` and you're up |
| **One kernel, three entry points** | Web chat, MCP calls and cron jobs all go through the same `AgentRuntime` |
| **One policy, both sides** | RBAC, event contracts and domain types live in `shared` — exactly one implementation |

The trade-off is deliberate: **letting one person run it in ten minutes matters more than letting a thousand run it in a cluster**. The latter can evolve; the former decides whether anyone starts.

---

## 2. Packages and dependency direction

```
        apps/web  ──────────┐
             │             │
             ▼             ▼
     packages/shared ◄── packages/dsh
             ▲             ▲
             └──── packages/server
```

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@tiny-buddy/shared` | Domain types, RBAC policy, agent event contract, MCP constants | — |
| `@tiny-buddy/dsh` | Reactive runtime: signals, tool registry, provider adapters, multi-step loop | `shared` |
| `@tiny-buddy/server` | HTTP layer, persistence, business services, MCP server | `shared` + `dsh` |
| `@tiny-buddy/web` | React SPA | `shared` |

Dependencies only point **downward**. `dsh` knows nothing about SQLite or Express, which is why it can be lifted into another product unchanged. In return, the service layer talks to the kernel only through ports (`MemoryPort`, `KnowledgePort`, `ToolRegistry`).

---

## 3. Anatomy of one conversation

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as Express
  participant AG as agentService
  participant RT as AgentRuntime
  participant P as Provider
  participant T as Tools

  U->>API: POST /api/sessions/:id/messages (JWT)
  API->>API: requireAuth → requirePermission("agent:run")
  API->>AG: runAgent({ runId, userId, ... })
  AG->>AG: persist user message / create run record
  AG->>RT: runtime.run()
  RT-->>API: run.start
  RT->>RT: resolveSkills(input)
  RT-->>API: skill.active (when matched)
  RT->>AG: memory.recall → port callback
  RT-->>API: memory.recall
  loop up to maxSteps
    RT->>P: chat(messages, tools, stream)
    P-->>RT: text.delta / tool_call
    RT-->>API: text.delta (straight to SSE)
    RT->>T: execute(tool)
    T-->>RT: ToolResult
    RT-->>API: tool.start / tool.end
  end
  RT-->>API: message.end → run.end
  API-->>U: data: {...}\n\n per event
  U<-API: data: [DONE]
```

Notes:

- **SSE framing** — each event is `data: {"type": "...", ...}\n\n`; the stream closes with `data: [DONE]`; a `: ping` comment frame every 15 seconds keeps proxies from idling out.
- **Disconnects** — listen on `res` and abort only when `!res.writableEnded`; listening on `req` misfires because the request body finishes long before the stream does.
- **Persistence timing** — the user message is written before the run starts; the assistant message (including tool-call parts) is written on `message.end`, so a refresh shows the full trace.

---

## 4. The DSH runtime

`packages/dsh/src` is five files, ~900 lines.

### 4.1 reactive.ts — primitives

| Class | Purpose |
| --- | --- |
| `Signal<T>` | Single-value observable (`get` / `set` / `subscribe`) |
| `ReactiveStore<S>` | Object store with `patch()` shallow merge — used for run state and metrics |
| `AsyncQueue<T>` | Turns callback-style streaming into `AsyncIterable` — the output channel of `run()` |
| `Emitter<E>` | Minimal event bus for lifecycle hooks |

`AsyncQueue` is what makes streaming feel natural: the provider pushes deltas in a callback, `run()` consumes them with `for await`, and backpressure is absorbed by the queue instead of hand-rolled promise choreography.

### 4.2 tools.ts — one contract for every tool

```ts
interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  source: "platform" | "mcp" | "skill";
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

Platform tools, MCP tools and skill tools share one registry. `source` lets the UI colour-code "native capability" vs "external MCP", and makes audit entries readable.

### 4.3 provider.ts — model adapters

`LlmProvider` has two members: `name` / `model` and `chat(req): AsyncIterable<ProviderEvent>`. Two implementations:

- `OpenAICompatProvider` — POSTs `/chat/completions` with `stream: true` and parses SSE by hand (no SDK), including `tools` and incremental `tool_calls` assembly.
- `MockProvider` — rule-based, but emits the **same** `text.delta` and `tool_call` events. That's why it validates the real pipeline.

> The mock is not decoration. It makes CI, demos and offline development exercise actual tool execution and memory writes; only the prose is templated.

### 4.4 prompt.ts — system prompt assembly

Fixed order: identity → workspace context → active skill instructions → memory snippets → knowledge snippets → behavioural rules. Stable content first, volatile retrieval last — better cache behaviour and less instruction drift.

### 4.5 runtime.ts — the multi-step loop

```
run(opts):
  emit run.start
  skills ← resolveSkills(input, skillKey)       # explicit key wins, else trigger match
  emit skill.active
  memories ← memory.recall(query)                # port; failure never blocks
  emit memory.recall
  messages ← [system(buildSystemPrompt), ...history, user]
  for step in 1..maxSteps(=6):
    emit step.start
    stream ← provider.chat(messages, tools)
    for ev of stream:
      text.delta → emit; tool_call → collect
    if no tool_call: break                       # converged
    for call of toolCalls:
      emit tool.start
      result ← toolRegistry.execute(call)
      emit tool.end
      messages.push(tool result)
  if still looping at maxSteps: inject "answer with what you have"
  emit message.end, run.end
```

Three details worth calling out:

1. **Cancellation** — the external `AbortSignal` cascades into an internal `AbortController`; provider reads and tool execution both call `throwIfAborted`, and `run.end` reports `cancelled`.
2. **Degrade, don't fail** — memory recall and knowledge search errors are logged, not thrown. Retrieval augments the turn; it isn't a precondition for it.
3. **Forced convergence** — when `maxSteps` is exhausted mid-tool-loop, a system nudge asks the model to answer with what it has, instead of burning tokens forever.

---

## 5. Data model

Fifteen tables, all declared with `CREATE TABLE IF NOT EXISTS` in `packages/server/src/db/index.ts` — created on boot, safe to re-run.

| Table | Key columns | Notes |
| --- | --- | --- |
| `roles` | `key`, `permissions` (JSON), `is_builtin` | Built-in roles cannot be deleted |
| `users` | `email`, `password_hash`, `role_id`, `locale`, `theme`, `status` | scrypt + per-user salt |
| `api_keys` | `key_hash`, `prefix`, `scopes` (JSON), `last_used_at` | Only hashes are stored |
| `sessions` | `user_id`, `title`, `kind`, `ref_id` | `kind` = chat \| schedule |
| `messages` | `session_id`, `role`, `content`, `parts` (JSON), `usage` (JSON) | `parts` holds tool-call segments |
| `memories` | `user_id`, `kind`, `scope`, `content`, `embedding` (JSON), `importance` | Embedding column kept separate on purpose |
| `skills` | `key`, `instructions`, `triggers` (JSON), `resources` (JSON), `tools` (JSON) | Declarative packs |
| `knowledge_bases` | `name`, `description` | Multiple bases supported |
| `documents` | `kb_id`, `name`, `content`, `size`, `chunks` | Raw text |
| `chunks` | `doc_id`, `kb_id`, `content`, `embedding`, `ord` | Retrieval unit |
| `mcp_servers` | `name`, `url`, `transport`, `headers` (JSON), `status`, `tools` (JSON) | External connections |
| `schedules` | `cron`, `timezone`, `prompt`, `session_id`, `enabled`, `next_run_at` | Cron jobs |
| `runs` | `status`, `steps`, `tool_calls`, `tokens`, `duration_ms`, `error` | One row per agent run |
| `audit_logs` | `user_id`, `action`, `target`, `meta` (JSON), `ip` | Audit trail |
| `settings` | `key`, `value` | Platform-level key/value config |

Indexes cover the hot paths: `messages(session_id, created_at)`, `memories(user_id, created_at)`, `chunks(kb_id)`, `sessions(user_id, updated_at)`, `audit_logs(created_at)`, `runs(started_at)`.

SQLite runs in WAL mode; `better-sqlite3`'s synchronous API keeps transaction code linear (no async orchestration), which is the right trade for a self-hosted single instance.

---

## 6. Memory

### 6.1 Five kinds

| Kind | Use | Example |
| --- | --- | --- |
| `fact` | Objective truths | "Release window is Thursday 20:00" |
| `preference` | Personal style | "Lead with the conclusion, skip pleasantries" |
| `episode` | Things that happened | "Debugged a gateway 502 last Wednesday" |
| `procedure` | Step-by-step process | "Run the smoke suite before handing off to QA" |
| `entity` | Entity profiles | "order-service belongs to the trading team" |

Kinds are functional, not cosmetic: the UI filters by them, and the agent can scope recall (e.g. only `episode` when drafting a weekly report).

### 6.2 Writing: dedup first

```ts
// services/memory.ts
const recent = last 300 rows;
if (identical content exists) return { deduped: true, ... };
if (max cosine(vec, recentVec) > 0.94) update that row's updated_at / importance;
else insert
```

"Echo syndrome" is the most common degeneration in long-running agents: the user says something, the agent stores "the user likes X". Dedup keeps memory growth linear in time instead of exponential in repetition.

### 6.3 Recall: hybrid scoring

```
score = 0.62 × lexicalScore(query, content)
      + 0.30 × cosine(embed(query), embedding)
      + 0.08 × importance
```

- `lexicalScore` — Chinese bigrams + latin tokens, `1 + log(tf)` to damp repeated terms, +0.35 for an exact phrase match, up to +0.22 for heading matches.
- Vectors — 128-dimension hashed embeddings (token → bucket, weights normalised by frequency), scored by cosine.
- `importance` — 0..1, default 0.6, editable by the user and self-assessed on write.

Recall scans the latest 800 memories, drops `score < 0.05`, returns top-N (default 5), and writes back `last_used_at` to enable future decay policies.

> Why 0.62 / 0.30 / 0.08? Lexical matching almost never misses precise terms (service names, internal jargon), vectors handle synonym generalisation, importance is a gentle nudge. The constants are tuned against the demo corpus and live in one place, easy to swap per domain.

---

## 7. Knowledge base

### 7.1 Chunking: split on headings, fall back on length

```
text → split into sections at Markdown headings
     → section ≤ 480 chars: keep whole (tiny ones merge upward)
     → section > 480: split by paragraph, prepend the heading to each child
                    → paragraph still too long: split by sentence, 60-char overlap
```

Keeping the heading is deliberate. A chunk that reads "Step 3: merge the PR and tag it" is hard to route; the same chunk prefixed with `## Release process` is trivially routable.

### 7.2 Retrieval

Scans all chunks (capped at 4000 — plenty for a single instance), scores each with the same hybrid formula, keeps `score > 0.08`, and returns `docName` / `kbName` / `score` so the UI can cite sources.

Measured on the seeded corpus:

| Query | Top-1 | Score |
| --- | --- | --- |
| 发布流程 (release process) | 《团队协作规范 · 发布》 | 0.43 |
| 周会 (weekly sync) | 《团队协作规范 · 沟通》 | 0.73 |
| 密码策略 (password policy) | 《信息安全规范 · 账号与密码》 | 0.52 |

### 7.3 Why not a vector database

At single-instance, low-tens-of-thousands-of-chunks scale, brute force plus hybrid scoring lands in the ~10ms range. Adding Qdrant or pgvector would only add deployment burden. The seams are ready though: `chunks.embedding` is its own column and `searchKnowledge()` is the single retrieval entry point.

---

## 8. Skills

### 8.1 What a skill is

```json
{
  "key": "research",
  "name": "Deep research",
  "triggers": ["research", "competitor", "调研"],
  "instructions": "1. Break into 3-5 sub-questions\n2. Search the knowledge base per sub-question...",
  "resources": [{ "name": "Research template", "content": "..." }],
  "tools": ["knowledge_search"]
}
```

A skill is **trigger words** + **instructions** + **reference material** + **required tools**. It is not a code plugin — it is a playbook. The model that reads it performs the task well; the model that doesn't, doesn't.

### 8.2 Progressive disclosure

With twenty skills installed, dumping every instruction into the system prompt costs tokens linearly and lets instructions interfere with each other.

TinyBuddy instead:

1. `resolveSkills(input)` matches triggers — only matched skills inject `instructions`;
2. `resources` are **never** injected; the model calls `skill_read(skill_key, resource_name)` when it actually needs them;
3. The Skills page can force-activate one skill for debugging.

Prompt size then scales with *skills used this turn*, not *skills installed*.

---

## 9. Bidirectional MCP

### 9.1 As a client

`services/mcp.ts` keeps a connection pool:

```
connect(server) → Client + StreamableHTTPClientTransport / SSEClientTransport
                → client.listTools()
                → cache into mcp_servers.tools
                → register as mcp__<serverKey>__<toolName> in the ToolRegistry
```

Calls go through `client.callTool()` and results are normalised into `ToolResult`. A failed connection marks that server `error` without taking down other tools.

### 9.2 As a server

`services/mcpServer.ts` builds a fresh `McpServer` plus `StreamableHTTPServerTransport` per request (stateless mode) and registers ten tools:

`whoami`, `memory_search`, `memory_list`, `memory_write`, `knowledge_search`, `knowledge_list`, `skill_list`, `chat`, `schedule_list`, `schedule_create`.

Stateless means any instance can serve any request — horizontal scaling for free — at the cost of server-initiated push (MCP sampling / notifications).

Auth happens before transport: `Authorization: Bearer tb_xxx` → look up `api_keys` by hash → resolve (user, scopes) → re-check `hasPermission` on every tool invocation.

### 9.3 Path coexistence

`POST /mcp` and `POST /api/mcp` both hit the MCP handler; `GET /mcp` is only treated as MCP when `Accept: text/event-stream`, otherwise it falls through to the SPA router. That way the `/mcp` page and the protocol endpoint can share a path without confusing anyone.

---

## 10. Scheduler

`services/scheduler.ts` ticks every 30 seconds:

```
for task of schedules where enabled and next_run_at <= now:
    mark running
    session ← task.session_id ?? create
    runAgent({ userId: task.created_by, input: task.prompt, sessionId: session })
    next_run_at ← compute from cron expression
    update last_run_at / last_status
```

Three decisions:

1. **Runs as the owner** — permissions, memory and knowledge scope match the human, so the bot never suffers from "empty memory".
2. **Results land in a session** — open the web app and read what happened, instead of tailing logs.
3. **In-process polling** — simple, dependency-free; multiple instances would double-fire, so production replicas need a distributed lock or a dedicated worker.

Cron parsing lives in `lib/cron.ts` and supports standard 5-field expressions (`* / , -`) with timezone offsets.

---

## 11. Permissions and security

### 11.1 The check chain

```
JWT (HS256, 7 days)
  → userId → load user + role
  → permissions[] (["*"] means everything)
  → requirePermission("memory:write")
       ├─ permission present or "*" → next()
       └─ otherwise 403 { error: { code: "forbidden" } }
```

`hasPermission()` lives in `shared/src/rbac.ts` and is shared. The front end uses `useAuth().can("mcp:write")` to decide rendering; the back end validates independently. **Never skip server checks because the button is hidden.**

### 11.2 Narrowing API keys

Keys carry an optional `scopes` subset. Effective permissions = `user.permissions ∩ key.scopes`; an empty scope list inherits everything. A key handed to an external system can therefore never exceed the person's own rights.

Only the `sha256` hash and an 8-character prefix are stored; the plaintext key is shown exactly once at creation.

### 11.3 Other measures

| Area | Measure |
| --- | --- |
| Passwords | `scrypt` + random salt, constant-time comparison |
| Injection | Parameterised SQL everywhere; Zod validation and whitelisting on input |
| XSS | `react-markdown` without `dangerouslySetInnerHTML` |
| Audit | Login, member changes, key create/delete, MCP connections, schedule runs |
| Authorisation | Every query is scoped by `user_id`; admin operations are explicit endpoints |

---

## 12. Front end

```
apps/web/src
├── lib/
│   ├── api.ts       # fetch wrapper: token injection, error normalisation, 401 logout
│   ├── sse.ts       # POST + ReadableStream SSE parsing (EventSource can't send headers)
│   ├── i18n.tsx     # dictionary + provider + useI18n
│   ├── theme.tsx    # light / dark / system, localStorage + prefers-color-scheme
│   ├── auth.tsx     # user context + can() checks
│   └── toast.tsx    # lightweight notifications
├── components/
│   ├── Layout.tsx   # sidebar (≥lg) + bottom nav (<lg), MoreSheet for secondary entries
│   └── ui.tsx       # Button / Card / Modal / Sheet / Field / Empty / Tabs
└── pages/           # nine pages
```

### 12.1 Mobile first

- Breakpoints: `< lg` is mobile — sidebar hidden, bottom tabs enabled (Chat / Memory / Knowledge / MCP / More).
- Safe areas: `env(safe-area-inset-bottom)` for the iPhone home indicator.
- Touch targets ≥ 40px; hover-only delete buttons are always visible on touch devices.
- Inputs use `font-size ≥ 16px` to prevent iOS zoom-on-focus.

### 12.2 Streaming render

`EventSource` cannot send custom headers (no JWT), so the client uses `fetch` + `ReadableStream`:

```ts
const reader = res.body.getReader();
// split frames on \n\n → take `data:` lines → JSON.parse → dispatch by type
```

The chat page maps events to UI state: `text.delta` appends to the bubble, `tool.start` inserts a collapsible "calling memory_search" card, `tool.end` turns it green with a duration, `run.end` finalises and refreshes the session list.

### 12.3 i18n and theme

The dictionary is a plain TS object (`locales.ts`) with `{n}` interpolation. Locale and theme persist to the user profile server-side and mirror into localStorage to avoid first-paint flicker; `<html class="dark">` is kept in sync by the ThemeProvider.

---

## 13. Extension points

| Goal | Where to change |
| --- | --- |
| Swap model vendor | Implement `LlmProvider` (~80 lines) or just set three env vars |
| Swap database | Rewrite `db/` + `services/`; `dsh` and `web` untouched |
| Add a platform tool | `buildPlatformTools()` in `services/agent.ts` |
| Expose a new MCP tool | One `registerTool` call in `services/mcpServer.ts` |
| Add a skill | Create in the UI, or seed it in `db/seed.ts` |
| Add a page | `apps/web/src/pages/` + route in `App.tsx` + strings in `locales.ts` + `NAV_ITEMS` |
| Change the embedding scheme | Replace `embed()` in `lib/text.ts` and `searchKnowledge()` |

---

## 14. Limitations and roadmap

| Limitation | Impact | Direction |
| --- | --- | --- |
| Plain-text ingestion only | PDF/Word must be converted | Add `pdf-parse` / `mammoth`, or OCR |
| Hashed vectors are weak | Synonym generalisation lags real embeddings | `embedding` column is ready; swap in an API, then pgvector |
| In-process scheduler | Multi-instance duplicate firing | Redis lock or standalone scheduler worker |
| No streaming tool progress | Long tools only show "running" | `ctx.emit(progress)`; the event channel already exists |
| No OAuth for MCP | Third-party consent is clunky | OAuth 2.1 + DCR per the MCP auth spec |
| Single tenant | One deployment per team | `users.org_id` plus row-level isolation |

None of these block "one person runs it today". They decide whether it grows into real team infrastructure tomorrow.
