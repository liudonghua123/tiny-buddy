import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  Library,
  Loader2,
  Paperclip,
  Pencil,
  Plug,
  RotateCcw,
  Save,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Message, MessagePart, ToolCallPart } from "@tiny-buddy/shared";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { formatBytes } from "../../lib/format";
import { parseAttachments, type Attachment } from "../../lib/attachments";

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

/** 从 React 节点树里取出纯文本，用于复制代码块 */
function nodeText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? nodeText(props.children) : "";
}

function CodeBlock({ children }: { children?: unknown }) {
  const { t } = useI18n();
  const toast = useToast();
  const code = nodeText(children).replace(/\n$/, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("chat.copied"));
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  return (
    <div className="group/code relative">
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 flex h-6 items-center gap-1 rounded-md border border-line bg-surface/90 px-1.5 text-[10.5px] text-muted opacity-100 backdrop-blur transition hover:text-ink sm:opacity-0 sm:group-hover/code:opacity-100"
        title={t("chat.copy")}
        aria-label={t("chat.copy")}
      >
        <Copy size={10} /> {t("chat.copy")}
      </button>
      <pre>{children as React.ReactNode}</pre>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ToolCard({ part }: { part: ToolCallPart }) {
  const { t } = useI18n();
  // 运行中的工具默认展开，让「正在做什么」可见；结束后保持用户选择
  const [open, setOpen] = useState(part.status === "running");
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

export function AttachmentChips({ files, align = "left" }: { files: Attachment[]; align?: "left" | "right" }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!files.length) return null;

  return (
    <div className={clsx("mb-1.5 flex flex-wrap gap-1.5", align === "right" && "justify-end")}>
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="max-w-full">
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-2 py-1 text-[11px] text-muted transition hover:border-brand/30 hover:text-ink"
            title={f.name}
          >
            <Paperclip size={10} className="shrink-0 text-brand" />
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-[10px] text-faint">{formatBytes(f.size)}</span>
          </button>
          {openIdx === i && (
            <pre className="scroll-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-[11px] leading-relaxed text-muted">
              {f.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function MessageActions({
  content,
  onRegenerate,
  onEdit,
}: {
  content: string;
  onRegenerate?: () => void;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t("chat.copied"));
    } catch {
      toast.error(t("chat.copy"));
    }
  };

  return (
    <div className="mt-1.5 flex items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover/message:opacity-100 sm:focus-within:opacity-100">
      <button
        onClick={copy}
        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-faint transition hover:bg-elevated hover:text-ink"
        title={t("chat.copy")}
        aria-label={t("chat.copy")}
      >
        <Copy size={11} /> {t("chat.copy")}
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-faint transition hover:bg-elevated hover:text-ink"
          title={t("chat.editResend")}
          aria-label={t("chat.editResend")}
        >
          <Pencil size={11} /> {t("chat.edit")}
        </button>
      )}
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-faint transition hover:bg-elevated hover:text-ink"
          title={t("chat.regenerate")}
          aria-label={t("chat.regenerate")}
        >
          <RotateCcw size={11} /> {t("chat.regenerate")}
        </button>
      )}
    </div>
  );
}

export function MessageRow({
  message,
  streaming,
  onRegenerate,
  onEdit,
}: {
  message: Message;
  streaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (message: Message) => void;
}) {
  const { t } = useI18n();
  const isUser = message.role === "user";

  if (isUser) {
    const { text, files } = parseAttachments(message.content);
    return (
      <div className="group/message flex flex-col items-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-[14.5px] leading-relaxed text-ink sm:max-w-[75%]">
          <AttachmentChips files={files} align="right" />
          {text && <div className="whitespace-pre-wrap break-words">{text}</div>}
        </div>
        {!streaming && (
          <MessageActions
            content={text}
            onEdit={onEdit ? () => onEdit(message) : undefined}
          />
        )}
      </div>
    );
  }

  const parts = message.parts ?? [];
  const hasTools = parts.some((p) => p.type === "tool");

  return (
    <div className="group/message flex gap-2.5 sm:gap-3">
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
            {parts.map((part: MessagePart, i) => {
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
        {!streaming && <MessageActions content={message.content} onRegenerate={onRegenerate} />}
      </div>
    </div>
  );
}

export { MemoryBadge };
