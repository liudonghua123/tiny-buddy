import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  History,
  Library,
  Plug,
  MessageSquarePlus,
  Save,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  Check,
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import type { AgentEvent, Message, MessagePart, Session, Skill, ToolCallPart } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { streamChat } from "../lib/sse";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { relativeTime, truncate } from "../lib/format";
import { useToast } from "../lib/toast";
import { Modal, Spinner } from "../components/ui";

interface LiveState {
  text: string;
  tools: ToolCallPart[];
  memories: { id: string; content: string; score?: number; kind?: string }[];
  skill?: { key: string; name: string };
  wroteMemory: boolean;
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  memory_search: Brain,
  memory_write: Save,
  knowledge_search: Library,
  skill_list: Sparkles,
  skill_read: Sparkles,
  schedule_create: CalendarClock,
  schedule_list: CalendarClock,
  mcp_list_tools: Plug,
  current_time: CalendarClock,
};

function toolIcon(name: string) {
  if (name.startsWith("mcp_")) return Plug;
  return TOOL_ICONS[name] ?? Wrench;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ToolCard({ part, defaultOpen }: { part: ToolCallPart; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const Icon = toolIcon(part.name);

  const statusText =
    part.status === "running" ? t("chat.toolRunning") : part.status === "error" ? t("chat.toolFailed") : t("chat.toolDone");

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-elevated/60">
        <span
          className={clsx(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
            part.status === "error" ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand",
          )}
        >
          <Icon size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-ink">{part.title ?? part.name}</span>
            {part.source === "mcp" && <span className="chip py-0 text-[9.5px]">MCP</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
            {part.status === "running" ? (
              <Loader2 size={9} className="animate-spin" />
            ) : part.status === "error" ? (
              <X size={9} />
            ) : (
              <Check size={9} className="text-ok" />
            )}
            {statusText}
            {part.durationMs !== undefined && <span>· {part.durationMs}ms</span>}
          </span>
        </span>
        <ChevronDown size={14} className={clsx("shrink-0 text-faint transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-faint">input</div>
            <pre className="scroll-thin max-h-40 overflow-auto rounded-lg bg-elevated px-2.5 py-2 text-[11px] leading-relaxed text-muted">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          </div>
          {part.output && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-faint">output</div>
              <pre className="scroll-thin max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-elevated px-2.5 py-2 text-[11px] leading-relaxed text-muted">
                {part.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemoryBadge({ count, items }: { count: number; items: { content: string; score?: number }[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand-soft/60 px-2.5 py-1 text-[11px] font-medium text-brand-ink transition hover:bg-brand-soft"
      >
        <Brain size={11} />
        {t("chat.memoryRecalled", { n: count })}
        <ChevronDown size={11} className={clsx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-xl border border-line bg-surface p-2">
          {items.map((m) => (
            <div key={m.content} className="rounded-lg bg-elevated px-2 py-1.5 text-[11.5px] leading-relaxed text-muted">
              {m.content}
              {m.score !== undefined && <span className="ml-1.5 text-[10px] text-faint">{m.score}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageRow({ message, streaming }: { message: Message; streaming?: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-[14.5px] leading-relaxed text-ink sm:max-w-[75%]">
          {message.content}
        </div>
      </div>
    );
  }

  const parts = message.parts ?? [];
  const hasTools = parts.some((p) => p.type === "tool");

  return (
    <div className="flex gap-2.5 sm:gap-3">
      <div className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#8b6dff] to-[#5b3ae0] sm:flex">
        <Sparkles size={13} className="text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-medium text-ink">TinyBuddy</span>
          {message.model && <span className="text-[10px] text-faint">{message.model}</span>}
          {message.usage && (
            <span className="hidden text-[10px] text-faint sm:inline">
              · {t("chat.tokens", { n: message.usage.totalTokens })}
            </span>
          )}
        </div>

        {hasTools ? (
          <div className="space-y-1">
            {parts.map((part, i) => {
              if (part.type === "tool") return <ToolCard key={part.id || i} part={part} />;
              if (part.type === "text")
                return (
                  <div key={i} className="pt-1">
                    <Markdown text={part.text} />
                  </div>
                );
              return null;
            })}
          </div>
        ) : (
          <div className={clsx(streaming && "caret")}>
            <Markdown text={message.content} />
          </div>
        )}

        {streaming && hasTools && <span className="caret inline-block align-middle" />}
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  sessions: Session[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <button onClick={onNew} className="btn-primary h-9 flex-1 text-[12.5px]">
          <MessageSquarePlus size={14} /> {t("chat.newChat")}
        </button>
      </div>
      <div className="px-3 pb-1">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">{t("chat.history")}</div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {!loading && sessions.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-faint">{t("common.empty")}</p>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={clsx(
              "group relative mb-0.5 flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 transition",
              s.id === activeId ? "bg-brand-soft" : "hover:bg-elevated",
            )}
            onClick={() => onSelect(s.id)}
          >
            <div className="min-w-0 flex-1">
              <div className={clsx("truncate text-[13px] font-medium", s.id === activeId ? "text-brand-ink" : "text-ink")}>
                {s.title}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-faint">
                {s.preview ? truncate(s.preview, 42) : relativeTime(s.updatedAt, t)}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-surface hover:text-danger group-hover:flex"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
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
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const loadSession = useCallback(async (sid: string) => {
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
  }, [navigate, t, toast]);

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
    }
  }, [id, loadSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live?.text, live?.tools.length]);

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
          setLive({ text: "", tools: [], memories: [], wroteMemory: false });
          break;
        case "skill.active":
          setLive((prev) => (prev ? { ...prev, skill: { key: event.key, name: event.name } } : prev));
          break;
        case "memory.recall":
          setLive((prev) => (prev ? { ...prev, memories: event.items } : prev));
          break;
        case "text.delta":
          setLive((prev) => (prev ? { ...prev, text: prev.text + event.delta } : prev));
          break;
        case "tool.start":
          setLive((prev) =>
            prev
              ? {
                  ...prev,
                  tools: [
                    ...prev.tools,
                    {
                      type: "tool",
                      id: event.toolCallId,
                      name: event.name,
                      title: event.title,
                      input: event.input,
                      status: "running",
                      source: event.source,
                    },
                  ],
                }
              : prev,
          );
          break;
        case "tool.end":
          setLive((prev) =>
            prev
              ? {
                  ...prev,
                  tools: prev.tools.map((tool) =>
                    tool.id === event.toolCallId
                      ? { ...tool, status: event.ok ? "done" : "error", output: event.output, durationMs: event.durationMs }
                      : tool,
                  ),
                }
              : prev,
          );
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

  const send = useCallback(
    async (raw?: string) => {
      const content = (raw ?? input).trim();
      if (!content || sending) return;

      if (!user) return;
      setSending(true);
      setInput("");

      let sid = id;
      let created = false;
      try {
        if (!sid) {
          const data = await api<{ session: Session }>("/sessions", {
            method: "POST",
            body: { title: content.replace(/\s+/g, " ").slice(0, 24) },
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
        setLive({ text: "", tools: [], memories: [], wroteMemory: false });

        const controller = new AbortController();
        abortRef.current = controller;

        await streamChat(sid, content, {
          onEvent: handleEvent,
          onError: (msg) => toast.error(msg),
          signal: controller.signal,
        });
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        abortRef.current = null;
        if (sid) {
          try {
            const data = await api<{ session: Session; messages: Message[] }>(`/sessions/${sid}`);
            setMessages(data.messages);
            setSession(data.session);
          } catch {
            /* ignore */
          }
        }
        setLive(null);
        setSending(false);
        void loadSessions();
        if (created) setTimeout(() => textareaRef.current?.focus(), 60);
      }
    },
    [input, sending, user, id, navigate, handleEvent, toast, loadSessions],
  );

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

  const activeSkill = useMemo(() => skills.find((s) => s.key === skillKey), [skills, skillKey]);

  const liveMessage: Message | null = live
    ? {
        id: "live",
        sessionId: id ?? "",
        role: "assistant",
        content: live.text,
        parts: [
          ...(live.text ? [{ type: "text" as const, text: live.text }] : []),
          ...live.tools,
        ],
        createdAt: new Date().toISOString(),
      }
    : null;

  const isEmpty = !loading && messages.length === 0 && !live;

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
          onDelete={(sid) => setDeleteTarget(sessions.find((s) => s.id === sid) ?? null)}
        />
      </div>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:h-14 sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {id && (
              <button className="icon-btn lg:hidden" onClick={() => navigate("/chat")}>
                <ChevronLeft size={18} />
              </button>
            )}
            <button className="flex min-w-0 items-center gap-1.5" onClick={() => setHistoryOpen(true)}>
              <span className="truncate text-[14px] font-medium text-ink">{session?.title ?? t("chat.newChat")}</span>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button className="icon-btn lg:hidden" onClick={() => setHistoryOpen(true)} title={t("chat.history")}>
              <History size={16} />
            </button>
            {id && (
              <button
                className="icon-btn"
                onClick={() => setDeleteTarget(session)}
                title={t("chat.deleteSession")}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-3 py-4 sm:px-6 sm:py-6">
            {loading && <div className="flex justify-center py-16"><Spinner size={20} /></div>}

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
              </div>
            )}

            <div className="space-y-5">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
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
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
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
                <button
                  onClick={() => setSkillOpen(true)}
                  className={clsx(
                    "flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] transition",
                    activeSkill ? "bg-brand-soft text-brand-ink" : "text-faint hover:bg-elevated hover:text-muted",
                  )}
                >
                  <Sparkles size={12} />
                  {activeSkill ? activeSkill.name : t("chat.autoSkill")}
                  <ChevronDown size={10} />
                </button>

                <div className="flex items-center gap-1.5">
                  <span className="hidden text-[10.5px] text-faint sm:inline">{t("chat.send")} · Enter</span>
                  {sending ? (
                    <button onClick={stop} className="flex h-8 w-8 items-center justify-center rounded-xl bg-elevated text-muted transition hover:text-danger">
                      <Square size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void send()}
                      disabled={!input.trim()}
                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-white transition hover:brightness-110 disabled:bg-line disabled:text-faint"
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
              <button className="icon-btn" onClick={() => setHistoryOpen(false)}>
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
                onDelete={(sid) => setDeleteTarget(sessions.find((s) => s.id === sid) ?? null)}
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

