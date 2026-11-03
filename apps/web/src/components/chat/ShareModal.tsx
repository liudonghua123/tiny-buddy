import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, ShieldOff } from "lucide-react";
import type { SessionShare } from "@tiny-buddy/shared";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../lib/toast";
import { Modal } from "../ui";

/** 复制到剪贴板：非 HTTPS 环境 navigator.clipboard 不可用，降级为选中复制 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

const DAY_OPTIONS = [1, 7, 30, 0] as const;

export function ShareModal({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<SessionShare | null>(null);
  const [days, setDays] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | "create" | "rotate" | "revoke">(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    let alive = true;
    setLoading(true);
    setCopied(false);
    api<SessionShare>(`/sessions/${sessionId}/share`)
      .then((data) => {
        if (!alive) return;
        setState(data);
        // 用当前链接的剩余有效期回填选项，避免默认值与实际不一致
        if (data.active) {
          if (!data.expiresAt) setDays(0);
          else {
            const left = Math.max(1, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 86_400_000));
            setDays([1, 7, 30].reduce((a, b) => (Math.abs(b - left) < Math.abs(a - left) ? b : a), 7));
          }
        }
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  const link = state?.token ? `${window.location.origin}/s/${state.token}` : "";

  const create = useCallback(
    async (rotate: boolean, overrideDays?: number) => {
      if (!sessionId) return;
      setBusy(rotate ? "rotate" : "create");
      try {
        const data = await api<SessionShare>(`/sessions/${sessionId}/share`, {
          method: "POST",
          body: { expiresInDays: overrideDays ?? days, rotate },
        });
        setState(data);
        toast.success(rotate ? t("chat.shareRotated") : t("chat.shareCreated"));
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [days, sessionId, t, toast],
  );

  const revoke = useCallback(async () => {
    if (!sessionId) return;
    setBusy("revoke");
    try {
      await api(`/sessions/${sessionId}/share`, { method: "DELETE" });
      setState({ active: false, token: null, path: null, createdAt: null, expiresAt: null, viewCount: 0 });
      toast.success(t("chat.shareRevoked"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [sessionId, t, toast]);

  const copy = async () => {
    if (!link) return;
    const ok = await copyText(link);
    if (!ok) {
      toast.error(t("chat.shareCopyFailed"));
      return;
    }
    setCopied(true);
    toast.success(t("chat.shareCopied"));
    setTimeout(() => setCopied(false), 1800);
  };

  const active = Boolean(state?.active && state.token);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Link2 size={16} className="text-brand" /> {t("chat.shareTitle")}
        </span>
      }
      footer={
        active ? (
          <>
            <button className="btn-outline text-danger" disabled={busy !== null} onClick={() => void revoke()}>
              {busy === "revoke" ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
              {t("chat.shareRevoke")}
            </button>
            <button className="btn-primary" disabled={busy !== null} onClick={() => void create(true)}>
              {busy === "rotate" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("chat.shareRotate")}
            </button>
          </>
        ) : (
          <>
            <button className="btn-outline" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="btn-primary" disabled={busy !== null || loading} onClick={() => void create(false)}>
              {busy === "create" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {t("chat.shareCreate")}
            </button>
          </>
        )
      }
    >
      {loading ? (
        <div className="flex justify-center py-8 text-faint">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-muted">{t("chat.shareDesc")}</p>

          {active ? (
            <>
              <div className="rounded-xl border border-line bg-elevated/60 p-2.5">
                <div className="flex items-center gap-2">
                  <input readOnly value={link} className="input flex-1 !py-1.5 font-mono text-[11.5px]" onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn-outline shrink-0 !px-2.5" onClick={() => void copy()} title={t("chat.shareCopy")}>
                    {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                  <span>
                    {t("chat.shareViews")} · <span className="text-muted">{state?.viewCount ?? 0}</span>
                  </span>
                  <span>
                    {t("chat.shareExpires")} ·{" "}
                    <span className="text-muted">
                      {state?.expiresAt ? new Date(state.expiresAt).toLocaleDateString() : t("chat.shareNever")}
                    </span>
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11.5px] font-medium text-muted">{t("chat.shareValidity")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d}
                      disabled={busy !== null}
                      onClick={() => {
                        setDays(d);
                        if (active) void create(false, d);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                        days === d
                          ? "border-brand/40 bg-brand-soft text-brand"
                          : "border-line bg-surface text-muted hover:border-brand/30 hover:text-ink"
                      }`}
                    >
                      {d === 0 ? t("chat.shareForever") : t("chat.shareDays", { n: d })}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">{t("chat.shareValidityHint")}</p>
              </div>
            </>
          ) : (
            <div>
              <div className="mb-1.5 text-[11.5px] font-medium text-muted">{t("chat.shareValidity")}</div>
              <div className="flex flex-wrap gap-1.5">
                {DAY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                      days === d
                        ? "border-brand/40 bg-brand-soft text-brand"
                        : "border-line bg-surface text-muted hover:border-brand/30 hover:text-ink"
                    }`}
                  >
                    {d === 0 ? t("chat.shareForever") : t("chat.shareDays", { n: d })}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
