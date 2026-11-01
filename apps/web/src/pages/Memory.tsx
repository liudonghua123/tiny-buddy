import { useCallback, useEffect, useState } from "react";
import { Brain, Pencil, Plus, Search, Sparkles, Trash2, Zap } from "lucide-react";
import clsx from "clsx";
import type { Memory, MemoryKind } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner } from "../components/ui";

const KINDS: { key: MemoryKind; label: string }[] = [
  { key: "fact", label: "memory.kindFact" },
  { key: "preference", label: "memory.kindPreference" },
  { key: "episode", label: "memory.kindEpisode" },
  { key: "procedure", label: "memory.kindProcedure" },
  { key: "entity", label: "memory.kindEntity" },
];

const KIND_COLOR: Record<string, string> = {
  fact: "bg-[#3b7ddd]/10 text-[#3b7ddd]",
  preference: "bg-brand/10 text-brand",
  episode: "bg-[#c2751f]/10 text-[#c2751f]",
  procedure: "bg-ok/10 text-ok",
  entity: "bg-[#d05270]/10 text-[#d05270]",
};

interface Draft {
  id?: string;
  content: string;
  kind: MemoryKind;
  importance: number;
  tags: string;
}

const EMPTY: Draft = { content: "", kind: "fact", importance: 0.6, tags: "" };

