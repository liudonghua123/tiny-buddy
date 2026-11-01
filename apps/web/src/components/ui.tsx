import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import clsx from "clsx";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx("animate-spin text-brand", className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={clsx(
          "relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-lift animate-fade-up sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="pt-0.5 text-[16px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="icon-btn -mr-1 -mt-1 shrink-0">
            <X size={17} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-6 pt-4 sm:pb-4">{children}</div>
        {footer && <div className="safe-bottom flex items-center justify-end gap-2 border-t border-line bg-elevated/60 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3.5 block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-brand" : "bg-line",
      )}
    >
      <span
        className={clsx(
          "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all",
          checked ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "idle" }) {
  const color = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "danger" ? "bg-danger" : "bg-faint";
  return (
    <span className="relative flex h-2 w-2">
      {tone === "ok" && <span className={clsx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", color)} />}
      <span className={clsx("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-4 inline-flex rounded-xl border border-line bg-elevated p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition",
            value === tab.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="text-[11px] text-faint">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function ConfirmButton({
  children,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
}: {
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}) {
  return (
    <ConfirmShell
      trigger={children}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      danger={danger}
      onConfirm={onConfirm}
    />
  );
}


function ConfirmShell({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>
              {cancelLabel}
            </button>
            <button
              className={danger ? "btn-danger" : "btn-primary"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner size={14} /> : null}
              {confirmLabel}
            </button>
          </>
        }
      >
        {description && <p className="text-[13.5px] leading-relaxed text-muted">{description}</p>}
      </Modal>
    </>
  );
}
