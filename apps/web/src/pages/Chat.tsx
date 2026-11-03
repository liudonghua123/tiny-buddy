import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowUp,
  BarChart3,
  Brain,
  ChevronDown,
  ChevronLeft,
  Code2,
  Download,
  Eraser,
  FileText,
  History,
  Languages,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { AgentEvent, Message, MessagePart, Session, Skill, ToolCallPart } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { streamChat, streamEdit, streamRegenerate } from "../lib/sse";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { formatBytes } from "../lib/format";
import { useToast } from "../lib/toast";
import { downloadText, safeFilename } from "../lib/download";
import {
  collectAttachments,
  composeWithAttachments,
  MAX_FILES,
  parseAttachments,
  type Attachment,
} from "../lib/attachments";
import { Modal, Spinner } from "../components/ui";
import { MessageRow, MemoryBadge } from "../components/chat/MessageRow";
import { SessionList } from "../components/chat/SessionList";
import { SlashCommands, type SlashItem } from "../components/chat/SlashCommands";

interface LiveState {
  text: string;
  /** 按到达顺序累积的片段，保证「文本 → 工具 → 文本」的交错顺序与最终消息一致 */
  parts: MessagePart[];
  tools: ToolCallPart[];
  memories: { id: string; content: string; score?: number; kind?: string }[];
  skill?: { key: string; name: string };
  wroteMemory: boolean;
}

