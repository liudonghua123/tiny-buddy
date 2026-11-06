/** 全局检索：会话、技能、文档、模板、定时任务、记忆，一次请求横向搜完 */
import { hasPermission, type Permission, type SearchGroup, type SearchHit, type User } from "@tiny-buddy/shared";
import { db, parseJson } from "../db";

const MAX_PER_GROUP = 5;

function snippet(text: string, needle: string, radius = 48): string {
  const clean = text.replace(/<attachment[\s\S]*?<\/attachment>/g, " ").replace(/\s+/g, " ").trim();
  if (!needle) return clean.slice(0, radius * 2);
  const idx = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return clean.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function allow(user: User, permission: Permission): boolean {
  return hasPermission(user.permissions, permission);
}

export function searchAll(user: User, query: string): SearchGroup[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const like = `%${q}%`;
  const groups: SearchGroup[] = [];

  /* 会话：标题命中优先，其次是消息内容命中 */
  const sessionHits: SearchHit[] = [];
  const titled = db
    .prepare(
      `SELECT id, title, updated_at FROM sessions
       WHERE user_id = ? AND title LIKE ?
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(user.id, like, MAX_PER_GROUP) as { id: string; title: string; updated_at: string }[];
  for (const row of titled) {
    sessionHits.push({
      id: row.id,
      kind: "session",
      title: row.title,
      subtitle: "会话标题",
      href: `/chat/${row.id}`,
    });
  }
  if (sessionHits.length < MAX_PER_GROUP) {
    const byMessage = db
      .prepare(
        `SELECT m.session_id AS sid, s.title, m.content, m.created_at
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE s.user_id = ? AND m.content LIKE ?
         ORDER BY m.created_at DESC LIMIT ?`,
      )
      .all(user.id, like, MAX_PER_GROUP) as { sid: string; title: string; content: string; created_at: string }[];
    const seen = new Set(sessionHits.map((h) => h.id));
    for (const row of byMessage) {
      if (seen.has(row.sid)) continue;
      seen.add(row.sid);
      sessionHits.push({
        id: row.sid,
        kind: "session",
        title: row.title,
        subtitle: "消息内容",
        snippet: snippet(row.content, q),
        href: `/chat/${row.sid}`,
      });
      if (sessionHits.length >= MAX_PER_GROUP) break;
    }
  }
  if (sessionHits.length) groups.push({ kind: "session", items: sessionHits });

  /* 技能 */
  if (allow(user, "skill:read")) {
    const rows = db
      .prepare(`SELECT id, key, name, description, triggers FROM skills WHERE name LIKE ? OR description LIKE ? OR triggers LIKE ? LIMIT ?`)
      .all(like, like, like, MAX_PER_GROUP) as { id: string; key: string; name: string; description: string; triggers: string }[];
    if (rows.length) {
      groups.push({
        kind: "skill",
        items: rows.map((r) => ({
          id: r.id,
          kind: "skill",
          title: r.name,
          subtitle: `技能 · ${r.key}`,
          snippet: r.description || parseJson<string[]>(r.triggers, []).join(" · "),
          href: `/skills?open=${r.id}`,
        })),
      });
    }
  }

  /* 知识库文档 */
  if (allow(user, "knowledge:read")) {
    const rows = db
      .prepare(
        `SELECT d.id, d.name, d.content, k.name AS kb FROM documents d
         JOIN knowledge_bases k ON k.id = d.kb_id
         WHERE d.name LIKE ? OR d.content LIKE ? LIMIT ?`,
      )
      .all(like, like, MAX_PER_GROUP) as { id: string; name: string; content: string; kb: string }[];
    if (rows.length) {
      groups.push({
        kind: "document",
        items: rows.map((r) => ({
          id: r.id,
          kind: "document",
          title: r.name,
          subtitle: `知识库 · ${r.kb}`,
          snippet: snippet(r.content, q),
          href: `/knowledge?doc=${r.id}`,
        })),
      });
    }
  }

  /* 提示词模板 */
  if (allow(user, "prompt:read")) {
    const rows = db
      .prepare(`SELECT id, title, description, body FROM prompts WHERE title LIKE ? OR description LIKE ? OR body LIKE ? LIMIT ?`)
      .all(like, like, like, MAX_PER_GROUP) as { id: string; title: string; description: string; body: string }[];
    if (rows.length) {
      groups.push({
        kind: "prompt",
        items: rows.map((r) => ({
          id: r.id,
          kind: "prompt",
          title: r.title,
          subtitle: "提示词模板",
          snippet: r.description || snippet(r.body, q),
          href: `/prompts?open=${r.id}`,
        })),
      });
    }
  }

  /* 定时任务（只看自己的） */
  if (allow(user, "schedule:read")) {
    const rows = db
      .prepare(`SELECT id, name, prompt, cron FROM schedules WHERE created_by = ? AND (name LIKE ? OR prompt LIKE ?) LIMIT ?`)
      .all(user.id, like, like, MAX_PER_GROUP) as { id: string; name: string; prompt: string; cron: string }[];
    if (rows.length) {
      groups.push({
        kind: "schedule",
        items: rows.map((r) => ({
          id: r.id,
          kind: "schedule",
          title: r.name,
          subtitle: `定时 · ${r.cron}`,
          snippet: snippet(r.prompt, q),
          href: "/schedules",
        })),
      });
    }
  }

  /* 记忆（只看自己的） */
  if (allow(user, "memory:read")) {
    const rows = db
      .prepare(`SELECT id, content, kind FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY importance DESC LIMIT ?`)
      .all(user.id, like, MAX_PER_GROUP) as { id: string; content: string; kind: string }[];
    if (rows.length) {
      groups.push({
        kind: "memory",
        items: rows.map((r) => ({
          id: r.id,
          kind: "memory",
          title: snippet(r.content, q, 30),
          subtitle: "长期记忆",
          href: "/memory",
        })),
      });
    }
  }

  return groups;
}
