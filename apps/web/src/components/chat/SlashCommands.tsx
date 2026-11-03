import type { LucideIcon } from "lucide-react";
import { CornerDownLeft } from "lucide-react";
import clsx from "clsx";

export interface SlashItem {
  key: string;
  label: string;
  hint: string;
  description?: string;
  icon: LucideIcon;
}

/** 输入框上方的命令面板：只负责展示，键盘导航由 Chat 统一处理 */
export function SlashCommands({
  items,
  active,
  onPick,
  onHover,
}: {
  items: SlashItem[];
  active: number;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="animate-fade-up absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
      <div className="flex items-center justify-between border-b border-line bg-elevated/60 px-3 py-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-faint">commands</span>
        <span className="flex items-center gap-1 text-[10px] text-faint">
          <CornerDownLeft size={10} /> / ↑ ↓
        </span>
      </div>
      <div className="scroll-thin max-h-[320px] overflow-y-auto p-1">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition",
                i === active ? "bg-brand-soft" : "hover:bg-elevated",
              )}
            >
              <span
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                  i === active ? "bg-brand text-white" : "bg-elevated text-brand",
                )}
              >
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className={clsx("text-[12.5px] font-medium", i === active ? "text-brand-ink" : "text-ink")}>
                    {item.label}
                  </span>
                  <span className="font-mono text-[10.5px] text-faint">{item.hint}</span>
                </span>
                {item.description && <span className="mt-0.5 block truncate text-[11px] text-muted">{item.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
