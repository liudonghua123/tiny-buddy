import type { Memory, MemoryKind, MemoryScope } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { cosine, embed, hybridScore } from "../lib/text";

interface MemoryRow {
  id: string;
  user_id: string;
  scope: string;
  kind: string;
  content: string;
  tags: string;
  importance: number;
  source: string;
  embedding: string | null;
  created_at: string;
  updated_at: string;
}

function toMemory(row: MemoryRow, score?: number): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as MemoryScope,
    kind: row.kind as MemoryKind,
    content: row.content,
    tags: parseJson<string[]>(row.tags, []),
    importance: row.importance,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    score,
  };
}

export interface RecallOptions {
  userId: string;
  query: string;
  limit?: number;
  minScore?: number;
}

export function recallMemories({ userId, query, limit = 5, minScore = 0.05 }: RecallOptions) {
  const rows = db
    .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 800`)
    .all(userId) as MemoryRow[];

  const scored = rows
    .map((row) => {
      const vec = parseJson<number[]>(row.embedding, []);
      const score = hybridScore(query, row.content, vec.length ? vec : null, row.importance);
      return { row, score };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length) {
    const stmt = db.prepare(`UPDATE memories SET last_used_at = ? WHERE id = ?`);
    const ts = now();
    for (const s of scored) stmt.run(ts, s.row.id);
  }

  return scored.map((s) => ({ id: s.row.id, content: s.row.content, score: s.score, kind: s.row.kind }));
}

export interface WriteMemoryInput {
  userId: string;
  content: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
  tags?: string[];
  importance?: number;
  source?: string;
}

export function writeMemory(input: WriteMemoryInput): { memory: Memory; deduped: boolean } {
  const content = input.content.trim();
  if (!content) throw new Error("记忆内容不能为空");
  const vec = embed(content);

  const existing = db
    .prepare(`SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300`)
    .all(input.userId) as MemoryRow[];
  for (const row of existing) {
    if (row.content.trim() === content) {
      return { memory: toMemory(row), deduped: true };
    }
    const other = parseJson<number[]>(row.embedding, []);
    if (other.length && cosine(vec, other) > 0.94) {
      db.prepare(`UPDATE memories SET updated_at = ?, importance = MAX(importance, ?) WHERE id = ?`).run(
        now(),
        input.importance ?? 0.5,
        row.id,
      );
      return { memory: toMemory({ ...row, updated_at: now() }), deduped: true };
    }
  }

  const id = newId("mem");
  const ts = now();
  db.prepare(
    `INSERT INTO memories (id, user_id, scope, kind, content, tags, importance, source, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.scope ?? "user",
    input.kind ?? "fact",
    content,
    JSON.stringify(input.tags ?? []),
    Math.max(0, Math.min(1, input.importance ?? 0.6)),
    input.source ?? "agent",
    JSON.stringify(vec),
    ts,
    ts,
  );

  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow;
  return { memory: toMemory(row), deduped: false };
}

export function listMemories(
  userId: string,
  opts: { q?: string; kind?: string; page?: number; pageSize?: number } = {},
): { items: Memory[]; total: number } {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 30);
  const where = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.kind && opts.kind !== "all") {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.q?.trim()) {
    where.push("(content LIKE ? OR tags LIKE ?)");
    params.push(`%${opts.q.trim()}%`, `%${opts.q.trim()}%`);
  }
  const clause = where.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM memories WHERE ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as MemoryRow[];
  return { items: rows.map((r) => toMemory(r)), total };
}

export function updateMemory(userId: string, id: string, patch: Partial<Pick<Memory, "content" | "kind" | "importance" | "tags">>): Memory | null {
  const row = db.prepare(`SELECT * FROM memories WHERE id = ? AND user_id = ?`).get(id, userId) as MemoryRow | undefined;
  if (!row) return null;
  const content = patch.content ?? row.content;
  db.prepare(
    `UPDATE memories SET content = ?, kind = ?, importance = ?, tags = ?, embedding = ?, updated_at = ? WHERE id = ?`,
  ).run(
    content,
    patch.kind ?? row.kind,
    patch.importance ?? row.importance,
    JSON.stringify(patch.tags ?? parseJson<string[]>(row.tags, [])),
    JSON.stringify(embed(content)),
    now(),
    id,
  );
  return toMemory(db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as MemoryRow);
}

export function deleteMemory(userId: string, id: string): boolean {
  return db.prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`).run(id, userId).changes > 0;
}

export function memoryStats(userId: string) {
  const rows = db
    .prepare(`SELECT kind, COUNT(*) AS n FROM memories WHERE user_id = ? GROUP BY kind`)
    .all(userId) as { kind: string; n: number }[];
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, byKind: rows };
}
