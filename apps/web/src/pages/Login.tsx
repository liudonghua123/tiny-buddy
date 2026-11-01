import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Brain, Languages, Library, Moon, Plug, ShieldCheck, Sparkles, Sun, Zap } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { Logo } from "../components/Layout";
import { Spinner } from "../components/ui";
import { ApiError } from "../lib/api";

export function Login() {
  const { user, login, register, loading } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? "/chat";
    return <Navigate to={from} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
      navigate("/chat", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("error.network"));
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setMode("login");
    setEmail("admin@tinybuddy.dev");
    setPassword("admin123456");
  };

  return (
    <div className="flex min-h-[100dvh] bg-bg">
      {/* 品牌区（桌面） */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[#12101f] p-12 text-white lg:flex">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#6d4aff] opacity-30 blur-[100px]" />
        <div className="absolute -bottom-32 right-0 h-[380px] w-[380px] rounded-full bg-[#2f9e8f] opacity-20 blur-[100px]" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white/10 backdrop-blur">
            <Sparkles size={17} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">TinyBuddy</span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="max-w-[430px] text-[34px] font-semibold leading-[1.2] tracking-tight">{t("auth.heroTitle")}</h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-white/60">{t("auth.heroDesc")}</p>

          <div className="mt-9 space-y-3.5">
            {[
              { icon: Brain, text: t("auth.feature1") },
              { icon: Plug, text: t("auth.feature2") },
              { icon: ShieldCheck, text: t("auth.feature3") },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-[13.5px] text-white/75">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-white/10">
                  <Icon size={15} />
                </span>
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-[11.5px] text-white/35">
          <Zap size={12} />
          DSH runtime · MCP native · RBAC
        </div>
      </div>

      {/* 表单区 */}
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pt-5 lg:justify-end lg:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex items-center gap-0.5">
            <button
              className="icon-btn text-[11.5px] font-semibold"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              title="Language"
            >
              <Languages size={16} />
            </button>
            <button className="icon-btn" onClick={toggle} title="Theme">
              {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-8">
          <div className="w-full max-w-[360px] animate-fade-up">
            <h2 className="text-[26px] font-semibold tracking-tight text-ink">
              {mode === "login" ? t("auth.welcomeBack") : t("auth.signUp")}
            </h2>
            <p className="mt-1.5 text-[13.5px] text-muted">
              {mode === "login" ? t("auth.subtitle") : t("auth.signupSubtitle")}
            </p>

            <form onSubmit={submit} className="mt-7 space-y-3.5">
              {mode === "register" && (
                <div>
                  <label className="label">{t("auth.name")}</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={locale === "zh" ? "你的名字" : "Your name"}
                    required
                    autoComplete="name"
                  />
                </div>
              )}
              <div>
                <label className="label">{t("auth.email")}</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@team.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="label">{t("auth.password")}</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={mode === "register" ? 8 : 1}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {error && (
                <div className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>
              )}

              <button type="submit" disabled={busy} className="btn-primary h-11 w-full text-[14px]">
                {busy ? <Spinner size={15} className="text-white" /> : null}
                {mode === "login" ? t("auth.signIn") : t("auth.signUp")}
                {!busy && <ArrowRight size={15} />}
              </button>
            </form>

            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              className="mt-3 w-full text-center text-[12.5px] text-muted transition hover:text-ink"
            >
              {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}
            </button>

            <div className="mt-7 rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium text-ink">{t("auth.demo")}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint">admin@tinybuddy.dev · admin123456</div>
                </div>
                <button onClick={fillDemo} className="btn-outline shrink-0 whitespace-nowrap px-2.5 py-1.5 text-[11.5px]">
                  {locale === "zh" ? "填入" : "Fill"}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10.5px] text-faint">
                <span className="rounded-lg bg-elevated px-2 py-1">ops@ · admin</span>
                <span className="rounded-lg bg-elevated px-2 py-1">dev@ · member</span>
                <span className="rounded-lg bg-elevated px-2 py-1">guest@ · viewer</span>
                <span className="rounded-lg bg-elevated px-2 py-1">密码同 admin123456</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const LoginFeatures = { Brain, Library, clsx };
