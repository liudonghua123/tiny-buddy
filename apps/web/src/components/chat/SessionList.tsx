import { useMemo, useState } from "react";
import { Check, ListChecks, MessageSquarePlus, MoreHorizontal, Pin, Search, Trash2, X } from "lucide-react";
import clsx from "clsx";
import type { Session } from "@tiny-buddy/shared";
import { useI18n } from "../../lib/i18n";
import { relativeTime, truncate } from "../../lib/format";
import { Modal, Spinner } from "../ui";

/** 置顶优先，其余按自然日分组，历史更长时仍能快速定位 */
function groupSessions(sessions: Session[], t: (k: string, p?: Record<string, string | number>) => string) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  const pinned: Session[] = [];
  const buckets: { label: string; items: Session[] }[] = [
    { label: t("chat.groupToday"), items: [] },
    { label: t("chat.groupYesterday"), items: [] },
    { label: t("chat.groupEarlier"), items: [] },
  ];

  for (const s of sessions) {
    if (s.pinned) {
      pinned.push(s);
      continue;
    }
    const ts = new Date(s.updatedAt).getTime();
    if (ts >= startOfToday) buckets[0].items.push(s);
    else if (ts >= startOfYesterday) buckets[1].items.push(s);
    else buckets[2].items.push(s);
  }

  const groups = pinned.length ? [{ label: t("chat.pinned"), items: pinned }, ...buckets] : buckets;
  return groups.filter((b) => b.items.length > 0);
}

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onMenu,
  onBulkDelete,
  loading,
}: {
  sessions: Session[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onMenu: (session: Session) => void;
  onBulkDelete: (ids: string[]) => Promise<void>;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || (s.preview ?? "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered, t), [filtered, t]);

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <button onClick={onNew} className="btn-primary h-9 flex-1 text-[12.5px]">
          <MessageSquarePlus size={14} /> {t("chat.newChat")}
        </button>
        <button
          onClick={() => (selecting ? exitSelect() : setSelecting(true))}
          className={clsx("icon-btn shrink-0", selecting && "bg-brand-soft text-brand")}
          title={selecting ? t("common.cancel") : t("chat.select")}
          aria-label={selecting ? t("common.cancel") : t("chat.select")}
        >
          {selecting ? <X size={16} /> : <ListChecks size={16} />}
        </button>
      </div>

      {selecting ? (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11.5px] text-muted">
          <button
            onClick={() =>
              setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((s) => s.id)))
            }
            className="font-medium text-brand hover:underline"
          >
            {allVisibleSelected ? t("chat.deselectAll") : t("chat.selectAll")}
          </button>
          <span className="flex-1 text-right text-faint">{t("chat.selectedCount", { n: selected.size })}</span>
          <button
            disabled={selected.size === 0}
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40"
          >
            <Trash2 size={12} /> {t("common.delete")}
          </button>
        </div>
      ) : (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5">
            <Search size={12} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chat.searchSessions")}
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
            {query && (
              <button onClick={() => setQuery("")} className="shrink-0 text-faint hover:text-ink" aria-label="clear">
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {loading && sessions.length === 0 && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-faint">{t("common.empty")}</p>
        )}
        {!loading && sessions.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-faint">{t("common.empty")}</p>
        )}

        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">
              {group.label}
            </div>
            {group.items.map((s) => {
              const checked = selected.has(s.id);
              return (
                <div
                  key={s.id}
                  className={clsx(
                    "group relative mb-0.5 flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 transition",
                    s.id === activeId && !selecting ? "bg-brand-soft" : "hover:bg-elevated",
                  )}
                  onClick={() => {
                    if (selecting) toggle(s.id);
                    else onSelect(s.id);
                  }}
                >
                  {selecting && (
                    <span
                      className={clsx(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
                        checked ? "border-brand bg-brand text-white" : "border-line bg-surface",
                      )}
                    >
                      {checked && <Check size={10} strokeWidth={3} />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={clsx(
                        "flex items-center gap-1 truncate text-[13px] font-medium",
                        s.id === activeId && !selecting ? "text-brand-ink" : "text-ink",
                      )}
                    >
                      {s.pinned && <Pin size={10} className="shrink-0 text-brand" fill="currentColor" />}
                      <span className="truncate">{s.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-faint">
                      {s.preview ? truncate(s.preview, 42) : relativeTime(s.updatedAt, t)}
                    </div>
                  </div>
                  {!selecting && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMenu(s);
                      }}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-faint opacity-60 transition hover:bg-surface hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
                      title={t("common.actions")}
                      aria-label={t("common.actions")}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("chat.deleteSelected")}
        footer={
          <>
            <button className="btn-outline" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn-danger"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await onBulkDelete([...selected]);
                  exitSelect();
                  setConfirmOpen(false);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting && <Spinner size={13} className="text-white" />}
              {t("common.delete")}
            </button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-muted">{t("chat.deleteSelectedConfirm", { n: selected.size })}</p>
      </Modal>
    </div>
  );
}
