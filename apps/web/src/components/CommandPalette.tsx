import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Brain,
  CalendarClock,
  CornerDownLeft,
  FileText,
  Library,
  MessageSquare,
  Moon,
  Plug,
  Plus,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import clsx from "clsx";
import type { SearchGroup, SearchHit, Session } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { NAV_ITEMS } from "./nav";

const PaletteContext = createContext<{ open: () => void } | null>(null);

export function usePalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used inside CommandPaletteProvider");
  return ctx;
}

interface Action {
  id: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
  href?: string;
  run?: () => void;
  permission?: string;
}

const GROUP_ICON: Record<string, typeof Search> = {
  session: MessageSquare,
  skill: Sparkles,
  document: FileText,
  prompt: FileText,
  schedule: CalendarClock,
  memory: Brain,
};

const GROUP_KEY: Record<string, string> = {
  session: "palette.groupSession",
  skill: "palette.groupSkill",
  document: "palette.groupDoc",
  prompt: "palette.groupPrompt",
  schedule: "palette.groupSchedule",
  memory: "palette.groupMemory",
};

type Row =
  | { type: "action"; action: Action }
  | { type: "hit"; hit: SearchHit; group: string }
  | { type: "header"; label: string };

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openFn = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open: openFn }), [openFn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <Palette open={open} onClose={() => setOpen(false)} />
    </PaletteContext.Provider>
  );
}

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { resolved, toggle } = useTheme();
  const { can } = useAuth();
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [recent, setRecent] = useState<Session[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollWanted = useRef(false);

  const go = useCallback(
    (href: string) => {
      onClose();
      navigate(href);
    },
    [navigate, onClose],
  );

  const actions = useMemo<Action[]>(() => {
    const base: Action[] = [
      { id: "new", title: t("chat.newChat"), icon: Plus, run: () => go("/chat") },
      ...NAV_ITEMS.filter((n) => n.to !== "/chat").map((n) => ({
        id: `nav-${n.to}`,
        title: t(n.key),
        icon: n.icon,
        href: n.to,
        permission: n.permission,
      })),
      {
        id: "theme",
        title: resolved === "dark" ? t("palette.toLight") : t("palette.toDark"),
        icon: resolved === "dark" ? Sun : Moon,
        run: () => {
          toggle();
          onClose();
        },
      },
      {
        id: "locale",
        title: locale === "zh" ? "Switch to English" : "切换到中文",
        icon: Sparkles,
        run: () => {
          setLocale(locale === "zh" ? "en" : "zh");
          onClose();
        },
      },
    ];
    return base.filter((a) => !a.permission || can(a.permission));
  }, [t, go, resolved, toggle, locale, setLocale, onClose, can]);

  /* 打开时重置，并拉一次最近会话；关闭后清空避免下次闪旧内容 */
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    setGroups([]);
    scrollWanted.current = false;
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    api<{ items: Session[] }>("/sessions")
      .then((d) => setRecent(d.items.slice(0, 4)))
      .catch(() => setRecent([]));
    return () => clearTimeout(timer);
  }, [open]);

  /* 输入防抖 + 取消上一次请求，避免快速输入时结果乱序 */
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<{ groups: SearchGroup[] }>(`/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((d) => setGroups(d.groups))
        .catch((err: Error) => {
          if (err.name !== "AbortError") setGroups([]);
        })
        .finally(() => setLoading(false));
    }, 160);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!q.trim()) {
      out.push({ type: "header", label: t("palette.actions") });
      for (const a of actions) out.push({ type: "action", action: a });
      if (recent.length) {
        out.push({ type: "header", label: t("palette.recent") });
        for (const s of recent) out.push({ type: "hit", group: "session", hit: { id: s.id, kind: "session", title: s.title, href: `/chat/${s.id}` } });
      }
      return out;
    }
    for (const g of groups) {
      if (!g.items.length) continue;
      out.push({ type: "header", label: t(GROUP_KEY[g.kind] ?? "palette.results") });
      for (const hit of g.items) out.push({ type: "hit", group: g.kind, hit });
    }
    return out;
  }, [q, actions, recent, groups, t]);

  const selectable = useMemo(() => rows.filter((r) => r.type !== "header") as Exclude<Row, { type: "header" }>[], [rows]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    if (!open || !scrollWanted.current) return;
    scrollWanted.current = false;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = useCallback(
    (row: Exclude<Row, { type: "header" }>) => {
      if (row.type === "action") {
        if (row.action.run) row.action.run();
        else if (row.action.href) go(row.action.href);
      } else {
        go(row.hit.href);
      }
    },
    [go],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (!selectable.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollWanted.current = true;
        setActive((i) => (i + 1) % selectable.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollWanted.current = true;
        setActive((i) => (i - 1 + selectable.length) % selectable.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(selectable[Math.min(active, selectable.length - 1)]);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, selectable, active, choose, onClose]);

  if (!open) return null;

  let idx = -1;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-2 pt-[6vh] sm:pt-[10vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-fade-up relative flex max-h-[76vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lift sm:max-w-xl">
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-faint sm:block">ESC</kbd>
        </div>

        <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {loading && !rows.length && (
            <div className="py-8 text-center text-[12px] text-faint">{t("palette.searching")}</div>
          )}
          {!loading && q.trim() && !selectable.length && (
            <div className="py-10 text-center">
              <p className="text-[13px] text-muted">{t("palette.noResults", { q: q.trim() })}</p>
              <p className="mt-1 text-[11.5px] text-faint">{t("palette.noResultsHint")}</p>
            </div>
          )}

          {rows.map((row, i) => {
            if (row.type === "header") {
              return (
                <div key={`h-${i}`} className="px-2 pb-0.5 pt-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
                  {row.label}
                </div>
              );
            }
            idx += 1;
            const selected = idx === active;
            const Icon = row.type === "action" ? row.action.icon : (GROUP_ICON[row.group] ?? Search);
            const title = row.type === "action" ? row.action.title : row.hit.title;
            const subtitle = row.type === "action" ? row.action.subtitle : row.hit.subtitle;
            const snippet = row.type === "hit" ? row.hit.snippet : undefined;
            return (
              <button
                key={row.type === "action" ? row.action.id : `${row.group}-${row.hit.id}`}
                data-idx={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(row)}
                className={clsx(
                  "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition",
                  selected ? "bg-brand-soft/70" : "hover:bg-elevated",
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg",
                    selected ? "bg-surface text-brand" : "bg-elevated text-muted",
                  )}
                >
                  <Icon size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={clsx("truncate text-[13px] font-medium", selected ? "text-brand-ink" : "text-ink")}>
                      <Highlight text={title} term={q.trim()} />
                    </span>
                    {subtitle && <span className="shrink-0 text-[10px] text-faint">{subtitle}</span>}
                  </span>
                  {snippet && <span className="mt-0.5 line-clamp-1 block text-[11px] text-muted">{snippet}</span>}
                </span>
                {selected && <ArrowRight size={13} className="mt-1.5 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-elevated/60 px-3 py-1.5 text-[10.5px] text-faint">
          <span className="flex items-center gap-1">
            <CornerDownLeft size={10} /> {t("palette.open")}
          </span>
          <span>{t("palette.hint")}</span>
        </div>
      </div>
    </div>
  );
}

/** 把命中词高亮出来，结果多时能一眼看出为什么匹配 */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-semibold text-brand-ink">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}
