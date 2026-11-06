import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, ClipboardList, FileText, GitPullRequest, ListChecks, Mail, Rocket, Scale, Search, ShieldAlert, Sparkles, Zap } from "lucide-react";
import clsx from "clsx";
import type { PromptTemplate } from "@tiny-buddy/shared";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Modal, Spinner } from "../ui";

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

const CATEGORIES = ["all", "writing", "dev", "meeting", "research", "analysis", "product", "general"];

/** 输入框上方的模板选择器：选中即插入正文，不自动发送，留给用户改占位符 */
export function PromptPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (prompt: PromptTemplate) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCat("all");
    setLoading(true);
    api<{ items: PromptTemplate[] }>("/prompts")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((p) => (cat === "all" ? true : p.category === cat))
      .filter((p) => (term ? `${p.title} ${p.description} ${p.tags.join(" ")}`.toLowerCase().includes(term) : true));
  }, [items, q, cat]);

  return (
    <Modal open={open} onClose={onClose} title={t("prompts.pickTitle")} wide>
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("prompts.searchPlaceholder")}
          className="input pl-8"
          autoFocus
        />
      </div>

      <div className="scroll-thin -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={clsx(
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              cat === c ? "border-brand/30 bg-brand-soft text-brand-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {t(`prompts.cat.${c}`)}
          </button>
        ))}
      </div>

      <div className="scroll-thin mt-2 max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner size={18} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-[12.5px] text-faint">{t("prompts.empty")}</p>
        ) : (
          filtered.map((p) => {
            const Icon = ICONS[p.icon] ?? Sparkles;
            return (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left transition hover:border-line hover:bg-elevated"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{p.title}</span>
                    <span className="shrink-0 text-[10px] text-faint">{t(`prompts.cat.${p.category}`)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-[11.5px] text-muted">{p.description}</span>
                </span>
                <Zap size={13} className="mt-1.5 shrink-0 text-faint" />
              </button>
            );
          })
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
        <span className="text-[10.5px] text-faint">{t("prompts.pickHint")}</span>
        <button
          className="text-[11.5px] text-brand-ink hover:underline"
          onClick={() => {
            onClose();
            navigate("/prompts");
          }}
        >
          {t("prompts.manage")}
        </button>
      </div>
    </Modal>
  );
}
