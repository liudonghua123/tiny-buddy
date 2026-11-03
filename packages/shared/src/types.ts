/** 领域模型（前后端共享） */

export type Locale = "zh" | "en";
export type ThemeMode = "light" | "dark" | "system";

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  color: string;
  isSystem: boolean;
  userCount?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  locale: Locale;
  theme: ThemeMode;
  avatarColor: string;
  createdAt: string;
}

export interface Session {
  id: string;
  title: string;
  agentKey: string;
  skillKey?: string | null;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  preview?: string;
}

export type ToolStatus = "running" | "done" | "error";

export interface ToolCallPart {
  type: "tool";
  id: string;
  name: string;
  title?: string;
  input: Record<string, unknown>;
  output?: string;
  status: ToolStatus;
  durationMs?: number;
  source?: "platform" | "mcp" | "skill";
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface MemoryPart {
  type: "memory";
  items: { id: string; content: string; score?: number; kind?: string }[];
}

export type MessagePart = TextPart | ToolCallPart | MemoryPart;

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts: MessagePart[];
  createdAt: string;
  usage?: Usage | null;
  model?: string | null;
}

export type MemoryScope = "user" | "session" | "global";
export type MemoryKind = "fact" | "preference" | "episode" | "procedure" | "entity";

export interface Memory {
  id: string;
  userId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  tags: string[];
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

export interface Skill {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  instructions: string;
  tools: string[];
  triggers: string[];
  resources: { name: string; content: string }[];
  enabled: boolean;
  builtin: boolean;
  usageCount?: number;
  createdAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  docCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface KbDocument {
  id: string;
  kbId: string;
  name: string;
  mime: string;
  size: number;
  status: "processing" | "ready" | "failed";
  chunks: number;
  createdAt: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  headers: Record<string, string>;
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  tools: McpToolInfo[];
  lastSyncAt?: string | null;
  error?: string | null;
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  skillKey?: string | null;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastStatus?: "success" | "failed" | "running" | null;
  createdBy: string;
  createdAt: string;
}

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export interface Run {
  id: string;
  kind: "chat" | "schedule" | "mcp" | "skill";
  refId?: string | null;
  status: RunStatus;
  input: string;
  output: string;
  steps: number;
  toolCalls: number;
  startedAt: string;
  finishedAt?: string | null;
  usage?: Usage | null;
  error?: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
}

export interface AuditLog {
  id: string;
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
}

export interface PlatformStats {
  users: number;
  sessions: number;
  messages: number;
  memories: number;
  skills: number;
  knowledgeBases: number;
  documents: number;
  mcpServers: number;
  schedules: number;
  runs24h: number;
  tokens24h: number;
}

export interface AgentInfo {
  key: string;
  name: string;
  description: string;
  model: string;
  provider: string;
  tools: { name: string; title: string; description: string; source: string }[];
  skills: { key: string; name: string; description: string }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------- 用量洞察 ------------------------------- */

export interface UsageDay {
  date: string;
  runs: number;
  messages: number;
  toolCalls: number;
  tokens: number;
  failed: number;
}

export interface UsageRunRow {
  id: string;
  kind: string;
  status: string;
  input: string;
  steps: number;
  toolCalls: number;
  tokens: number;
  durationMs: number;
  startedAt: string;
}

export interface UsageOverview {
  range: { days: number; from: string; to: string; scope: "me" | "platform" };
  totals: {
    runs: number;
    messages: number;
    sessions: number;
    tokens: number;
    toolCalls: number;
    successRate: number;
    avgDurationMs: number;
  };
  series: UsageDay[];
  byKind: { kind: string; runs: number; tokens: number }[];
  topTools: { name: string; count: number; avgMs: number }[];
  topSkills: { key: string; name: string; usage: number }[];
  recent: UsageRunRow[];
}
