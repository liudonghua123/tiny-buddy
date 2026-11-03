import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DICTIONARIES, type Messages } from "./locales";

export type Locale = "zh" | "en";

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  isZh: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

function lookup(dict: Messages | string | undefined, path: string): string | undefined {
  if (!dict) return undefined;
  let node: Messages | string = dict;
  for (const part of path.split(".")) {
    if (typeof node === "string") return undefined;
    const next: string | Messages | undefined = node[part];
    if (next === undefined) return undefined;
    node = next;
  }
  return typeof node === "string" ? node : undefined;
}

function detectLocale(): Locale {
  const saved = localStorage.getItem("tb.locale");
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  // 只有用户显式切换才写入本地偏好；否则登录用户的 locale 就能在首次访问时生效
  const chosen = useRef(false);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    if (chosen.current) localStorage.setItem("tb.locale", locale);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    chosen.current = true;
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = lookup(DICTIONARIES[locale], key) ?? lookup(DICTIONARIES.zh, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
    },
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t, isZh: locale === "zh" }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
