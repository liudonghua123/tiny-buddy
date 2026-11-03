import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CheckCircle2, Clock, Gauge, MessageSquare, Sparkles, Wrench } from "lucide-react";
import clsx from "clsx";
import type { UsageOverview } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatNumber, relativeTime, truncate } from "../lib/format";
import { useToast } from "../lib/toast";
import { Card, EmptyState, PageHeader, Spinner } from "../components/ui";

const RANGES = [7, 14, 30] as const;

function duration(ms: number): string {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: typeof Activity }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{label}</div>
          <div className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-ink">{value}</div>
          {hint && <div className="mt-0.5 truncate text-[11px] text-faint">{hint}</div>}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon size={15} />
        </span>
      </div>
    </Card>
  );
}

export function UsagePage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState<number>(7);
  const [scope, setScope] = useState<"me" | "platform">("me");
  const [data, setData] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<UsageOverview>(`/usage/overview?days=${days}&scope=${scope}`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days, scope, toast]);

  const maxRuns = useMemo(() => Math.max(1, ...(data?.series ?? []).map((d) => d.runs)), [data]);
  const maxTokens = useMemo(() => Math.max(1, ...(data?.series ?? []).map((d) => d.tokens)), [data]);
  const maxTool = useMemo(() => Math.max(1, ...(data?.topTools ?? []).map((d) => d.count)), [data]);
  const maxSkill = useMemo(() => Math.max(1, ...(data?.topSkills ?? []).map((d) => d.usage)), [data]);
  const maxKind = useMemo(() => Math.max(1, ...(data?.byKind ?? []).map((d) => d.runs)), [data]);

  const kindLabel = (kind: string) => {
    const key = `usage.kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    const label = t(key);
    return label === key ? kind : label;
  };

  const statusLabel = (status: string) => {
    const key = `usage.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
    const label = t(key);
    return label === key ? status : label;
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-5 pb-20 sm:px-6 sm:py-7 lg:pb-8">
        <PageHeader
          title={t("usage.title")}
          subtitle={t("usage.subtitle")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {can("audit:read") && (
                <div className="inline-flex rounded-xl border border-line bg-elevated p-1">
                  {(["me", "platform"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setScope(s)}
                      className={clsx(
                        "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition",
                        scope === s ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                      )}
                    >
                      {s === "me" ? t("usage.scopeMine") : t("usage.scopePlatform")}
                    </button>
                  ))}
                </div>
              )}
              <div className="inline-flex rounded-xl border border-line bg-elevated p-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setDays(r)}
                    className={clsx(
                      "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition",
                      days === r ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                    )}
                  >
                    {t("usage.days", { n: r })}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        {loading && !data && (
          <div className="flex justify-center py-20">
            <Spinner size={22} />
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t("usage.runs")} value={formatNumber(data.totals.runs)} icon={Activity} />
              <Stat label={t("usage.messages")} value={formatNumber(data.totals.messages)} icon={MessageSquare} />
              <Stat label={t("usage.tokens")} value={formatNumber(data.totals.tokens)} icon={Sparkles} />
              <Stat label={t("usage.toolCalls")} value={formatNumber(data.totals.toolCalls)} icon={Wrench} />
              <Stat label={t("usage.successRate")} value={`${data.totals.successRate}%`} icon={CheckCircle2} />
              <Stat label={t("usage.avgDuration")} value={duration(data.totals.avgDurationMs)} icon={Clock} />
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <Card className="p-4 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} className="text-brand" />
                    <span className="text-[13px] font-medium text-ink">{t("usage.trend")}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10.5px] text-faint">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-brand" /> {t("usage.runsShort")}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-brand/25" /> {t("usage.tokensShort")}
                    </span>
                  </div>
                </div>

                {data.totals.runs === 0 ? (
                  <div className="flex h-[168px] items-center justify-center text-[12px] text-faint">{t("usage.empty")}</div>
                ) : (
                  <div className="flex h-[168px] items-end gap-[3px]">
                    {data.series.map((d, i) => {
                      const runH = (d.runs / maxRuns) * 100;
                      const tokenH = (d.tokens / maxTokens) * 100;
                      const step = data.series.length > 20 ? 4 : data.series.length > 9 ? 2 : 1;
                      const showLabel = i % step === 0 || i === data.series.length - 1;
                      return (
                        <div key={d.date} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1">
                          <div className="relative flex h-full w-full items-end justify-center gap-[1px]">
                            <div
                              className="w-1/2 max-w-[16px] rounded-t-[3px] bg-brand/80 transition group-hover:bg-brand"
                              style={{ height: `${Math.max(runH, d.runs > 0 ? 3 : 0)}%` }}
                            />
                            <div
                              className="w-1/2 max-w-[16px] rounded-t-[3px] bg-brand/25"
                              style={{ height: `${Math.max(tokenH, d.tokens > 0 ? 3 : 0)}%` }}
                            />
                          </div>
                          <span className={clsx("h-3 whitespace-nowrap text-[8px] text-faint", !showLabel && "opacity-0")}>
                            {d.date.slice(5)}
                          </span>
                          <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max rounded-lg border border-line bg-surface px-2 py-1 text-[10.5px] text-muted shadow-lift group-hover:block">
                            <div className="font-medium text-ink">{d.date}</div>
                            <div>
                              {t("usage.runsShort")} {d.runs} · {t("usage.tokensShort")} {formatNumber(d.tokens)}
                            </div>
                            <div>{t("usage.messages")} {d.messages}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 size={14} className="text-brand" />
                  <span className="text-[13px] font-medium text-ink">{t("usage.byKind")}</span>
                </div>
                {data.byKind.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-faint">{t("usage.empty")}</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.byKind.map((k) => (
                      <div key={k.kind}>
                        <div className="mb-1 flex items-center justify-between text-[11.5px]">
                          <span className="text-muted">{kindLabel(k.kind)}</span>
                          <span className="text-faint">
                            {k.runs} · {formatNumber(k.tokens)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                          <div className="h-full rounded-full bg-brand/70" style={{ width: `${(k.runs / maxKind) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Wrench size={14} className="text-brand" />
                  <span className="text-[13px] font-medium text-ink">{t("usage.topTools")}</span>
                </div>
                {data.topTools.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-faint">{t("usage.noTools")}</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.topTools.map((tool) => (
                      <div key={tool.name}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
                          <span className="truncate font-mono text-muted">{tool.name}</span>
                          <span className="shrink-0 text-faint">
                            {t("usage.calls", { n: tool.count })} · {duration(tool.avgMs)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                          <div className="h-full rounded-full bg-brand/70" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={14} className="text-brand" />
                  <span className="text-[13px] font-medium text-ink">{t("usage.topSkills")}</span>
                </div>
                {data.topSkills.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-faint">{t("usage.noSkills")}</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.topSkills.map((skill) => (
                      <div key={skill.key}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
                          <span className="truncate text-muted">{skill.name}</span>
                          <span className="shrink-0 text-faint">{t("usage.calls", { n: skill.usage })}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                          <div
                            className="h-full rounded-full bg-brand/70"
                            style={{ width: `${(skill.usage / maxSkill) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <Card className="mt-3 overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="text-[13px] font-medium text-ink">{t("usage.recent")}</span>
                <span className="text-[10.5px] text-faint">{formatDateTime(data.range.to)}</span>
              </div>
              {data.recent.length === 0 ? (
                <div className="p-4">
                  <EmptyState icon={<Activity size={18} />} title={t("usage.empty")} />
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {data.recent.map((run) => (
                    <div key={run.id} className="flex items-start gap-3 px-4 py-2.5 transition hover:bg-elevated/50">
                      <span
                        className={clsx(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          run.status === "success"
                            ? "bg-ok"
                            : run.status === "failed"
                              ? "bg-danger"
                              : run.status === "running"
                                ? "bg-brand"
                                : "bg-faint",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="chip py-0 text-[9.5px]">{kindLabel(run.kind)}</span>
                          <span className="text-[11px] text-faint">{statusLabel(run.status)}</span>
                          <span className="text-[10px] text-faint">· {relativeTime(run.startedAt, t)}</span>
                        </div>
                        <div className="mt-1 truncate text-[12.5px] text-muted">{truncate(run.input, 110) || "—"}</div>
                      </div>
                      <div className="hidden shrink-0 text-right text-[10.5px] text-faint sm:block">
                        <div>{t("chat.tokens", { n: formatNumber(run.tokens) })}</div>
                        <div>
                          {run.toolCalls} tools · {duration(run.durationMs)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
