import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  ClipboardList,
  Copy,
  FileText,
  GitPullRequest,
  ListChecks,
  Mail,
  Pencil,
  Plus,
  Rocket,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import type { PromptTemplate } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner } from "../components/ui";

const ICONS: Record<string, typeof Sparkles> = {
  "file-text": FileText,
  "clipboard-list": ClipboardList,
  "list-checks": ListChecks,
  "git-pull-request": GitPullRequest,
  "shield-alert": ShieldAlert,
  search: Search,
  "bar-chart-3": BarChart3,
  mail: Mail,
  rocket: Rocket,
  scale: Scale,
  sparkles: Sparkles,
};

const CATEGORIES = ["writing", "dev", "meeting", "research", "analysis", "product", "general"] as const;

interface Draft {
  id?: string;
  title: string;
  description: string;
  body: string;
  category: string;
  icon: string;
  tags: string;
}

const EMPTY: Draft = { title: "", description: "", body: "", category: "general", icon: "sparkles", tags: "" };

export function PromptsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PromptTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: PromptTemplate[] }>("/prompts");
      setItems(data.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 从命令面板 / 检索结果跳过来时直接打开详情 */
  useEffect(() => {
    const id = params.get("open");
    if (!id || !items.length) return;
    const hit = items.find((p) => p.id === id);
    if (hit) setPreview(hit);
    params.delete("open");
    setParams(params, { replace: true });
  }, [params, items, setParams]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((p) => {
      if (category === "all") return true;
      return p.category === category;
    }).filter((p) => {
      if (!term) return true;
      return [p.title, p.description, p.body, ...p.tags].join(" ").toLowerCase().includes(term);
    });
  }, [items, q, category]);

  const stats = useMemo(
    () => ({ total: items.length, builtin: items.filter((p) => p.builtin).length }),
    [items],
  );

  const use = async (p: PromptTemplate) => {
    void api(`/prompts/${p.id}/use`, { method: "POST" }).catch(() => undefined);
    navigate(`/chat?prompt=${p.id}`);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      toast.error(t("prompts.required"));
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        body: draft.body,
        category: draft.category,
        icon: draft.icon,
        tags: draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
      };
      if (draft.id) await api(`/prompts/${draft.id}`, { method: "PATCH", body });
      else await api("/prompts", { method: "POST", body });
      setDraft(null);
      toast.success(t("common.saved"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (p: PromptTemplate) => {
    try {
      await api(`/prompts/${p.id}/duplicate`, { method: "POST" });
      toast.success(t("prompts.duplicated"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (p: PromptTemplate) => {
    try {
      await api(`/prompts/${p.id}`, { method: "DELETE" });
      toast.success(t("common.deleted"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-20 sm:px-6 sm:py-7 lg:pb-8">
        <PageHeader
          title={t("prompts.title")}
          subtitle={t("prompts.subtitle")}
          actions={
            can("prompt:write") && (
              <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                <Plus size={15} /> {t("prompts.new")}
              </button>
            )
          }
        />

        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-[260px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("prompts.searchPlaceholder")}
              className="input pl-8"
            />
          </div>
          <p className="text-[11.5px] text-faint">
            {t("prompts.count", { total: stats.total, builtin: stats.builtin, custom: stats.total - stats.builtin })}
          </p>
        </div>

        <div className="scroll-thin -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["all", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={clsx(
                "shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition",
                category === c
                  ? "border-brand/30 bg-brand-soft text-brand-ink"
                  : "border-line text-muted hover:border-faint/50 hover:text-ink",
              )}
            >
              {t(`prompts.cat.${c}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title={q ? t("prompts.emptySearch") : t("prompts.empty")}
            description={q ? t("prompts.emptySearchDesc") : t("prompts.emptyDesc")}
            action={
              can("prompt:write") && !q ? (
                <button className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                  <Plus size={15} /> {t("prompts.new")}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const Icon = ICONS[p.icon] ?? Sparkles;
              return (
                <div key={p.id} className="card group flex flex-col p-4 transition hover:border-faint/50">
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-[13.5px] font-semibold text-ink">{p.title}</h3>
                        {p.builtin && <span className="chip shrink-0 py-0 text-[9.5px]">{t("prompts.builtin")}</span>}
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-faint">{t(`prompts.cat.${p.category}`)}</p>
                    </div>
                  </div>

                  <p className="mt-2.5 line-clamp-2 min-h-[34px] text-[12.5px] leading-relaxed text-muted">{p.description}</p>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-md bg-elevated px-1.5 py-0.5 text-[10px] text-faint">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-3">
                    <span className="text-[10.5px] text-faint">{t("prompts.used", { n: p.usageCount })}</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => setPreview(p)} className="btn-ghost h-7 px-2 text-[11.5px]">
                        {t("prompts.view")}
                      </button>
                      <button
                        onClick={() => void use(p)}
                        className="flex h-7 items-center gap-1 rounded-lg bg-brand-soft px-2 text-[11.5px] font-medium text-brand-ink transition hover:bg-brand-soft/80"
                      >
                        <Zap size={11} /> {t("prompts.use")}
                      </button>
                      <button
                        onClick={() => void duplicate(p)}
                        className="icon-btn h-7 w-7"
                        title={t("prompts.duplicate")}
                        aria-label={t("prompts.duplicate")}
                      >
                        <Copy size={13} />
                      </button>
                      {!p.builtin && can("prompt:write") && (
                        <>
                          <button
                            onClick={() =>
                              setDraft({
                                id: p.id,
                                title: p.title,
                                description: p.description,
                                body: p.body,
                                category: p.category,
                                icon: p.icon,
                                tags: p.tags.join(", "),
                              })
                            }
                            className="icon-btn h-7 w-7"
                            title={t("common.edit")}
                            aria-label={t("common.edit")}
                          >
                            <Pencil size={13} />
                          </button>
                          <ConfirmButton
                            title={t("prompts.deleteConfirm", { title: p.title })}
                            confirmLabel={t("common.delete")}
                            cancelLabel={t("common.cancel")}
                            danger
                            onConfirm={() => remove(p)}
                          >
                            <button className="icon-btn h-7 w-7 hover:text-danger" title={t("common.delete")} aria-label={t("common.delete")}>
                              <Trash2 size={13} />
                            </button>
                          </ConfirmButton>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-[11.5px] leading-relaxed text-faint">{t("prompts.tip")}</p>
      </div>

      {/* 详情 */}
      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ""}
        wide
        footer={
          preview && (
            <>
              <button className="btn-outline" onClick={() => void duplicate(preview)}>
                <Copy size={13} /> {t("prompts.duplicate")}
              </button>
              <button className="btn-primary" onClick={() => void use(preview)}>
                <Zap size={14} /> {t("prompts.use")}
              </button>
            </>
          )
        }
      >
        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip">{t(`prompts.cat.${preview.category}`)}</span>
              {preview.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
              <span className="ml-auto text-[10.5px] text-faint">{t("prompts.used", { n: preview.usageCount })}</span>
            </div>
            {preview.description && <p className="mt-3 text-[13px] leading-relaxed text-muted">{preview.description}</p>}
            <pre className="scroll-thin mt-3 max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-elevated/60 px-3.5 py-3 font-sans text-[12.5px] leading-[1.75] text-ink">
              {preview.body}
            </pre>
            <p className="mt-2 text-[11px] text-faint">{t("prompts.placeholderHint")}</p>
          </>
        )}
      </Modal>

      {/* 新建 / 编辑 */}
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("prompts.editTitle") : t("prompts.newTitle")}
        wide
        footer={
          <>
            <button className="btn-outline" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </button>
            <button className="btn-primary" disabled={saving} onClick={() => void save()}>
              {saving && <Spinner size={14} className="text-white" />}
              {t("common.save")}
            </button>
          </>
        }
      >
        {draft && (
          <>
            <Field label={t("prompts.fTitle")}>
              <input
                className="input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={t("prompts.fTitlePlaceholder")}
                autoFocus
              />
            </Field>
            <Field label={t("prompts.fDesc")}>
              <input
                className="input"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={t("prompts.fDescPlaceholder")}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("prompts.fCategory")}>
                <select
                  className="input"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`prompts.cat.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("prompts.fTags")} hint={t("prompts.fTagsHint")}>
                <input
                  className="input"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  placeholder="周报, 汇报"
                />
              </Field>
            </div>
            <Field label={t("prompts.fBody")} hint={t("prompts.fBodyHint")}>
              <textarea
                className="input scroll-thin min-h-[220px] resize-y font-mono text-[12.5px] leading-relaxed"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder={t("prompts.fBodyPlaceholder")}
              />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}
