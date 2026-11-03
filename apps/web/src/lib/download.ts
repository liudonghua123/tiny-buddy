/** 触发浏览器下载，避免为一次性导出引入后端接口 */
export function downloadText(filename: string, text: string, mime = "text/markdown;charset=utf-8"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r]+/g, "-").trim();
  return (cleaned || "tinybuddy").slice(0, 60);
}
