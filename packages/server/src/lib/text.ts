/** 文本处理：中英文分词、分块、轻量哈希向量与混合检索打分 */

const STOP = new Set([
  "的", "了", "是", "在", "和", "与", "我", "你", "他", "她", "它", "们", "这", "那", "有", "就", "不", "也", "都", "而", "及", "或", "一个", "什么", "怎么",
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were", "for", "on", "with", "that", "this", "it", "as", "at", "be", "by", "from",
]);

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const latin = lower.match(/[a-z0-9_]+/g) ?? [];
  for (const w of latin) if (w.length > 1 && !STOP.has(w)) out.push(w);
  const cjkRuns = lower.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      const ch = run[i];
      if (!STOP.has(ch)) out.push(ch);
      if (i < run.length - 1) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

const DIM = 128;

/** 本地哈希向量：无需外部 embedding 服务即可获得稳定的相似度信号 */
export function embed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  for (const token of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % DIM;
    const sign = h & 0x80000000 ? -1 : 1;
    vec[idx] += sign * (1 + Math.log(1 + token.length));
  }
  return normalize(vec);
}

export function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  return dot;
}

export function lexicalScore(query: string, doc: string): number {
  const q = tokenize(query);
  if (!q.length) return 0;
  const docLower = doc.toLowerCase();

  const counts = new Map<string, number>();
  for (const t of tokenize(doc)) counts.set(t, (counts.get(t) ?? 0) + 1);

  let hit = 0;
  for (const t of q) {
    const tf = counts.get(t) ?? 0;
    if (tf > 0) hit += (t.length > 1 ? 1.5 : 0.5) * (1 + Math.log(tf));
  }
  const base = Math.min(1, hit / (q.length * 2.2));
  const phrase = docLower.includes(query.toLowerCase().trim()) ? 0.35 : 0;

  // 标题命中：markdown 标题里出现的实词权重更高（章节标题通常就是主题）
  const headings = doc
    .split("\n")
    .filter((line) => /^#{1,6}\s/.test(line.trim()))
    .join(" ")
    .toLowerCase();
  let headingHits = 0;
  for (const t of q) if (t.length > 1 && headings.includes(t)) headingHits++;
  const headingBonus = Math.min(0.22, headingHits * 0.11);

  return Math.min(1, base + phrase + headingBonus);
}

/** 混合检索：语义向量 + 词法重合 */
export function hybridScore(query: string, doc: string, docEmbedding: number[] | null, importance = 0.5): number {
  const lex = lexicalScore(query, doc);
  const sem = docEmbedding ? Math.max(0, cosine(embed(query), docEmbedding)) : 0;
  const score = lex * 0.62 + sem * 0.3 + importance * 0.08;
  return Math.round(score * 1000) / 1000;
}

/**
 * 分块：优先按 Markdown 标题切成语义完整的 section；
 * 超长 section 再按段落/句子切，并在子块前保留章节标题，便于检索定位。
 */
export function chunkText(text: string, size = 480, overlap = 60): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const sections: string[] = [];
  let buf = "";
  for (const line of clean.split("\n")) {
    if (/^#{1,6}\s/.test(line.trim()) && buf.trim()) {
      sections.push(buf.trim());
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf.trim()) sections.push(buf.trim());

  const chunks: string[] = [];
  const pushWithHeading = (heading: string, body: string) => {
    const content = heading ? `${heading}\n${body}` : body;
    if (content.trim().length > 20) chunks.push(content.trim());
  };

  for (const section of sections) {
    if (section.length <= size) {
      if (section.trim().length < 40 && chunks.length) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n${section}`.trim();
      } else {
        chunks.push(section);
      }
      continue;
    }

    const headingLine = section.split("\n")[0];
    const heading = /^#{1,6}\s/.test(headingLine.trim()) ? headingLine.trim() : "";
    const body = heading ? section.slice(headingLine.length).trim() : section;

    const paragraphs = body.split(/\n\n+/);
    let current = "";
    for (const p of paragraphs) {
      if ((current + "\n\n" + p).length <= size) {
        current = current ? `${current}\n\n${p}` : p;
        continue;
      }
      if (current) {
        pushWithHeading(heading, current);
        current = current.length > overlap ? current.slice(-overlap) : "";
        current = `${current}\n\n${p}`.trim();
      } else if (p.length > size) {
        const sentences = p.split(/(?<=[。！？.!?\n])/);
        let sub = "";
        for (const sentence of sentences) {
          if ((sub + sentence).length > size) {
            if (sub) pushWithHeading(heading, sub);
            sub = sub.length > overlap ? sub.slice(-overlap) : "";
          }
          sub += sentence;
        }
        if (sub.trim()) pushWithHeading(heading, sub);
        current = "";
      } else {
        current = p;
      }
    }
    if (current.trim()) pushWithHeading(heading, current);
  }

  return chunks.filter((c) => c.length > 20).slice(0, 400);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.2);
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 40) || "item";
}

/**
 * 从首条提问推导会话标题。
 *
 * 去掉常见的口语前缀与结尾标点，保留能表达主题的部分；
 * 超长截断并补省略号。纯规则实现，无模型调用，可离线工作。
 */
export function deriveTitle(input: string, max = 22): string {
  const hadAttachment = /<attachment/.test(input);
  let text = input.replace(/<attachment[\s\S]*?<\/attachment>/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^(请|麻烦|帮我|帮忙|能否|可以|我想|我需要|给我|帮忙看下|看一下)[，,、\s]*/u, "");
  text = text.replace(/[。！？!?；;，,、\s]+$/u, "");
  if (!text) text = hadAttachment ? "附件对话" : input.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
