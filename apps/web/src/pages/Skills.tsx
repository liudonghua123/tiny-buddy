import { useCallback, useEffect, useState } from "react";
import { Plus, Sparkles, Trash2, Zap, FileText, X } from "lucide-react";
import clsx from "clsx";
import type { Skill } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner, Switch } from "../components/ui";

interface Draft {
  id?: string;
  key: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  triggers: string;
  resources: { name: string; content: string }[];
}

const EMPTY: Draft = {
  key: "",
  name: "",
  description: "",
  category: "general",
  instructions: "",
  triggers: "",
  resources: [],
};

export function SkillsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Skill[] }>("/skills");
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

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        key: draft.key,
        name: draft.name.trim(),
        description: draft.description.trim(),
        category: draft.category,
        instructions: draft.instructions,
        triggers: draft.triggers
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        resources: draft.resources.filter((r) => r.name.trim()),
      };
      if (draft.id) {
        const { key: _key, ...patch } = body;
        await api(`/skills/${draft.id}`, { method: "PATCH", body: patch });
      } else {
        await api("/skills", { method: "POST", body });
      }
      setDraft(null);
      setEditing(false);
      toast.success(t("common.saved"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (skill: Skill) => {
    try {
      await api(`/skills/${skill.id}`, { method: "PATCH", body: { enabled: !skill.enabled } });
      setItems((prev) => prev.map((s) => (s.id === skill.id ? { ...s, enabled: !s.enabled } : s)));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/skills/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== id));
      toast.success(t("common.deleted"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const open = (skill?: Skill) => {
    if (!skill) {
      setDraft({ ...EMPTY });
      setEditing(true);
      return;
    }
    setDraft({
      id: skill.id,
      key: skill.key,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      instructions: skill.instructions,
      triggers: (skill.triggers ?? []).join(", "),
      resources: skill.resources,
    });
    setEditing(false);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("skills.title")}
          subtitle={t("skills.subtitle")}
          actions={
            can("skill:write") && (
              <button className="btn-primary" onClick={() => open()}>
                <Plus size={15} /> {t("skills.create")}
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
            icon={<Sparkles size={20} />}
            title={t("skills.empty")}
            description={t("skills.emptyDesc")}
            action={
              can("skill:write") && (
                <button className="btn-primary" onClick={() => open()}>
                  <Plus size={15} /> {t("skills.create")}
                </button>
              )
            }
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map((skill) => {
              const triggers = skill.triggers ?? [];
              return (
                <div
                  key={skill.id}
                  className={clsx("group card cursor-pointer p-4 transition hover:shadow-lift", !skill.enabled && "opacity-60")}
                  onClick={() => open(skill)}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <Sparkles size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-[14px] font-semibold text-ink">{skill.name}</h3>
                        {skill.builtin ? (
                          <span className="chip py-0 text-[9.5px]">{t("skills.builtin")}</span>
                        ) : (
                          <span className="chip py-0 text-[9.5px]">{t("skills.custom")}</span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{skill.description}</p>
                    </div>
                    {can("skill:write") && (
                      <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 flex-col items-end gap-1">
                        <Switch checked={skill.enabled} onChange={() => void toggle(skill)} />
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {triggers.slice(0, 3).map((tr) => (
                      <span key={tr} className="rounded-md bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
                        {tr}
                      </span>
                    ))}
                    {skill.resources.length > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-faint">
                        <FileText size={10} /> {skill.resources.length}
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="flex items-center gap-0.5 text-[10px] text-faint">
                      <Zap size={10} /> {t("skills.usage", { n: skill.usageCount ?? 0 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Modal
          open={Boolean(draft)}
          onClose={() => {
            setDraft(null);
            setEditing(false);
          }}
          title={editing ? (draft?.id ? t("common.edit") : t("skills.create")) : draft?.name}
          wide
          footer={
            editing ? (
              <>
                <button
                  className="btn-outline"
                  onClick={() => {
                    setDraft(null);
                    setEditing(false);
                  }}
                >
                  {t("common.cancel")}
                </button>
                <button className="btn-primary" onClick={() => void save()} disabled={saving || !draft?.name.trim()}>
                  {saving && <Spinner size={14} className="text-white" />}
                  {t("common.save")}
                </button>
              </>
            ) : (
              <>
                {can("skill:write") && draft?.id && (
                  <ConfirmButton
                    title={t("skills.deleteConfirm", { name: draft.name })}
                    confirmLabel={t("common.delete")}
                    cancelLabel={t("common.cancel")}
                    danger
                    onConfirm={() => {
                      if (draft?.id) void remove(draft.id);
                    }}
                  >
                    <button className="btn-danger mr-auto">
                      <Trash2 size={14} /> {t("common.delete")}
                    </button>
                  </ConfirmButton>
                )}
                {can("skill:write") && (
                  <button className="btn-outline" onClick={() => setEditing(true)}>
                    {t("common.edit")}
                  </button>
                )}
              </>
            )
          }
        >
          {draft && !editing && (
            <>
              <p className="mb-4 text-[13px] leading-relaxed text-muted">{draft.description}</p>
              <div className="mb-4">
                <p className="label">{t("skills.instructions")}</p>
                <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-elevated p-3 text-[12px] leading-relaxed text-muted">
                  {draft.instructions || "—"}
                </pre>
              </div>
              <div>
                <p className="label">{t("skills.resources")}</p>
                {draft.resources.length === 0 && <p className="text-[12px] text-faint">—</p>}
                <div className="space-y-2">
                  {draft.resources.map((r) => (
                    <details key={r.name} className="rounded-xl border border-line bg-surface">
                      <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium text-ink">{r.name}</summary>
                      <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-muted">
                        {r.content}
                      </pre>
                    </details>
                  ))}
                </div>
              </div>
            </>
          )}

          {draft && editing && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("common.name")}>
                  <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label={t("skills.key")} hint="lowercase-with-dashes">
                  <input
                    className="input font-mono text-[12.5px]"
                    value={draft.key}
                    disabled={Boolean(draft.id)}
                    onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  />
                </Field>
              </div>
              <Field label={t("common.description")}>
                <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label={t("skills.triggers")} hint={t("skills.triggersHint")}>
                <input className="input" value={draft.triggers} onChange={(e) => setDraft({ ...draft, triggers: e.target.value })} />
              </Field>
              <Field label={t("skills.instructions")}>
                <textarea
                  className="input min-h-[150px] resize-y font-mono text-[12px] leading-relaxed"
                  value={draft.instructions}
                  onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                />
              </Field>
              <div className="mb-1 flex items-center justify-between">
                <span className="label mb-0">{t("skills.resources")}</span>
                <button
                  className="btn-ghost px-2 py-1 text-[11.5px]"
                  onClick={() => setDraft({ ...draft, resources: [...draft.resources, { name: "", content: "" }] })}
                >
                  <Plus size={12} /> {t("skills.addResource")}
                </button>
              </div>
              <div className="space-y-2">
                {draft.resources.map((r, i) => (
                  <div key={i} className="rounded-xl border border-line p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <input
                        className="input py-1.5 text-[12px]"
                        placeholder={t("skills.resourceName")}
                        value={r.name}
                        onChange={(e) => {
                          const next = [...draft.resources];
                          next[i] = { ...r, name: e.target.value };
                          setDraft({ ...draft, resources: next });
                        }}
                      />
                      <button
                        className="icon-btn h-7 w-7 shrink-0 hover:text-danger"
                        onClick={() => setDraft({ ...draft, resources: draft.resources.filter((_, idx) => idx !== i) })}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <textarea
                      className="input min-h-[70px] resize-y text-[12px]"
                      placeholder={t("skills.resourceContent")}
                      value={r.content}
                      onChange={(e) => {
                        const next = [...draft.resources];
                        next[i] = { ...r, content: e.target.value };
                        setDraft({ ...draft, resources: next });
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