interface EditTarget {
  message: Message;
  text: string;
  files: Attachment[];
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillKey, setSkillKey] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [menuSession, setMenuSession] = useState<Session | null>(null);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api<{ items: Session[] }>("/sessions");
      setSessions(data.items);
    } catch {
      /* ignore */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadSession = useCallback(
    async (sid: string) => {
      setLoading(true);
      try {
        const data = await api<{ session: Session; messages: Message[] }>(`/sessions/${sid}`);
        setSession(data.session);
        setMessages(data.messages);
        setSkillKey(data.session.skillKey ?? "");
      } catch {
        toast.error(t("error.loadFailed"));
        navigate("/chat", { replace: true });
      } finally {
        setLoading(false);
      }
    },
    [navigate, t, toast],
  );

  useEffect(() => {
    void loadSessions();
    api<{ items: Skill[] }>("/skills")
      .then((d) => setSkills(d.items.filter((s) => s.enabled)))
      .catch(() => undefined);
  }, [loadSessions]);

  useEffect(() => {
    if (id) {
      void loadSession(id);
    } else {
      setSession(null);
      setMessages([]);
      setLive(null);
      setSkillKey("");
      setAttachments([]);
    }
  }, [id, loadSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live?.text, live?.parts.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "run.start":
          setLive({ text: "", parts: [], tools: [], memories: [], wroteMemory: false });
          break;
        case "skill.active":
          setLive((prev) => (prev ? { ...prev, skill: { key: event.key, name: event.name } } : prev));
          break;
        case "memory.recall":
          setLive((prev) => (prev ? { ...prev, memories: event.items } : prev));
          break;
        case "text.delta":
          setLive((prev) => {
            if (!prev) return prev;
            const parts = [...prev.parts];
            const last = parts[parts.length - 1];
            if (last && last.type === "text") {
              parts[parts.length - 1] = { ...last, text: last.text + event.delta };
            } else {
              parts.push({ type: "text", text: event.delta });
            }
            return { ...prev, text: prev.text + event.delta, parts };
          });
          break;
        case "tool.start":
          setLive((prev) => {
            if (!prev) return prev;
            const part: ToolCallPart = {
              type: "tool",
              id: event.toolCallId,
              name: event.name,
              title: event.title,
              input: event.input,
              status: "running",
              source: event.source,
            };
            return { ...prev, tools: [...prev.tools, part], parts: [...prev.parts, part] };
          });
          break;
        case "tool.end":
          setLive((prev) => {
            if (!prev) return prev;
            const patch = (tool: ToolCallPart): ToolCallPart =>
              tool.id === event.toolCallId
                ? { ...tool, status: event.ok ? "done" : "error", output: event.output, durationMs: event.durationMs }
                : tool;
            return {
              ...prev,
              tools: prev.tools.map(patch),
              parts: prev.parts.map((part) => (part.type === "tool" ? patch(part) : part)),
            };
          });
          break;
        case "memory.write":
          setLive((prev) => (prev ? { ...prev, wroteMemory: true } : prev));
          toast.success(t("chat.memorySaved"));
          break;
        case "error":
          toast.error(event.message);
          break;
        default:
          break;
      }
    },
    [t, toast],
  );

  const reloadCurrent = useCallback(
    async (sid: string) => {
      try {
        const data = await api<{ session: Session; messages: Message[] }>(`/sessions/${sid}`);
        setMessages(data.messages);
        setSession(data.session);
      } catch {
        /* ignore */
      }
      setLive(null);
      void loadSessions();
    },
    [loadSessions],
  );

  const send = useCallback(
    async (raw?: string) => {
      const typed = (raw ?? input).trim();
      const files = raw === undefined ? attachments : [];
      if ((!typed && files.length === 0) || sending || attachBusy || !user) return;

      const content = composeWithAttachments(typed || t("chat.attachmentOnlyPrompt"), files);
      setSending(true);
      setInput("");
      if (raw === undefined) setAttachments([]);
      setSlashDismissed(false);

      let sid = id;
      let created = false;
      try {
        if (!sid) {
          const titleSource = typed || files[0]?.name || t("chat.newChat");
          const data = await api<{ session: Session }>("/sessions", {
            method: "POST",
            body: { title: titleSource.replace(/\s+/g, " ").slice(0, 24) },
          });
          sid = data.session.id;
          created = true;
          setSession(data.session);
          setMessages([]);
          navigate(`/chat/${sid}`, { replace: true });
        }

        const optimistic: Message = {
          id: `tmp_${Date.now()}`,
          sessionId: sid,
          role: "user",
          content,
          parts: [{ type: "text", text: content }],
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimistic]);
        setLive({ text: "", parts: [], tools: [], memories: [], wroteMemory: false });

        const controller = new AbortController();
        abortRef.current = controller;

        await streamChat(
          sid,
          content,
          {
            onEvent: handleEvent,
            onError: (msg) => toast.error(msg),
            signal: controller.signal,
          },
          skillKey || null,
        );
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        abortRef.current = null;
        if (sid) await reloadCurrent(sid);
        setSending(false);
        if (created) setTimeout(() => textareaRef.current?.focus(), 60);
      }
    },
    [input, attachments, attachBusy, sending, user, id, navigate, handleEvent, toast, reloadCurrent, skillKey, t],
  );

  const regenerate = useCallback(async () => {
    if (!id || sending) return;
    setSending(true);
    setLive({ text: "", parts: [], tools: [], memories: [], wroteMemory: false });
    // 立即移除旧回答，避免与新的流式内容并存
    setMessages((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          idx = i;
          break;
        }
      }
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamRegenerate(id, {
        onEvent: handleEvent,
        onError: (msg) => toast.error(msg),
        signal: controller.signal,
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      abortRef.current = null;
      await reloadCurrent(id);
      setSending(false);
    }
  }, [id, sending, handleEvent, toast, reloadCurrent]);

  const submitEdit = useCallback(async () => {
    if (!id || !editTarget || sending) return;
    const composed = composeWithAttachments(editTarget.text.trim(), editTarget.files);
    if (!composed.trim()) return;

    const targetId = editTarget.message.id;
    setEditTarget(null);
    setSending(true);
    setLive({ text: "", parts: [], tools: [], memories: [], wroteMemory: false });
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === targetId);
      if (idx < 0) return prev;
      const next = prev.slice(0, idx + 1);
      next[idx] = { ...next[idx], content: composed, parts: [{ type: "text", text: composed }] };
      return next;
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamEdit(id, targetId, composed, {
        onEvent: handleEvent,
        onError: (msg) => toast.error(msg),
        signal: controller.signal,
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      abortRef.current = null;
      await reloadCurrent(id);
      setSending(false);
    }
  }, [id, editTarget, sending, handleEvent, toast, reloadCurrent]);

  const stop = () => {
    abortRef.current?.abort();
    setSending(false);
    toast.info(t("chat.stopped"));
  };

  const removeSession = async (target: Session) => {
    try {
      await api(`/sessions/${target.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      if (target.id === id) navigate("/chat", { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const bulkDelete = async (ids: string[]) => {
    try {
      const data = await api<{ deleted: number }>("/sessions/bulk-delete", { method: "POST", body: { ids } });
      setSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
      if (id && ids.includes(id)) navigate("/chat", { replace: true });
      toast.success(t("chat.deletedCount", { n: data.deleted }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const togglePin = async (target: Session) => {
    const next = !target.pinned;
    setSessions((prev) => sortSessions(prev.map((s) => (s.id === target.id ? { ...s, pinned: next } : s))));
    setSession((prev) => (prev && prev.id === target.id ? { ...prev, pinned: next } : prev));
    setMenuSession(null);
    try {
      await api(`/sessions/${target.id}`, { method: "PATCH", body: { pinned: next } });
    } catch (err) {
      toast.error((err as Error).message);
      void loadSessions();
    }
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) return;
    try {
      await api(`/sessions/${renameTarget.id}`, { method: "PATCH", body: { title } });
      setSessions((prev) => prev.map((s) => (s.id === renameTarget.id ? { ...s, title } : s)));
      setSession((prev) => (prev && prev.id === renameTarget.id ? { ...prev, title } : prev));
      setRenameTarget(null);
      toast.success(t("common.save"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const exportSession = async (target: Session) => {
    setMenuSession(null);
    try {
      const data = await api<{ session: Session; messages: Message[] }>(`/sessions/${target.id}`);
      const lines: string[] = [
        `# ${data.session.title}`,
        "",
        `> ${t("chat.exportedAt")} ${new Date().toLocaleString()}`,
        "",
      ];
      for (const m of data.messages) {
        const parsed = parseAttachments(m.content);
        lines.push(m.role === "user" ? `## ${t("chat.you")}` : "## TinyBuddy", "");
        if (parsed.files.length) {
          lines.push(...parsed.files.map((f) => `- attachment: ${f.name} (${formatBytes(f.size)})`), "");
        }
        if (parsed.text) lines.push(parsed.text, "");
        const tools = (m.parts ?? []).filter((p): p is ToolCallPart => p.type === "tool");
        if (tools.length) {
          lines.push(tools.map((tool) => `\`${tool.name}\` (${tool.status}, ${tool.durationMs ?? 0}ms)`).join(" · "), "");
        }
      }
      downloadText(`${safeFilename(target.title)}.md`, lines.join("\n"));
      toast.success(t("chat.exported"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setAttachBusy(true);
    try {
      const { accepted, rejected } = await collectAttachments([...list], attachments);
      if (accepted.length) setAttachments((prev) => [...prev, ...accepted].slice(0, MAX_FILES));
      if (rejected.length) toast.error(t("chat.attachRejected", { n: rejected.length }));
    } finally {
      setAttachBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const activeSkill = useMemo(() => skills.find((s) => s.key === skillKey), [skills, skillKey]);

  const slashItems: SlashItem[] = useMemo(
    () => [
      { key: "new", label: t("chat.cmdNew"), hint: "/new", description: t("chat.cmdNewDesc"), icon: Plus },
      { key: "clear", label: t("chat.cmdClear"), hint: "/clear", description: t("chat.cmdClearDesc"), icon: Eraser },
      { key: "skill", label: t("chat.cmdSkill"), hint: "/skill", description: t("chat.cmdSkillDesc"), icon: Sparkles },
      { key: "export", label: t("chat.cmdExport"), hint: "/export", description: t("chat.cmdExportDesc"), icon: Download },
      { key: "memory", label: t("chat.cmdMemory"), hint: "/memory", description: t("chat.cmdMemoryDesc"), icon: Brain },
      { key: "usage", label: t("chat.cmdUsage"), hint: "/usage", description: t("chat.cmdUsageDesc"), icon: BarChart3 },
      { key: "summary", label: t("chat.cmdSummary"), hint: "/summary", description: t("chat.cmdSummaryDesc"), icon: FileText },
      { key: "translate", label: t("chat.cmdTranslate"), hint: "/translate", description: t("chat.cmdTranslateDesc"), icon: Languages },
      { key: "review", label: t("chat.cmdReview"), hint: "/review", description: t("chat.cmdReviewDesc"), icon: Code2 },
    ],
    [t],
  );

  const slashQuery = input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  const slashVisible = slashQuery !== null && !slashDismissed && !sending;
  const slashFiltered = useMemo(
    () =>
      slashVisible
        ? slashItems.filter((item) => item.key.includes(slashQuery!.trim()) || item.label.toLowerCase().includes(slashQuery!.trim()))
        : [],
    [slashVisible, slashItems, slashQuery],
  );
  const slashActive = Math.min(slashIndex, Math.max(0, slashFiltered.length - 1));

  const applySlash = (item: SlashItem) => {
    setSlashDismissed(true);
    setSlashIndex(0);
    switch (item.key) {
      case "new":
        setInput("");
        navigate("/chat");
        break;
      case "clear":
        setInput("");
        setAttachments([]);
        navigate("/chat");
        toast.info(t("chat.cleared"));
        break;
      case "skill":
        setInput("");
        setSkillOpen(true);
        break;
      case "export":
        setInput("");
        if (session) void exportSession(session);
        else toast.info(t("chat.exportEmpty"));
        break;
      case "memory":
        setInput("");
        navigate("/memory");
        break;
      case "usage":
        setInput("");
        navigate("/usage");
        break;
      case "summary":
        setInput(t("chat.cmdSummaryPrompt"));
        break;
      case "translate":
        setInput(t("chat.cmdTranslatePrompt"));
        break;
      case "review":
        setInput(t("chat.cmdReviewPrompt"));
        break;
      default:
        break;
    }
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  const liveMessage: Message | null = live
    ? {
        id: "live",
        sessionId: id ?? "",
        role: "assistant",
        content: live.text,
        parts: live.parts,
        createdAt: new Date().toISOString(),
      }
    : null;

  const isEmpty = !loading && messages.length === 0 && !live;
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && !attachBusy;

  return (
    <div className="flex h-full min-h-0">
      {/* 桌面会话列表 */}
      <div className="hidden w-[268px] shrink-0 flex-col border-r border-line bg-surface/50 lg:flex">
        <SessionList
          sessions={sessions}
          activeId={id}
          loading={sessionsLoading}
          onNew={() => navigate("/chat")}
          onSelect={(sid) => navigate(`/chat/${sid}`)}
          onMenu={(s) => setMenuSession(s)}
          onBulkDelete={bulkDelete}
        />
      </div>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="safe-top flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:h-14 sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {id && (
              <button className="icon-btn lg:hidden" onClick={() => navigate("/chat")} aria-label={t("chat.newChat")}>
                <ChevronLeft size={18} />
              </button>
            )}
            <button className="flex min-w-0 items-center gap-1.5" onClick={() => setHistoryOpen(true)}>
              {session?.pinned && <Pin size={12} className="shrink-0 text-brand" fill="currentColor" />}
              <span className="truncate text-[14px] font-medium text-ink">{session?.title ?? t("chat.newChat")}</span>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="icon-btn lg:hidden" onClick={() => setHistoryOpen(true)} title={t("chat.history")}>
              <History size={16} />
            </button>
            {id && session && (
              <>
                <button
                  className={clsx("icon-btn", session.pinned && "text-brand")}
                  onClick={() => void togglePin(session)}
                  title={session.pinned ? t("chat.unpin") : t("chat.pin")}
                  aria-label={session.pinned ? t("chat.unpin") : t("chat.pin")}
                >
                  {session.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setMenuSession(session)}
                  title={t("common.actions")}
                  aria-label={t("common.actions")}
                >
                  <MoreHorizontal size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-3 py-4 sm:px-6 sm:py-6">
            {loading && (
              <div className="flex justify-center py-16">
                <Spinner size={20} />
              </div>
            )}

            {isEmpty && (
              <div className="flex flex-col items-center pt-8 sm:pt-16">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#8b6dff] to-[#5b3ae0] shadow-[0_12px_30px_-12px_rgba(109,74,255,.8)]">
                  <Sparkles size={24} className="text-white" />
                </div>
                <h2 className="text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">{t("chat.emptyTitle")}</h2>
                <p className="mt-2 max-w-md text-center text-[13.5px] leading-relaxed text-muted">{t("chat.emptyDesc")}</p>

                <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {[t("chat.suggestion1"), t("chat.suggestion2"), t("chat.suggestion3"), t("chat.suggestion4")].map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-[12.5px] leading-relaxed text-muted transition hover:border-brand/30 hover:bg-brand-soft/40 hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setInput("/");
                    setSlashDismissed(false);
                    textareaRef.current?.focus();
                  }}
                  className="mt-5 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[11.5px] text-faint transition hover:border-brand/30 hover:text-muted"
                >
                  <span className="rounded bg-elevated px-1 font-mono text-[10px] text-muted">/</span>
                  {t("chat.commandsHint")}
                </button>
              </div>
            )}

            <div className="space-y-5">
              {messages.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  onEdit={
                    m.role === "user" && !sending
                      ? (message) => {
                          const parsed = parseAttachments(message.content);
                          setEditTarget({ message, text: parsed.text, files: parsed.files });
                        }
                      : undefined
                  }
                  onRegenerate={
                    m.role === "assistant" && i === messages.length - 1 && !sending ? regenerate : undefined
                  }
                />
              ))}

              {live && (
                <div className="animate-fade-up">
                  {live.memories.length > 0 && <MemoryBadge count={live.memories.length} items={live.memories} />}
                  {live.skill && (
                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1 text-[11px] text-muted">
                      <Sparkles size={11} className="text-brand" /> {live.skill.name}
                    </div>
                  )}
                  {liveMessage && (liveMessage.content || live.tools.length > 0) ? (
                    <MessageRow message={liveMessage} streaming={sending} />
                  ) : (
                    sending && (
                      <div className="flex items-center gap-2 text-[12.5px] text-faint">
                        <span className="flex gap-1">
                          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand" />
                          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand [animation-delay:300ms]" />
                        </span>
                        {t("chat.thinking")}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
            <div ref={bottomRef} className="h-2" />
          </div>
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-line bg-bg/80 px-3 pb-3 pt-2.5 backdrop-blur sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-[760px]">
            <div className="relative rounded-2xl border border-line bg-surface shadow-soft transition focus-within:border-brand/40 focus-within:ring-4 focus-within:ring-brand/10">
              {slashVisible && (
                <SlashCommands
                  items={slashFiltered}
                  active={slashActive}
                  onPick={applySlash}
                  onHover={setSlashIndex}
                />
              )}

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                  {attachments.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="flex max-w-[240px] items-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] text-muted"
                    >
                      <Paperclip size={10} className="shrink-0 text-brand" />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-[10px] text-faint">{formatBytes(f.size)}</span>
                      <button
                        onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                        className="shrink-0 text-faint transition hover:text-danger"
                        aria-label={t("chat.removeAttachment")}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setSlashIndex(0);
                  setSlashDismissed(false);
                }}
                onKeyDown={(e) => {
                  if (slashVisible && slashFiltered.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashIndex((slashActive + 1) % slashFiltered.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashIndex((slashActive - 1 + slashFiltered.length) % slashFiltered.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      applySlash(slashFiltered[slashActive]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSlashDismissed(true);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={t("chat.placeholder")}
                className="scroll-thin max-h-40 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
              />

              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    onClick={() => setSkillOpen(true)}
                    className={clsx(
                      "flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] transition",
                      activeSkill ? "bg-brand-soft text-brand-ink" : "text-faint hover:bg-elevated hover:text-muted",
                    )}
                  >
                    <Sparkles size={12} />
                    <span className="max-w-[110px] truncate">{activeSkill ? activeSkill.name : t("chat.autoSkill")}</span>
                    <ChevronDown size={10} />
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={sending || attachBusy}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-muted disabled:opacity-40"
                    title={t("chat.attach")}
                    aria-label={t("chat.attach")}
                  >
                    {attachBusy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept=".md,.markdown,.txt,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.sql,.sh,text/*"
                    className="hidden"
                    onChange={(e) => void addFiles(e.target.files)}
                  />
                  <span className="hidden text-[10px] text-faint sm:inline">/</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="hidden text-[10.5px] text-faint sm:inline">{t("chat.send")} · Enter</span>
                  {sending ? (
                    <button
                      onClick={stop}
                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-elevated text-muted transition hover:text-danger"
                      title={t("chat.stop")}
                      aria-label={t("chat.stop")}
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void send()}
                      disabled={!canSend}
                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white transition hover:brightness-110 disabled:bg-line disabled:text-faint"
                      aria-label={t("chat.send")}
                    >
                      <ArrowUp size={15} strokeWidth={2.6} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-faint">
              {t("brand.tagline")} · {user?.name}
            </p>
          </div>
        </div>
      </div>

      {/* 移动端历史抽屉 */}
      {historyOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setHistoryOpen(false)} />
          <div className="animate-fade-up absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-3 py-3">
              <span className="text-[14px] font-semibold text-ink">{t("chat.history")}</span>
              <button className="icon-btn" onClick={() => setHistoryOpen(false)} aria-label={t("common.close")}>
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <SessionList
                sessions={sessions}
                activeId={id}
                loading={sessionsLoading}
                onNew={() => {
                  navigate("/chat");
                  setHistoryOpen(false);
                }}
                onSelect={(sid) => {
                  navigate(`/chat/${sid}`);
                  setHistoryOpen(false);
                }}
                onMenu={(s) => setMenuSession(s)}
                onBulkDelete={bulkDelete}
              />
            </div>
          </div>
        </div>
      )}

      {/* 技能选择 */}
      <Modal open={skillOpen} onClose={() => setSkillOpen(false)} title={t("chat.skill")}>
        <button
          onClick={() => {
            setSkillKey("");
            setSkillOpen(false);
            if (id) void api(`/sessions/${id}`, { method: "PATCH", body: { skillKey: null } }).catch(() => undefined);
          }}
          className={clsx(
            "mb-2 flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition",
            !skillKey ? "border-brand/40 bg-brand-soft/50" : "border-line hover:bg-elevated",
          )}
        >
          <Sparkles size={15} className="mt-0.5 text-brand" />
          <div>
            <div className="text-[13px] font-medium text-ink">{t("chat.autoSkill")}</div>
            <div className="mt-0.5 text-[11.5px] text-muted">{t("skills.subtitle")}</div>
          </div>
        </button>
        <div className="space-y-2">
          {skills.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setSkillKey(s.key);
                setSkillOpen(false);
                if (id) void api(`/sessions/${id}`, { method: "PATCH", body: { skillKey: s.key } }).catch(() => undefined);
              }}
              className={clsx(
                "flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition",
                skillKey === s.key ? "border-brand/40 bg-brand-soft/50" : "border-line hover:bg-elevated",
              )}
            >
              <Sparkles size={15} className="mt-0.5 text-brand" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">{s.name}</div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{s.description}</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {/* 会话操作 */}
      <Modal open={Boolean(menuSession)} onClose={() => setMenuSession(null)} title={menuSession?.title ?? ""}>
        {menuSession && (
          <div className="space-y-1">
            <button
              onClick={() => void togglePin(menuSession)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-ink transition hover:bg-elevated"
            >
              {menuSession.pinned ? <PinOff size={15} className="text-brand" /> : <Pin size={15} className="text-brand" />}
              {menuSession.pinned ? t("chat.unpin") : t("chat.pin")}
            </button>
            <button
              onClick={() => {
                setRenameTarget(menuSession);
                setRenameValue(menuSession.title);
                setMenuSession(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-ink transition hover:bg-elevated"
            >
              <Pencil size={15} className="text-brand" /> {t("chat.rename")}
            </button>
            <button
              onClick={() => void exportSession(menuSession)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-ink transition hover:bg-elevated"
            >
              <Download size={15} className="text-brand" /> {t("chat.export")}
            </button>
            <div className="my-1 divider" />
            <button
              onClick={() => {
                setDeleteTarget(menuSession);
                setMenuSession(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-danger transition hover:bg-danger/10"
            >
              <Trash2 size={15} /> {t("chat.deleteSession")}
            </button>
          </div>
        )}
      </Modal>

      {/* 重命名 */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title={t("chat.rename")}
        footer={
          <>
            <button className="btn-outline" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </button>
            <button className="btn-primary" disabled={!renameValue.trim()} onClick={() => void submitRename()}>
              {t("common.save")}
            </button>
          </>
        }
      >
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitRename();
          }}
          maxLength={80}
          autoFocus
          className="input"
          placeholder={t("chat.renamePlaceholder")}
        />
      </Modal>

      {/* 编辑并重发 */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={t("chat.editTitle")}
        footer={
          <>
            <button className="btn-outline" onClick={() => setEditTarget(null)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn-primary"
              disabled={!editTarget || (!editTarget.text.trim() && editTarget.files.length === 0)}
              onClick={() => void submitEdit()}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : null}
              {t("chat.saveAndResend")}
            </button>
          </>
        }
      >
        {editTarget && editTarget.files.length > 0 && (
          <div className="mb-3 rounded-xl border border-line bg-elevated px-3 py-2">
            <div className="mb-1 text-[10.5px] uppercase tracking-wide text-faint">{t("chat.attachments")}</div>
            <div className="space-y-1">
              {editTarget.files.map((f) => (
                <div key={f.name} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <Paperclip size={10} className="text-brand" /> {f.name}
                  <span className="text-[10px] text-faint">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={editTarget?.text ?? ""}
          onChange={(e) => setEditTarget((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
          rows={6}
          autoFocus
          className="input min-h-[140px] resize-y leading-relaxed"
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{t("chat.editHint")}</p>
      </Modal>

      {/* 删除会话 */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("chat.deleteSession")}
        footer={
          <>
            <button className="btn-outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </button>
            <button className="btn-danger" onClick={() => deleteTarget && void removeSession(deleteTarget)}>
              {t("common.delete")}
            </button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">{t("chat.deleteConfirm")}</p>
      </Modal>
    </div>
  );
}
