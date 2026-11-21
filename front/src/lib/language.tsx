import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LANGUAGES,
  isLanguageCode,
  languageMeta,
  translate,
  type LanguageCode,
  type MessageKey,
} from "./i18n";

const STORAGE_KEY = "novatube.language";

interface LanguageValue {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageValue | null>(null);

/** Best guess from the browser when nothing has been picked yet. */
function detectLanguage(): LanguageCode {
  if (typeof navigator !== "undefined") {
    const base = (navigator.language || "").toLowerCase().split("-")[0];
    const match = LANGUAGES.find((language) => language.code === base);
    if (match) return match.code;
  }
  return "en";
}

function readStored(): LanguageCode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    /* storage can be disabled — fall through to detection */
  }
  return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => readStored() ?? detectLanguage());

  useEffect(() => {
    const meta = languageMeta(language);
    document.documentElement.lang = language;
    document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  const value = useMemo<LanguageValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => translate(language, key, vars),
      dir: languageMeta(language).rtl ? "rtl" : "ltr",
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
