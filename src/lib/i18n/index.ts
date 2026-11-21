import type { LanguageCode } from "@shared/types";
import { en, type MessageKey } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { ru } from "./ru";
import { zh } from "./zh";
import { ja } from "./ja";
import { pl } from "./pl";
import { de } from "./de";
import { fr } from "./fr";
import { ar } from "./ar";
import { hi } from "./hi";
import { ko } from "./ko";
import { it } from "./it";
import { tr } from "./tr";

export type { MessageKey };

export type TranslationVars = Record<string, string | number>;

export interface LanguageMeta {
  code: LanguageCode;
  /** Name written in the language itself. */
  native: string;
  /** English name, used in tooltips and search. */
  english: string;
  /** Country flag used for the badge. */
  flag: string;
  rtl?: boolean;
}

/**
 * Display order: English first, then the languages people ask for most often.
 * Every entry is a real, fully translated dictionary — nothing is a placeholder.
 */
export const LANGUAGES: LanguageMeta[] = [
  { code: "en", native: "English", english: "English", flag: "US" },
  { code: "es", native: "Español", english: "Spanish", flag: "ES" },
  { code: "pt", native: "Português", english: "Portuguese", flag: "PT" },
  { code: "ru", native: "Русский", english: "Russian", flag: "RU" },
  { code: "zh", native: "中文", english: "Chinese", flag: "CN" },
  { code: "ja", native: "日本語", english: "Japanese", flag: "JP" },
  { code: "pl", native: "Polski", english: "Polish", flag: "PL" },
  { code: "de", native: "Deutsch", english: "German", flag: "DE" },
  { code: "fr", native: "Français", english: "French", flag: "FR" },
  { code: "ar", native: "العربية", english: "Arabic", flag: "SA", rtl: true },
  { code: "hi", native: "हिन्दी", english: "Hindi", flag: "IN" },
  { code: "ko", native: "한국어", english: "Korean", flag: "KR" },
  { code: "it", native: "Italiano", english: "Italian", flag: "IT" },
  { code: "tr", native: "Türkçe", english: "Turkish", flag: "TR" },
];

export const DICTIONARIES: Record<LanguageCode, Record<MessageKey, string>> = {
  en,
  es,
  pt,
  ru,
  zh,
  ja,
  pl,
  de,
  fr,
  ar,
  hi,
  ko,
  it,
  tr,
};

const CODES = new Set<string>(LANGUAGES.map((language) => language.code));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && CODES.has(value);
}

export function languageMeta(code: LanguageCode): LanguageMeta {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

/** Replace `{name}` placeholders. Unknown keys stay untouched rather than throwing. */
export function translate(language: LanguageCode, key: MessageKey, vars?: TranslationVars): string {
  const table = DICTIONARIES[language] ?? en;
  const template = table[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
