/** 轻量 cron 解析（5 段：分 时 日 月 周），用于定时任务与下一次执行时间计算 */

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number> | null;
  month: Set<number>;
  dow: Set<number> | null;
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  if (field === "*" || field === "?") return null;
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step <= 0) throw new Error(`非法的 cron 步长: ${part}`);
    let start = min;
    let end = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      start = Number(a);
      end = b === undefined ? (stepRaw ? max : Number(a)) : Number(b);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max) {
      throw new Error(`非法的 cron 字段: ${part}`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron 需要 5 段：分 时 日 月 周");
  return {
    minute: parseField(parts[0], 0, 59) ?? new Set(Array.from({ length: 60 }, (_, i) => i)),
    hour: parseField(parts[1], 0, 23) ?? new Set(Array.from({ length: 24 }, (_, i) => i)),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12) ?? new Set(Array.from({ length: 12 }, (_, i) => i + 1)),
    dow: parseField(parts[4], 0, 6),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function nextRun(expr: string, from = new Date()): Date | null {
  let spec: CronSpec;
  try {
    spec = parseCron(expr);
  } catch {
    return null;
  }
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let guard = 0; guard < 366 * 5; guard++) {
    if (!spec.month.has(d.getMonth() + 1)) {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      d.setMonth(d.getMonth() + 1);
      continue;
    }
    const domMatch = spec.dom ? spec.dom.has(d.getDate()) : null;
    const dowMatch = spec.dow ? spec.dow.has(d.getDay()) : null;
    const dayOk = domMatch === null && dowMatch === null ? true : domMatch === null ? dowMatch! : dowMatch === null ? domMatch : domMatch || dowMatch;
    if (!dayOk) {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      continue;
    }
    if (!spec.hour.has(d.getHours())) {
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      continue;
    }
    if (!spec.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom] = parts;
  if (m === "0" && h === "9" && dom === "*") return "每天 09:00";
  if (/^\*\/\d+$/.test(m) && h === "*") return `每 ${m.slice(2)} 分钟`;
  if (m === "0" && /^\*\/\d+$/.test(h)) return `每 ${h.slice(2)} 小时`;
  return expr;
}
