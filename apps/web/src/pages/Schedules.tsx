import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock, Pencil, Play, Plus, Sparkles, Trash2, History } from "lucide-react";
import clsx from "clsx";
import type { Schedule, Skill } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { formatDateTime, relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner, StatusDot, Switch } from "../components/ui";

function describeCron(expr: string, isZh: boolean): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom, , dow] = parts;
  if (m === "0" && h === "9" && dom === "*" && dow === "*") return isZh ? "每天 09:00" : "Daily at 09:00";
  if (m === "0" && h === "*" && dom === "*") return isZh ? "每小时整点" : "Hourly";
  if (/^\*\/\d+$/.test(m) && h === "*") return isZh ? `每 ${m.slice(2)} 分钟` : `Every ${m.slice(2)} min`;
  if (m === "0" && /^\d+$/.test(h) && dow === "1-5") return isZh ? `工作日 ${h.padStart(2, "0")}:00` : `Weekdays ${h.padStart(2, "0")}:00`;
  return expr;
}

interface Draft {
  id?: string;
  name: string;
  cron: string;
  prompt: string;
  skillKey: string;
  enabled: boolean;
}

const EMPTY: Draft = { name: "", cron: "0 9 * * 1-5", prompt: "", skillKey: "", enabled: true };

export function SchedulesPage() {
  const { t, isZh } = useI18n();
  const { can } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<Schedule[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Schedule[] }>("/schedules");
      setItems(data.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    api<{ items: Skill[] }>("/skills")
      .then((d) => setSkills(d.items.filter((s) => s.enabled)))
      .catch(() => undefined);
  }, [load]);

  const save = async () => {
    if (!draft || !draft.name.trim() || !draft.prompt.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        cron: draft.cron.trim(),
        prompt: draft.prompt.trim(),
        skillKey: draft.skillKey || null,
        enabled: draft.enabled,
      };
      if (draft.id) await api(`/schedules/${draft.id}`, { method: "PATCH", body });
      else await api("/schedules", { method: "POST", body });
      setDraft(null);
      toast.success(t("schedules.created"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: Schedule) => {
    try {
      await api(`/schedules/${item.id}`, { method: "PATCH", body: { enabled: !item.enabled } });
      setItems((prev) => prev.map((s) => (s.id === item.id ? { ...s, enabled: !s.enabled } : s)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const runNow = async (item: Schedule) => {
    setRunning(item.id);
    try {
      const data = await api<{ ok: boolean; output: string }>(`/schedules/${item.id}/run`, { method: "POST" });
      toast[data.ok ? "success" : "error"](data.ok ? t("schedules.ran") : data.output);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/schedules/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("schedules.title")}
          subtitle={t("schedules.subtitle")}
          actions={
            can("schedule:write") && (
              <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                <Plus size={15} /> {t("schedules.new")}
              </button>
            )
          }
        />

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={20} />}
            title={t("schedules.empty")}
            description={t("schedules.emptyDesc")}
            action={
              can("schedule:write") && (
                <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                  <Plus size={15} /> {t("schedules.new")}
                </button>
              )
            }
          />
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div key={item.id} className={clsx("card p-4 transition", !item.enabled && "opacity-65")}>
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <CalendarClock size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13.5px] font-semibold text-ink">{item.name}</h3>
                      <span className="chip py-0 font-mono text-[10px]">{item.cron}</span>
                      <span className="text-[10.5px] text-faint">{describeCron(item.cron, isZh)}</span>
                      {item.lastStatus && (
                        <span
                          className={clsx(
                            "flex items-center gap-1 text-[10px]",
                            item.lastStatus === "success" ? "text-ok" : item.lastStatus === "failed" ? "text-danger" : "text-warn",
                          )}
                        >
                          <StatusDot tone={item.lastStatus === "success" ? "ok" : item.lastStatus === "failed" ? "danger" : "warn"} />
                          {t(`schedules.${item.lastStatus}`)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted">{item.prompt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[10.5px] text-faint">
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {t("schedules.nextRun")}: {item.enabled ? formatDateTime(item.nextRunAt) : "—"}
                      </span>
                      <span className="flex items-center gap-1">
                        <History size={10} /> {t("schedules.lastRun")}: {item.lastRunAt ? relativeTime(item.lastRunAt, t) : "—"}
                      </span>
                      {item.skillKey && (
                        <span className="flex items-center gap-1 text-brand">
                          <Sparkles size={10} /> {item.skillKey}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {can("schedule:write") && <Switch checked={item.enabled} onChange={() => void toggle(item)} />}
                    <div className="flex items-center gap-1">
                      {can("schedule:write") && (
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-ink"
                          title={t("common.edit")}
                          onClick={() =>
                            setDraft({
                              id: item.id,
                              name: item.name,
                              cron: item.cron,
                              prompt: item.prompt,
                              skillKey: item.skillKey ?? "",
                              enabled: item.enabled,
                            })
                          }
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {can("schedule:write") && (
                        <button
                          className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px] text-muted transition hover:bg-elevated hover:text-ink"
                          onClick={() => void runNow(item)}
                          disabled={running === item.id}
                        >
                          {running === item.id ? <Spinner size={11} /> : <Play size={11} />}
                          <span className="hidden sm:inline">{t("schedules.runNow")}</span>
                        </button>
                      )}
                      {can("schedule:write") && (
                        <ConfirmButton
                          title={t("schedules.deleteConfirm", { name: item.name })}
                          confirmLabel={t("common.delete")}
                          cancelLabel={t("common.cancel")}
                          danger
                          onConfirm={() => remove(item.id)}
                        >
                          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-danger/10 hover:text-danger">
                            <Trash2 size={12} />
                          </button>
                        </ConfirmButton>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal
          open={Boolean(draft)}
          onClose={() => setDraft(null)}
          title={draft?.id ? t("common.edit") : t("schedules.new")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void save()} disabled={saving || !draft?.name.trim() || !draft?.prompt.trim()}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.save")}
              </button>
            </>
          }
        >
          {draft && (
            <>
              <Field label={t("common.name")}>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
              </Field>
              <Field label={t("schedules.cron")} hint={t("schedules.cronHint")}>
                <input
                  className="input font-mono text-[12.5px]"
                  value={draft.cron}
                  onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
                  placeholder="0 9 * * 1-5"
                />
              </Field>
              <Field label={t("schedules.prompt")}>
                <textarea
                  className="input min-h-[110px] resize-y"
                  value={draft.prompt}
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  placeholder={isZh ? "例如：汇总昨天的发布记录，输出三条风险提示。" : "e.g. Summarize yesterday's releases and flag three risks."}
                />
              </Field>
              <Field label={t("schedules.skillOptional")}>
                <select className="input" value={draft.skillKey} onChange={(e) => setDraft({ ...draft, skillKey: e.target.value })}>
                  <option value="">{t("chat.autoSkill")}</option>
                  {skills.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
