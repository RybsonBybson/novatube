import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LanguageCode } from "@shared/types";
import { api } from "../api";
import {
  LANGUAGES,
  isLanguageCode,
  languageMeta,
  translate,
  type LanguageMeta,
  type MessageKey,
  type TranslationVars,
} from "./index";

const STORAGE_KEY = "novatube.language";

interface I18nValue {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  t: (key: MessageKey, vars?: TranslationVars) => string;
  dir: "ltr" | "rtl";
  meta: LanguageMeta;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Best guess from the OS/browser when nothing has been picked yet. */
function detectLanguage(): LanguageCode {
  if (typeof navigator !== "undefined") {
    const tag = (navigator.language || "").toLowerCase();
    const base = tag.split("-")[0];
    const match = LANGUAGES.find((language) => language.code === base);
    if (match) return match.code;
  }
  return "en";
}

function readStoredLanguage(): LanguageCode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    /* storage can be disabled — fall through to detection */
  }
  return null;
}

function applyDocumentLanguage(code: LanguageCode) {
  const meta = languageMeta(code);
  document.documentElement.lang = code;
  document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => readStoredLanguage() ?? detectLanguage());

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  /* Adopt the persisted choice from settings on first load (covers a fresh
   * webview where localStorage was cleared). Local storage stays the fast path. */
  useEffect(() => {
    let cancelled = false;
    api.settings
      .get()
      .then((settings) => {
        if (cancelled) return;
        if (isLanguageCode(settings.language) && !readStoredLanguage()) {
          setLanguageState(settings.language);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: LanguageCode) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage failures */
    }
    // Persist in the backend too so a fresh install reopens in the same language.
    void api.settings.update({ language: next }).catch(() => undefined);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const meta = languageMeta(language);
    return {
      language,
      setLanguage,
      t: (key, vars) => translate(language, key, vars),
      dir: meta.rtl ? "rtl" : "ltr",
      meta,
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside LanguageProvider");
  return context;
}
