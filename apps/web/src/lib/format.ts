export function relativeTime(iso: string | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("common.justNow");
  if (min < 60) return t("common.minutesAgo", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("common.daysAgo", { n: days });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(-1);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function truncate(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
