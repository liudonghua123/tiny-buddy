import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  MoreHorizontal,
  Search,
  Sparkles,
  Sun,
  Moon,
  Languages,
  LogOut,
  ChevronRight,
  Menu,
  X,
  Command,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import { initials } from "../lib/format";
import { Modal } from "./ui";
import { NAV_ITEMS, type NavItem } from "./nav";
import { CommandPaletteProvider, usePalette } from "./CommandPalette";

function useNavList() {
  const { can } = useAuth();
  return NAV_ITEMS.filter((item) => !item.permission || can(item.permission));
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#8b6dff] to-[#5b3ae0] shadow-[0_6px_16px_-6px_rgba(109,74,255,.8)]">
        <Sparkles size={17} className="text-white" strokeWidth={2.2} />
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-surface bg-ok" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-ink">TinyBuddy</div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">AI Teammate</div>
        </div>
      )}
    </div>
  );
}

function UserCard({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="rounded-2xl border border-line bg-elevated/70 p-2.5">
      <button
        onClick={() => {
          navigate("/settings");
          onNavigate?.();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl p-1 text-left transition hover:bg-surface"
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
          style={{ background: user.avatarColor }}
        >
          {initials(user.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{user.name}</div>
          <div className="truncate text-[11px] text-faint">
            {user.roleKey} · {user.email}
          </div>
        </div>
        <ChevronRight size={14} className="text-faint" />
      </button>
      <button
        onClick={logout}
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted transition hover:bg-surface hover:text-danger"
      >
        <LogOut size={13} /> {t("auth.signOut")}
      </button>
    </div>
  );
}

function Sidebar() {
  const { t } = useI18n();
  const palette = usePalette();
  const nav = useNavList();
  const primary = nav.filter((n) => n.group === "primary");
  const admin = nav.filter((n) => n.group === "admin");

  return (
    <aside className="hidden h-full w-[252px] shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-4 lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <button
        onClick={palette.open}
        className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-elevated/60 px-2.5 py-2 text-[12px] text-faint transition hover:border-faint/50 hover:text-muted"
      >
        <Search size={13} />
        <span className="flex-1 text-left">{t("palette.trigger")}</span>
        <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[9.5px]">⌘K</kbd>
      </button>

      <nav className="mt-4 flex flex-1 flex-col gap-0.5 overflow-y-auto px-0.5">
        {primary.map((item) => (
          <NavItemLink key={item.to} item={item} label={t(item.key)} />
        ))}
        <div className="my-3 px-2">
          <div className="divider" />
        </div>
        {admin.map((item) => (
          <NavItemLink key={item.to} item={item} label={t(item.key)} />
        ))}
      </nav>

      <div className="mt-2 flex items-center justify-between px-1.5">
        <span className="text-[10px] uppercase tracking-[0.1em] text-faint">{t("settings.appearance")}</span>
        <IconActions />
      </div>

      <div className="mt-2">
        <UserCard />
      </div>
    </aside>
  );
}

function NavItemLink({ item, label }: { item: NavItem; label: string }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          "group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition",
          isActive ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-elevated hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={17} strokeWidth={isActive ? 2.2 : 1.9} className={isActive ? "text-brand" : "text-faint group-hover:text-muted"} />
          <span className="flex-1">{label}</span>
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
        </>
      )}
    </NavLink>
  );
}

function IconActions() {
  const { locale, setLocale } = useI18n();
  const { resolved, toggle } = useTheme();

  return (
    <div className="flex items-center gap-0.5">
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
  );
}

function MobileHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useI18n();
  const palette = usePalette();
  const { pathname } = useLocation();
  const current = NAV_ITEMS.find((n) => pathname.startsWith(n.to));

  return (
    <header className="safe-top flex shrink-0 items-center justify-between border-b border-line bg-bg/90 px-3 py-2.5 backdrop-blur lg:hidden">
      <button onClick={onOpenMenu} className="flex items-center gap-2">
        <Logo compact />
        <span className="text-[15px] font-semibold text-ink">{current ? t(current.key) : "TinyBuddy"}</span>
      </button>
      <div className="flex items-center gap-0.5">
        <button className="icon-btn" onClick={palette.open} aria-label={t("palette.trigger")}>
          <Search size={16} />
        </button>
        <IconActions />
      </div>
    </header>
  );
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const nav = useNavList();
  const visible = nav.filter((n) => ["/chat", "/memory", "/knowledge", "/mcp"].includes(n.to));

  return (
    <nav className="safe-bottom flex shrink-0 items-stretch border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      {visible.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx("relative flex flex-1 flex-col items-center gap-0.5 py-2.5 transition", isActive ? "text-brand" : "text-faint")
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-0 h-[2px] w-6 rounded-full bg-brand" />}
                <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} />
                <span className="text-[10.5px] font-medium">{t(item.key)}</span>
              </>
            )}
          </NavLink>
        );
      })}
      <button onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-faint">
        <MoreHorizontal size={20} strokeWidth={1.8} />
        <span className="text-[10.5px] font-medium">{t("nav.more")}</span>
      </button>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const nav = useNavList();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const extra = nav.filter((n) => !["/chat", "/memory", "/knowledge", "/mcp"].includes(n.to));

  return (
    <Modal open={open} onClose={onClose} title={t("nav.more")}>
      <div className="grid grid-cols-2 gap-2">
        {extra.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.to}
              onClick={() => {
                navigate(item.to);
                onClose();
              }}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-3 text-left transition hover:bg-elevated"
            >
              <Icon size={17} className="text-brand" />
              <span className="text-[13px] font-medium text-ink">{t(item.key)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <p className="label">{t("settings.language")}</p>
          <div className="flex gap-2">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={clsx(
                  "flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium transition",
                  locale === l ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-line text-muted",
                )}
              >
                {l === "zh" ? "简体中文" : "English"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">{t("settings.theme")}</p>
          <div className="flex gap-2">
            {(
              [
                ["light", t("settings.themeLight")],
                ["dark", t("settings.themeDark")],
                ["system", t("settings.themeSystem")],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  "flex-1 rounded-xl border px-2 py-2 text-[12.5px] font-medium transition",
                  mode === m ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-line text-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-xl border border-line px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold text-white"
            style={{ background: user?.avatarColor }}
          >
            {initials(user?.name ?? "?")}
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink">{user?.name}</div>
            <div className="text-[11px] text-faint">{user?.roleKey}</div>
          </div>
        </div>
        <button
          className="flex items-center gap-1.5 text-[12.5px] text-muted transition hover:text-danger"
          onClick={() => {
            onClose();
            logout();
          }}
        >
          <LogOut size={14} /> {t("auth.signOut")}
        </button>
      </div>
    </Modal>
  );
}

function CommandHint() {
  const { t } = useI18n();
  return (
    <div className="mx-1 mb-3 rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <Command size={12} />
        <span className="flex-1">{t("brand.tagline")}</span>
      </div>
    </div>
  );
}

export function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const nav = useNavList();
  const { t } = useI18n();
  // 对话页自带 header（返回 / 会话标题 / 会话操作），移动端不再叠加全局 header
  const hideMobileHeader = pathname.startsWith("/chat");

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <CommandPaletteProvider>
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {!hideMobileHeader && <MobileHeader onOpenMenu={() => setMenuOpen(true)} />}
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <BottomNav onMore={() => setMoreOpen(true)} />
      </div>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />

      {menuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setMenuOpen(false)} />
          <div className="animate-fade-up relative flex h-full w-[82%] max-w-[320px] flex-col border-r border-line bg-surface px-3 py-5">
            <div className="flex items-center justify-between px-2">
              <Logo />
              <button className="icon-btn" onClick={() => setMenuOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto">
              {nav.map((item) => (
                <NavItemLink key={item.to} item={item} label={t(item.key)} />
              ))}
            </nav>
            <CommandHint />
            <UserCard onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
    </div>
    </CommandPaletteProvider>
  );
}

export { Logo, Menu };
