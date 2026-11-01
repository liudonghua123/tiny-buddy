import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, FolderPlus, Library, Plus, Search, Trash2, FileText, Database } from "lucide-react";
import clsx from "clsx";
import type { KbDocument, KnowledgeBase } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner } from "../components/ui";

interface SearchHit {
  id: string;
  content: string;
  docName: string;
  kbName: string;
  score: number;
}

export function KnowledgePage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();

  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [kbModal, setKbModal] = useState(false);
  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");

  const [docModal, setDocModal] = useState(false);
  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: KnowledgeBase[] }>("/knowledge/bases");
      setBases(data.items);
      setActiveId((prev) => prev ?? data.items[0]?.id ?? null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadDocs = useCallback(
    async (kbId: string) => {
      setDocsLoading(true);
      try {
        const data = await api<{ items: KbDocument[] }>(`/knowledge/bases/${kbId}/documents`);
        setDocs(data.items);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setDocsLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadBases();
  }, [loadBases]);

  useEffect(() => {
    if (activeId) void loadDocs(activeId);
  }, [activeId, loadDocs]);

  const createKb = async () => {
    if (!kbName.trim()) return;
    setSaving(true);
    try {
      const data = await api<{ kb: KnowledgeBase }>("/knowledge/bases", {
        method: "POST",
        body: { name: kbName.trim(), description: kbDesc.trim() },
      });
      setKbModal(false);
      setKbName("");
      setKbDesc("");
      await loadBases();
      setActiveId(data.kb.id);
      toast.success(t("common.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addDoc = async () => {
    if (!activeId || !docName.trim() || docContent.trim().length < 10) return;
    setSaving(true);
    try {
      const data = await api<{ document: KbDocument }>(`/knowledge/bases/${activeId}/documents`, {
        method: "POST",
        body: { name: docName.trim(), content: docContent },
      });
      setDocModal(false);
      setDocName("");
      setDocContent("");
      toast.success(t("knowledge.ingested", { n: data.document.chunks }));
      void loadDocs(activeId);
      void loadBases();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeDoc = async (id: string) => {
    if (!activeId) return;
    try {
      await api(`/knowledge/documents/${id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      void loadBases();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const removeKb = async (id: string) => {
    try {
      await api(`/knowledge/bases/${id}`, { method: "DELETE" });
      setBases((prev) => prev.filter((b) => b.id !== id));
      if (activeId === id) setActiveId(bases.find((b) => b.id !== id)?.id ?? null);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const search = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: searchQ.trim() });
      if (activeId) params.set("kbId", activeId);
      const data = await api<{ items: SearchHit[] }>(`/knowledge/search?${params.toString()}`);
      setHits(data.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDocName(file.name);
      setDocContent(String(reader.result ?? ""));
      setDocModal(true);
    };
    reader.readAsText(file);
  };

  const active = bases.find((b) => b.id === activeId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("knowledge.title")}
          subtitle={t("knowledge.subtitle")}
          actions={
            can("knowledge:write") && (
              <button className="btn-primary" onClick={() => setKbModal(true)}>
                <FolderPlus size={15} /> {t("knowledge.newKb")}
              </button>
            )
          }
        />

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : bases.length === 0 ? (
          <EmptyState
            icon={<Library size={20} />}
            title={t("knowledge.empty")}
            description={t("knowledge.emptyDesc")}
            action={
              can("knowledge:write") && (
                <button className="btn-primary" onClick={() => setKbModal(true)}>
                  <FolderPlus size={15} /> {t("knowledge.newKb")}
                </button>
              )
            }
          />
        ) : (
          <>
            {/* 知识库选择 */}
            <div className="scroll-thin -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {bases.map((kb) => (
                <button
                  key={kb.id}
                  onClick={() => {
                    setActiveId(kb.id);
                    setHits(null);
                  }}
                  className={clsx(
                    "group relative shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition",
                    activeId === kb.id
                      ? "border-brand/35 bg-brand-soft/60"
                      : "border-line bg-surface hover:border-faint/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Database size={13} className={activeId === kb.id ? "text-brand" : "text-faint"} />
                    <span className={clsx("text-[13px] font-medium", activeId === kb.id ? "text-brand-ink" : "text-ink")}>{kb.name}</span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-faint">
                    {kb.docCount} {t("knowledge.docs")} · {kb.chunkCount} {t("knowledge.chunks")}
                  </div>
                </button>
              ))}
            </div>

            {/* 检索 */}
            <div className="mb-4 flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  className="input pl-8"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                  placeholder={t("knowledge.searchPlaceholder")}
                />
              </div>
              <button className="btn-outline shrink-0" onClick={() => void search()} disabled={searching || !searchQ.trim()}>
                {searching ? <Spinner size={14} /> : <Search size={14} />}
                <span className="hidden sm:inline">{t("common.search")}</span>
              </button>
            </div>

            {hits && (
              <div className="mb-5 rounded-2xl border border-line bg-surface p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-ink">{t("knowledge.searchResult")}</span>
                  <button className="text-[11px] text-faint hover:text-ink" onClick={() => setHits(null)}>
                    {t("common.close")}
                  </button>
                </div>
                {hits.length === 0 ? (
                  <p className="py-2 text-[12.5px] text-faint">{t("knowledge.searchEmpty")}</p>
                ) : (
                  <div className="space-y-2">
                    {hits.map((h) => (
                      <div key={h.id} className="rounded-xl bg-elevated px-3 py-2.5">
                        <div className="mb-1 flex items-center gap-2 text-[10.5px] text-faint">
                          <FileText size={10} />
                          <span className="font-medium text-muted">{h.docName}</span>
                          <span>· {h.kbName}</span>
                          <span className="flex-1" />
                          <span className="font-mono text-brand">{h.score.toFixed(2)}</span>
                        </div>
                        <p className="text-[12.5px] leading-relaxed text-muted">{h.content.slice(0, 320)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 文档 */}
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[13.5px] font-semibold text-ink">{active?.name}</h3>
                  <p className="truncate text-[11px] text-faint">{active?.description || "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {can("knowledge:write") && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".md,.txt,.json,.csv,.log"
                        className="hidden"
                        onChange={(e) => {
                          onFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <button className="btn-outline px-2.5 py-1.5 text-[11.5px]" onClick={() => fileRef.current?.click()}>
                        <FileUp size={13} /> <span className="hidden sm:inline">{t("knowledge.upload")}</span>
                      </button>
                      <button className="btn-primary px-2.5 py-1.5 text-[11.5px]" onClick={() => setDocModal(true)}>
                        <Plus size={13} /> <span className="hidden sm:inline">{t("knowledge.addDoc")}</span>
                      </button>
                      <ConfirmButton
                        title={t("knowledge.deleteKbConfirm", { name: active?.name ?? "" })}
                        confirmLabel={t("common.delete")}
                        cancelLabel={t("common.cancel")}
                        danger
                        onConfirm={() => active && removeKb(active.id)}
                      >
                        <button className="icon-btn h-8 w-8 hover:text-danger">
                          <Trash2 size={14} />
                        </button>
                      </ConfirmButton>
                    </>
                  )}
                </div>
              </div>

              {docsLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : docs.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <FileText size={22} className="mx-auto mb-2 text-faint" />
                  <p className="text-[12.5px] text-faint">{t("knowledge.noDocs")}</p>
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {docs.map((doc) => (
                    <div key={doc.id} className="group flex items-center gap-3 px-4 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-faint">
                        <FileText size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-ink">{doc.name}</div>
                        <div className="text-[10.5px] text-faint">
                          {doc.chunks} {t("knowledge.chunks")} · {doc.size} 字符 · {relativeTime(doc.createdAt, t)}
                        </div>
                      </div>
                      {can("knowledge:write") && (
                        <ConfirmButton
                          title={t("knowledge.deleteDocConfirm", { name: doc.name })}
                          confirmLabel={t("common.delete")}
                          cancelLabel={t("common.cancel")}
                          danger
                          onConfirm={() => removeDoc(doc.id)}
                        >
                          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-faint opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100">
                            <Trash2 size={12} />
                          </button>
                        </ConfirmButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* 新建知识库 */}
        <Modal
          open={kbModal}
          onClose={() => setKbModal(false)}
          title={t("knowledge.newKb")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setKbModal(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void createKb()} disabled={saving || !kbName.trim()}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.create")}
              </button>
            </>
          }
        >
          <Field label={t("common.name")}>
            <input className="input" value={kbName} onChange={(e) => setKbName(e.target.value)} autoFocus />
          </Field>
          <Field label={t("common.description")}>
            <input className="input" value={kbDesc} onChange={(e) => setKbDesc(e.target.value)} />
          </Field>
        </Modal>

        {/* 添加文档 */}
        <Modal
          open={docModal}
          onClose={() => setDocModal(false)}
          title={t("knowledge.addDoc")}
          wide
          footer={
            <>
              <button className="btn-outline" onClick={() => setDocModal(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void addDoc()} disabled={saving || !docName.trim() || docContent.trim().length < 10}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.save")}
              </button>
            </>
          }
        >
          <Field label={t("knowledge.docName")}>
            <input className="input" value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="产品说明.md" autoFocus />
          </Field>
          <Field label={t("knowledge.content")} hint={t("knowledge.uploadHint")}>
            <textarea
              className="input scroll-thin min-h-[220px] resize-y font-mono text-[12px] leading-relaxed"
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="# 标题&#10;&#10;正文…"
            />
          </Field>
        </Modal>
      </div>
    </div>
  );
}
