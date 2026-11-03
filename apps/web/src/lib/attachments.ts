/**
 * 文本附件：在浏览器侧读取，随消息正文一起发送并落库。
 * 用 <attachment> 标记包裹，历史记录与后续轮次都能看到原文。
 */
export interface Attachment {
  name: string;
  size: number;
  content: string;
}

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 32 * 1024;
export const MAX_TOTAL_BYTES = 96 * 1024;

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "csv",
  "tsv",
  "log",
  "yml",
  "yaml",
  "toml",
  "ini",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "go",
  "rs",
  "java",
  "sql",
  "sh",
  "env",
]);

const BLOCK_RE = /<attachment name="([^"]*)" size="(\d+)">\n([\s\S]*?)\n<\/attachment>/g;

export type RejectReason = "size" | "type" | "limit" | "total";

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

/** 读取可接受的文本文件；被拒绝的返回原因，由 UI 统一提示 */
export async function collectAttachments(
  incoming: File[],
  current: Attachment[],
): Promise<{ accepted: Attachment[]; rejected: { name: string; reason: RejectReason }[] }> {
  const accepted: Attachment[] = [];
  const rejected: { name: string; reason: RejectReason }[] = [];
  let total = current.reduce((n, f) => n + f.size, 0);
  let count = current.length;

  for (const file of incoming) {
    if (!isTextFile(file)) {
      rejected.push({ name: file.name, reason: "type" });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ name: file.name, reason: "size" });
      continue;
    }
    if (count >= MAX_FILES) {
      rejected.push({ name: file.name, reason: "limit" });
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      rejected.push({ name: file.name, reason: "total" });
      continue;
    }
    const content = await file.text();
    accepted.push({ name: file.name.slice(0, 120), size: file.size, content });
    total += file.size;
    count += 1;
  }

  return { accepted, rejected };
}

export function composeWithAttachments(text: string, files: Attachment[]): string {
  if (!files.length) return text.trim();
  const blocks = files
    .map((f) => `<attachment name="${f.name.replace(/"/g, "&quot;")}" size="${f.size}">\n${f.content}\n</attachment>`)
    .join("\n\n");
  const body = text.trim();
  return body ? `${blocks}\n\n${body}` : blocks;
}

export function parseAttachments(content: string): { text: string; files: Attachment[] } {
  const files: Attachment[] = [];
  const text = content.replace(BLOCK_RE, (_all, name: string, size: string, body: string) => {
    files.push({ name: name.replace(/&quot;/g, '"'), size: Number(size), content: body });
    return "";
  });
  return { text: text.trim(), files };
}
