import Database from "better-sqlite3";
import { env } from "../env";

export const db = new Database(env.databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  color TEXT DEFAULT '#7c5cff',
  is_system INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  locale TEXT DEFAULT 'zh',
  theme TEXT DEFAULT 'system',
  avatar_color TEXT DEFAULT '#7c5cff',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL,
  scopes TEXT DEFAULT '[]',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  agent_key TEXT DEFAULT 'buddy',
  skill_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts TEXT NOT NULL DEFAULT '[]',
  usage TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'user',
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'manual',
  embedding TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT 'sparkles',
  category TEXT DEFAULT 'general',
  instructions TEXT DEFAULT '',
  tools TEXT DEFAULT '[]',
  resources TEXT DEFAULT '[]',
  triggers TEXT DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  builtin INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT DEFAULT 'text/plain',
  size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ready',
  chunks INTEGER DEFAULT 0,
  content TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER DEFAULT 0,
  embedding TEXT
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  transport TEXT DEFAULT 'http',
  headers TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'disconnected',
  tools TEXT DEFAULT '[]',
  error TEXT,
  last_sync_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Shanghai',
  prompt TEXT NOT NULL,
  skill_key TEXT,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  user_id TEXT,
  status TEXT NOT NULL,
  input TEXT DEFAULT '',
  output TEXT DEFAULT '',
  steps INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  usage TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

export function migrate(): void {
  db.exec(SCHEMA);
}

export const now = (): string => new Date().toISOString();

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function settingGet(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function settingSet(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
