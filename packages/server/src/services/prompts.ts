/** 提示词模板：内置模板只读，团队模板可增删改 */
import type { PromptTemplate } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";

interface PromptRow {
  id: string;
  title: string;
  description: string;
  body: string;
  category: string;
  icon: string;
  tags: string;
  builtin: number;
  usage_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toPrompt(row: PromptRow): PromptTemplate {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    body: row.body,
    category: row.category,
    icon: row.icon,
    tags: parseJson<string[]>(row.tags, []),
    builtin: !!row.builtin,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPrompts(opts: { category?: string; q?: string } = {}): PromptTemplate[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.category && opts.category !== "all") {
    where.push("category = ?");
    args.push(opts.category);
  }
  if (opts.q?.trim()) {
    where.push("(title LIKE ? OR description LIKE ? OR body LIKE ? OR tags LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    args.push(like, like, like, like);
  }
  const sql = `SELECT * FROM prompts ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY builtin DESC, usage_count DESC, created_at DESC`;
  return (db.prepare(sql).all(...args) as PromptRow[]).map(toPrompt);
}

export function getPrompt(id: string): PromptTemplate | null {
  const row = db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(id) as PromptRow | undefined;
  return row ? toPrompt(row) : null;
}

export function createPrompt(
  input: {
    title: string;
    description?: string;
    body: string;
    category?: string;
    icon?: string;
    tags?: string[];
  },
  userId: string,
): PromptTemplate {
  const id = newId("prm");
  const ts = now();
  db.prepare(
    `INSERT INTO prompts (id, title, description, body, category, icon, tags, builtin, usage_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.description ?? "",
    input.body,
    input.category ?? "general",
    input.icon ?? "sparkles",
    JSON.stringify(input.tags ?? []),
    userId,
    ts,
    ts,
  );
  return getPrompt(id)!;
}

export function updatePrompt(id: string, patch: Partial<Omit<PromptTemplate, "id" | "builtin" | "usageCount">>): PromptTemplate | null {
  const current = getPrompt(id);
  if (!current) return null;
  db.prepare(
    `UPDATE prompts SET title = ?, description = ?, body = ?, category = ?, icon = ?, tags = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.title ?? current.title,
    patch.description ?? current.description,
    patch.body ?? current.body,
    patch.category ?? current.category,
    patch.icon ?? current.icon,
    JSON.stringify(patch.tags ?? current.tags),
    now(),
    id,
  );
  return getPrompt(id);
}

export function deletePrompt(id: string): boolean {
  const row = db.prepare(`SELECT builtin FROM prompts WHERE id = ?`).get(id) as { builtin: number } | undefined;
  if (!row || row.builtin) return false;
  return db.prepare(`DELETE FROM prompts WHERE id = ?`).run(id).changes > 0;
}

export function bumpPromptUsage(id: string): void {
  db.prepare(`UPDATE prompts SET usage_count = usage_count + 1 WHERE id = ?`).run(id);
}

export function promptStats() {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM prompts`).get() as { n: number }).n;
  const builtin = (db.prepare(`SELECT COUNT(*) AS n FROM prompts WHERE builtin = 1`).get() as { n: number }).n;
  return { total, builtin, custom: total - builtin };
}
