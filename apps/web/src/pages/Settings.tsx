import { useEffect, useState } from "react";
import { Check, Globe, Info, KeyRound, LogOut, Moon, Palette, ShieldCheck, Sun, User as UserIcon } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemeMode } from "../lib/theme";
import { initials } from "../lib/format";
import { useToast } from "../lib/toast";
import { Field, PageHeader, Spinner } from "../components/ui";

interface MetaInfo {
  version: string;
  provider: { name: string; model: string; demo: boolean };
}

export function SettingsPage() {
  const { t, locale, setLocale, isZh } = useI18n();
  const { user, updateUser, logout } = useAuth();
  const { mode, setMode } = useTheme();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [savingPw, setSavingPw] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);

  useEffect(() => {
    api<MetaInfo>("/meta").then(setMeta).catch(() => undefined);
  }, []);

  if (!user) return null;

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const data = await api<{ user: typeof user }>("/auth/profile", { method: "PATCH", body: { name: name.trim() } });
      updateUser(data.user);
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const changeLanguage = async (l: "zh" | "en") => {
    setLocale(l);
    try {
      await api("/auth/profile", { method: "PATCH", body: { locale: l } });
      updateUser({ locale: l });
    } catch {
      /* 本地已切换 */
    }
  };

  const changeTheme = async (m: ThemeMode) => {
    setMode(m);
    try {
      await api("/auth/profile", { method: "PATCH", body: { theme: m } });
    } catch {
      /* ignore */
    }
  };

  const changePassword = async () => {
    if (pw.next.length < 8) return;
    setSavingPw(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "" });
      toast.success(t("settings.passwordChanged"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

        {/* 个人资料 */}
        <section className="card mb-4 p-4">
          <div className="mb-4 flex items-center gap-2">
            <UserIcon size={15} className="text-brand" />
            <h2 className="text-[13.5px] font-semibold text-ink">{t("settings.profile")}</h2>
          </div>
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[18px] font-semibold text-white"
              style={{ background: user.avatarColor }}
            >
              {initials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{user.email}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                <ShieldCheck size={11} /> {user.roleName} · {user.permissions.includes("*") ? t("members.allPermissions") : `${user.permissions.length} ${t("members.permissions")}`}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label={t("common.name")}>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <button
              className="btn-primary mb-3.5 h-[42px] shrink-0"
              onClick={() => void saveProfile()}
              disabled={savingProfile || !name.trim() || name === user.name}
            >
              {savingProfile && <Spinner size={14} className="text-white" />}
              {t("common.save")}
            </button>
          </div>
        </section>

        {/* 外观 */}
        <section className="card mb-4 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Palette size={15} className="text-brand" />
            <h2 className="text-[13.5px] font-semibold text-ink">{t("settings.appearance")}</h2>
          </div>

          <div className="mb-4">
            <p className="label">{t("settings.language")}</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["zh", "简体中文", "中文界面"],
                  ["en", "English", "English UI"],
                ] as const
              ).map(([l, label, hint]) => (
                <button
                  key={l}
                  onClick={() => void changeLanguage(l)}
                  className={clsx(
                    "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
                    locale === l ? "border-brand/40 bg-brand-soft/60" : "border-line hover:bg-elevated",
                  )}
                >
                  <Globe size={15} className={locale === l ? "text-brand" : "text-faint"} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">{label}</span>
                    <span className="block text-[10.5px] text-faint">{hint}</span>
                  </span>
                  {locale === l && <Check size={14} className="text-brand" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">{t("settings.theme")}</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["light", t("settings.themeLight"), Sun],
                  ["dark", t("settings.themeDark"), Moon],
                  ["system", t("settings.themeSystem"), Palette],
                ] as const
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  onClick={() => void changeTheme(m)}
                  className={clsx(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition",
                    mode === m ? "border-brand/40 bg-brand-soft/60 text-brand-ink" : "border-line text-muted hover:bg-elevated",
                  )}
                >
                  <Icon size={16} />
                  <span className="text-[11.5px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 安全 */}
        <section className="card mb-4 p-4">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound size={15} className="text-brand" />
            <h2 className="text-[13.5px] font-semibold text-ink">{t("settings.security")}</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("settings.currentPassword")}>
              <input
                type="password"
                className="input"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
            </Field>
            <Field label={t("settings.newPassword")}>
              <input
                type="password"
                className="input"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <button
              className="btn-outline"
              onClick={() => void changePassword()}
              disabled={savingPw || !pw.current || pw.next.length < 8}
            >
              {savingPw && <Spinner size={14} />}
              {t("settings.changePassword")}
            </button>
          </div>
        </section>

        {/* 关于 */}
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Info size={15} className="text-brand" />
            <h2 className="text-[13.5px] font-semibold text-ink">{t("settings.about")}</h2>
          </div>
          <dl className="space-y-2 text-[12.5px]">
            <div className="flex items-center justify-between">
              <dt className="text-muted">{t("settings.version")}</dt>
              <dd className="font-mono text-ink">v{meta?.version ?? "0.2.1"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted">{t("settings.provider")}</dt>
              <dd className="text-ink">
                {meta?.provider.name} · {meta?.provider.model}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted">Runtime</dt>
              <dd className="font-mono text-ink">DSH · reactive</dd>
            </div>
          </dl>
          {meta?.provider.demo && (
            <div className="mt-3 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2.5">
              <div className="text-[11.5px] font-medium text-warn">{t("settings.demoMode")}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t("settings.demoHint")}</p>
            </div>
          )}
          <button
            onClick={logout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-[12.5px] text-muted transition hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
          >
            <LogOut size={14} /> {t("auth.signOut")}
          </button>
          <p className="mt-3 text-center text-[10px] text-faint">
            {isZh ? "为小团队打造的 AI 同事" : "An AI teammate for small teams"} · TinyBuddy
          </p>
        </section>
      </div>
    </div>
  );
}
