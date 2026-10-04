import { useSyncExternalStore } from "react";
import { messages as de } from "./de";
import { messages as en } from "./en";
import { messages as es } from "./es";
import { messages as fr } from "./fr";
import { messages as ja } from "./ja";
import type { MessageArgs, MessageKey, Messages } from "./types";
import { messages as zhCN } from "./zh-CN";
import { messages as zhTW } from "./zh-TW";

export type { MessageKey, Messages } from "./types";

export const LANGUAGE_NAMES = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
} as const;
export type Locale = keyof typeof LANGUAGE_NAMES;
export type LanguagePreference = "system" | Locale;
export const catalogs: Record<Locale, Messages> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  de,
  fr,
  es,
};

export function normalizePreference(value: unknown): LanguagePreference {
  return typeof value === "string" && Object.hasOwn(LANGUAGE_NAMES, value)
    ? (value as Locale)
    : "system";
}

/** 按系统偏好顺序匹配语言，中文脚本标识优先于地区。 */
export function detectLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    try {
      const parsed = new Intl.Locale(tag.replaceAll("_", "-"));
      if (parsed.language === "zh") {
        const script = parsed.script ?? parsed.maximize().script;
        if (script === "Hant") return "zh-TW";
        if (script === "Hans") return "zh-CN";
        continue;
      }
      if (Object.hasOwn(LANGUAGE_NAMES, parsed.language)) return parsed.language as Locale;
    } catch {
      // 无效标签不阻止匹配后续偏好。
    }
  }
  return "en";
}

export function getBrowserLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages.length > 0 ? [...navigator.languages] : [navigator.language];
}

export function translateMessage(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
  catalog: Partial<Messages> = catalogs[locale],
): string {
  const candidate = catalog[key];
  const template = typeof candidate === "string" && candidate.trim() !== "" ? candidate : en[key];
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, name: string) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

let systemLocales = getBrowserLocales();
let snapshot = {
  preference: "system" as LanguagePreference,
  locale: detectLocale(systemLocales),
  systemLocale: detectLocale(systemLocales),
};
const listeners = new Set<() => void>();

function applyLanguage(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = snapshot.locale;
  document.documentElement.dir = "ltr";
}

function update(preference: LanguagePreference): void {
  const systemLocale = detectLocale(systemLocales);
  snapshot = {
    preference,
    systemLocale,
    locale: preference === "system" ? systemLocale : preference,
  };
  applyLanguage();
  for (const listener of listeners) listener();
}

export function setSystemLocales(tags: readonly string[]): void {
  systemLocales = [...tags];
  update(snapshot.preference);
}

export function setLanguagePreference(value: unknown): void {
  update(normalizePreference(value));
}

export function getLanguagePreference(): LanguagePreference {
  return snapshot.preference;
}

export function getLocale(): Locale {
  return snapshot.locale;
}

export function translate<Key extends MessageKey>(key: Key, ...args: MessageArgs<Key>): string {
  return translateMessage(snapshot.locale, key, args[0]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("languagechange", onLanguageChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("languagechange", onLanguageChange);
    }
  };
}

function onLanguageChange(): void {
  // 桌面系统偏好由原生接口获取；浏览器事件更新预览偏好。
  if (!Object.hasOwn(window, "__TAURI_INTERNALS__")) setSystemLocales(getBrowserLocales());
}

export function useI18n() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  return { ...state, t: translate };
}

/** 测试恢复检测与偏好，保持订阅释放由组件处理。 */
export function resetLocalization(): void {
  systemLocales = getBrowserLocales();
  update("system");
}

applyLanguage();
