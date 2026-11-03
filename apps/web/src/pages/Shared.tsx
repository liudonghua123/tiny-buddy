import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, CalendarClock, Clock3, Eye, Lock, Moon, Sparkles, Sun, UserRound } from "lucide-react";
import type { Message, SharedSession } from "@tiny-buddy/shared";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { MessageRow } from "../components/chat/MessageRow";
import { Spinner } from "../components/ui";
import { useTheme } from "../lib/theme";

/** 公开分享页：无需登录，只读渲染会话内容 */
export function SharedPage() {
  const { token = "" } = useParams();
  const { t, locale, setLocale } = useI18n();
  const { resolved, toggle } = useTheme();
  const [data, setData] = useState<SharedSession | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<SharedSession>(`/share/${token}`)
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((err) => {
        if (!alive) return;
        const apiErr = err as ApiError;
        setError({ code: apiErr.code ?? "error", message: apiErr.message });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (data?.title) document.title = `${data.title} · TinyBuddy`;
    return () => {
      document.title = "TinyBuddy";
    };
  }, [data?.title]);

  return (
    <div className="min-h-[100dvh] bg-bg">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[860px] items-center gap-2.5 px-3 sm:px-6">
          <Link to="/chat" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#8b6dff] to-[#5b3ae0]">
              <Sparkles size={13} className="text-white" strokeWidth={2.2} />
            </div>
            <span className="text-[13.5px] font-semibold tracking-tight text-ink">TinyBuddy</span>
          </Link>
          <span className="chip gap-1 !border-brand/25 !bg-brand-soft !text-brand">
            <Eye size={10} /> {t("share.badge")}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              className="icon-btn text-[11.5px] font-semibold tracking-wide"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              title={locale === "zh" ? "Switch to English" : "切换到中文"}
            >
              {locale === "zh" ? "EN" : "中"}
            </button>
            <button className="icon-btn" onClick={toggle} title="Theme">
              {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[860px] px-3 pb-16 sm:px-6">
        {loading && (
          <div className="flex justify-center py-24 text-faint">
            <Spinner size={20} />
          </div>
        )}

        {!loading && error && (
          <div className="mt-20 flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elevated">
              <Lock size={20} className="text-faint" />
            </div>
            <h1 className="mt-4 text-[17px] font-semibold text-ink">
              {error.code === "share_expired" ? t("share.expired") : t("share.notFound")}
            </h1>
            <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">{error.message}</p>
            <Link to="/chat" className="btn-primary mt-5">
              {t("share.openChat")} <ArrowUpRight size={14} />
            </Link>
          </div>
        )}

        {!loading && data && (
          <>
            <div className="border-b border-line py-5 sm:py-7">
              <h1 className="text-[19px] font-semibold leading-snug tracking-tight text-ink sm:text-[22px]">{data.title}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-faint">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound size={12} /> {data.ownerName || "TinyBuddy"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={12} /> {new Date(data.createdAt).toLocaleString()}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock size={12} />
                  {data.expiresAt ? `${t("share.expires")} ${new Date(data.expiresAt).toLocaleDateString()}` : t("share.forever")}
                </span>
              </div>
            </div>

            <div className="space-y-5 py-5">
              {data.messages
                .filter((m) => m.role !== "system")
                .map((m) => (
                  <MessageRow key={m.id} message={m as Message} />
                ))}
              {data.messages.length === 0 && <p className="py-10 text-center text-[12.5px] text-faint">{t("share.empty")}</p>}
            </div>

            <div className="mt-4 flex flex-col items-center gap-3 border-t border-line pt-6 text-center">
              <p className="text-[11.5px] text-faint">{t("share.footer")}</p>
              <Link to="/chat" className="btn-outline">
                {t("share.try")} <ArrowUpRight size={14} />
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
