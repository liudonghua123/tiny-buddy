import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastValue {
  push: (kind: Kind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => setItems((prev) => prev.filter((i) => i.id !== id)), []);

  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), kind === "error" ? 5200 : 3200);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:items-end">
        {items.map((item) => {
          const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "error" ? XCircle : Info;
          return (
            <div
              key={item.id}
              className="pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-2.5 rounded-2xl border border-line bg-surface/95 px-3.5 py-3 shadow-lift backdrop-blur"
            >
              <Icon
                size={17}
                className={item.kind === "success" ? "mt-0.5 text-ok" : item.kind === "error" ? "mt-0.5 text-danger" : "mt-0.5 text-brand"}
              />
              <p className="flex-1 text-[13.5px] leading-relaxed text-ink">{item.message}</p>
              <button onClick={() => remove(item.id)} className="text-faint transition hover:text-ink">
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
