import type { KbDocument, KnowledgeBase } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { chunkText, embed, estimateTokens, hybridScore } from "../lib/text";

export function listKnowledgeBases(): KnowledgeBase[] {
  const rows = db
    .prepare(
      `SELECT kb.*, 
        (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id) AS doc_count,
        (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = kb.id) AS chunk_count
       FROM knowledge_bases kb ORDER BY kb.created_at DESC`,
    )
    .all() as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ""),
    docCount: Number(r.doc_count ?? 0),
    chunkCount: Number(r.chunk_count ?? 0),
    createdAt: String(r.created_at),
  }));
}

export function createKnowledgeBase(name: string, description: string, userId: string): KnowledgeBase {
  const id = newId("kb");
  db.prepare(`INSERT INTO knowledge_bases (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    name.trim(),
    description.trim(),
    userId,
    now(),
  );
  return { id, name, description, docCount: 0, chunkCount: 0, createdAt: now() };
}

export function deleteKnowledgeBase(id: string): boolean {
  return db.prepare(`DELETE FROM knowledge_bases WHERE id = ?`).run(id).changes > 0;
}

export function listDocuments(kbId: string): KbDocument[] {
  const rows = db
    .prepare(`SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC`)
    .all(kbId) as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id),
    kbId: String(r.kb_id),
    name: String(r.name),
    mime: String(r.mime ?? "text/plain"),
    size: Number(r.size ?? 0),
    status: (String(r.status) as KbDocument["status"]) ?? "ready",
    chunks: Number(r.chunks ?? 0),
    createdAt: String(r.created_at),
  }));
}

export function addDocument(input: {
  kbId: string;
  name: string;
  content: string;
  mime?: string;
}): KbDocument {
  const kb = db.prepare(`SELECT id FROM knowledge_bases WHERE id = ?`).get(input.kbId);
  if (!kb) throw new Error("知识库不存在");
  const chunks = chunkText(input.content);
  const docId = newId("doc");
  const ts = now();

  db.prepare(
    `INSERT INTO documents (id, kb_id, name, mime, size, status, chunks, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(docId, input.kbId, input.name, input.mime ?? "text/markdown", input.content.length, "ready", chunks.length, input.content, ts);

  const insertChunk = db.prepare(
    `INSERT INTO chunks (id, doc_id, kb_id, idx, content, tokens, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  chunks.forEach((content, idx) => {
    insertChunk.run(newId("chk"), docId, input.kbId, idx, content, estimateTokens(content), JSON.stringify(embed(content)));
  });

  return {
    id: docId,
    kbId: input.kbId,
    name: input.name,
    mime: input.mime ?? "text/markdown",
    size: input.content.length,
    status: "ready",
    chunks: chunks.length,
    createdAt: ts,
  };
}

export function deleteDocument(id: string): boolean {
  return db.prepare(`DELETE FROM documents WHERE id = ?`).run(id).changes > 0;
}

export interface KnowledgeHit {
  id: string;
  content: string;
  docName: string;
  kbName: string;
  score: number;
}

export function searchKnowledge(opts: { query: string; limit?: number; kbIds?: string[] }): KnowledgeHit[] {
  const limit = opts.limit ?? 5;
  const params: unknown[] = [];
  let where = "";
  if (opts.kbIds?.length) {
    where = `WHERE c.kb_id IN (${opts.kbIds.map(() => "?").join(",")})`;
    params.push(...opts.kbIds);
  }
  const rows = db
    .prepare(
      `SELECT c.id, c.content, c.embedding, d.name AS doc_name, kb.name AS kb_name
       FROM chunks c JOIN documents d ON d.id = c.doc_id JOIN knowledge_bases kb ON kb.id = c.kb_id
       ${where} LIMIT 4000`,
    )
    .all(...params) as { id: string; content: string; embedding: string | null; doc_name: string; kb_name: string }[];

  return rows
    .map((row) => {
      const vec = parseJson<number[]>(row.embedding, []);
      return {
        id: row.id,
        content: row.content,
        docName: row.doc_name,
        kbName: row.kb_name,
        score: hybridScore(opts.query, row.content, vec.length ? vec : null, 0.3),
      };
    })
    .filter((r) => r.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function knowledgeStats() {
  const kb = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge_bases`).get() as { n: number }).n;
  const docs = (db.prepare(`SELECT COUNT(*) AS n FROM documents`).get() as { n: number }).n;
  const chunks = (db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number }).n;
  return { knowledgeBases: kb, documents: docs, chunks };
}