export function MemoryPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const [recallQuery, setRecallQuery] = useState("");
  const [recallResults, setRecallResults] = useState<{ id: string; content: string; score: number; kind: string }[] | null>(null);
  const [recalling, setRecalling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (kind !== "all") params.set("kind", kind);
      const data = await api<{ items: Memory[]; total: number }>(`/memories?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, kind, toast]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 240 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  const save = async () => {
    if (!draft || draft.content.trim().length < 2) return;
    setSaving(true);
    try {
      const body = {
        content: draft.content.trim(),
        kind: draft.kind,
        importance: draft.importance,
        tags: draft.tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (draft.id) await api(`/memories/${draft.id}`, { method: "PATCH", body });
      else await api("/memories", { method: "POST", body });
      setDraft(null);
      toast.success(t("memory.saved"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/memories/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((m) => m.id !== id));
      setTotal((n) => Math.max(0, n - 1));
      toast.success(t("memory.deleted"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const recall = async () => {
    if (!recallQuery.trim()) return;
    setRecalling(true);
    try {
      const data = await api<{ items: { id: string; content: string; score: number; kind: string }[] }>(
        `/memories/search?q=${encodeURIComponent(recallQuery.trim())}`,
      );
      setRecallResults(data.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRecalling(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("memory.title")}
          subtitle={t("memory.subtitle")}
          actions={
            can("memory:write") && (
              <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                <Plus size={15} /> {t("memory.add")}
              </button>
            )
          }
        />

        {/* 召回测试 */}
        <div className="mb-5 rounded-2xl border border-line bg-gradient-to-br from-brand-soft/70 to-surface p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <Zap size={14} className="text-brand" />
            <span className="text-[12.5px] font-medium text-ink">{t("memory.recallTest")}</span>
            <span className="text-[11px] text-faint">hybrid · vector + keyword</span>
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={recallQuery}
              onChange={(e) => setRecallQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void recall()}
              placeholder={t("memory.recallPlaceholder")}
            />
            <button className="btn-primary shrink-0" onClick={() => void recall()} disabled={recalling || !recallQuery.trim()}>
              {recalling ? <Spinner size={14} className="text-white" /> : <Search size={14} />}
              <span className="hidden sm:inline">{t("memory.recall")}</span>
            </button>
          </div>
          {recallResults && (
            <div className="mt-3 space-y-1.5">
              {recallResults.length === 0 && <p className="text-[12px] text-faint">{t("common.noResult")}</p>}
              {recallResults.map((r) => (
                <div key={r.id} className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                  <span className={clsx("mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium", KIND_COLOR[r.kind] ?? "bg-elevated text-muted")}>
                    {t(`memory.kind${r.kind[0].toUpperCase()}${r.kind.slice(1)}`)}
                  </span>
                  <span className="flex-1 text-[12.5px] leading-relaxed text-muted">{r.content}</span>
                  <span className="shrink-0 font-mono text-[10px] text-brand">{r.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 过滤 */}
        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {[{ key: "all", label: "common.all" }, ...KINDS].map((k) => (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={clsx(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
                  kind === k.key ? "border-brand/30 bg-brand-soft text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
                )}
              >
                {t(k.label)}
              </button>
            ))}
          </div>
          <div className="relative sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("memory.searchPlaceholder")} />
          </div>
        </div>

        <div className="mb-3 text-[11.5px] text-faint">{t("memory.total", { n: total })}</div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Brain size={20} />}
            title={t("memory.empty")}
            description={t("memory.emptyDesc")}
            action={
              can("memory:write") && (
                <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                  <Plus size={15} /> {t("memory.writeFirst")}
                </button>
              )
            }
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map((m) => (
              <div key={m.id} className="group card p-3.5 transition hover:shadow-lift">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className={clsx("rounded-md px-1.5 py-0.5 text-[10px] font-medium", KIND_COLOR[m.kind])}>
                    {t(`memory.kind${m.kind[0].toUpperCase()}${m.kind.slice(1)}`)}
                  </span>
                  <span className="text-[10.5px] text-faint">{relativeTime(m.updatedAt, t)}</span>
                  <span className="flex-1" />
                  <div className="flex items-center gap-0.5 transition sm:opacity-0 sm:group-hover:opacity-100">
                    {can("memory:write") && (
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-faint hover:bg-elevated hover:text-ink"
                        onClick={() => setDraft({ id: m.id, content: m.content, kind: m.kind, importance: m.importance, tags: m.tags.join(", ") })}
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    {can("memory:delete") && (
                      <ConfirmButton
                        title={t("common.delete")}
                        description={m.content}
                        confirmLabel={t("common.delete")}
                        cancelLabel={t("common.cancel")}
                        danger
                        onConfirm={() => remove(m.id)}
                      >
                        <button className="flex h-6 w-6 items-center justify-center rounded-lg text-faint hover:bg-danger/10 hover:text-danger">
                          <Trash2 size={12} />
                        </button>
                      </ConfirmButton>
                    )}
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-ink">{m.content}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1 w-14 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${m.importance * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-faint">{t("memory.importance")} {Math.round(m.importance * 100)}%</span>
                  {m.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="chip py-0 text-[9.5px]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal
          open={Boolean(draft)}
          onClose={() => setDraft(null)}
          title={draft?.id ? t("common.edit") : t("memory.add")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void save()} disabled={saving || !draft?.content.trim()}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.save")}
              </button>
            </>
          }
        >
          {draft && (
            <>
              <Field label={t("memory.content")}>
                <textarea
                  className="input min-h-[110px] resize-y"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  placeholder={t("memory.emptyDesc")}
                  autoFocus
                />
              </Field>
              <Field label={t("memory.kind")}>
                <div className="flex flex-wrap gap-1.5">
                  {KINDS.map((k) => (
                    <button
                      key={k.key}
                      onClick={() => setDraft({ ...draft, kind: k.key })}
                      className={clsx(
                        "rounded-lg border px-2.5 py-1.5 text-[12px] transition",
                        draft.kind === k.key ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-line text-muted",
                      )}
                    >
                      {t(k.label)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`${t("memory.importance")} · ${Math.round(draft.importance * 100)}%`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.importance}
                  onChange={(e) => setDraft({ ...draft, importance: Number(e.target.value) })}
                  className="w-full accent-[var(--brand)]"
                />
              </Field>
              <Field label={`${t("memory.tags")} · ${t("common.optional")}`}>
                <input
                  className="input"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  placeholder="沟通风格, 团队"
                />
              </Field>
              <div className="flex items-start gap-2 rounded-xl bg-elevated px-3 py-2.5">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-brand" />
                <p className="text-[11.5px] leading-relaxed text-muted">{t("memory.emptyDesc")}</p>
              </div>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
