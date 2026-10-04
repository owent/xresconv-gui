import { useEffect, useSyncExternalStore } from "react";
import {
  type DisplaySettings,
  getCliMatches,
  getSystemLocales,
  readDisplaySettings,
  writeDisplaySettings,
} from "../adapters/tauri";
import {
  getLanguagePreference,
  type LanguagePreference,
  normalizePreference,
  resetLocalization,
  setLanguagePreference,
  setSystemLocales,
  translate as t,
  useI18n,
} from "../i18n";
import {
  isRetryableStartupError,
  STARTUP_RETRY_INTERVAL_MS,
  STARTUP_RETRY_TIMEOUT_MS,
} from "./startup-retry";

/** 显示设置共享 store：语言、主题、字体和上次配置通过 Tauri 接口持久化。 */
export type ThemeMode = NonNullable<DisplaySettings["theme"]>;

/** 单区字体偏好（空=该区默认）。 */
export interface FontPrefs {
  family: string;
  size: number | null;
}

export interface FontsConfig {
  global: FontPrefs;
  ui: FontPrefs;
  tree: FontPrefs;
  log: FontPrefs;
}

export type FontArea = keyof FontsConfig;

export interface DisplaySettingsState {
  theme: ThemeMode;
  lastConfigFile: string | null;
  fonts: FontsConfig;
}

const emptyPrefs = (): FontPrefs => ({ family: "", size: null });
const defaultFonts = (): FontsConfig => ({
  global: emptyPrefs(),
  ui: emptyPrefs(),
  tree: emptyPrefs(),
  log: emptyPrefs(),
});
const DEFAULT_SETTINGS: DisplaySettingsState = {
  theme: "system",
  lastConfigFile: null,
  fonts: defaultFonts(),
};

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/** 分区字体 → CSS 变量（空值清除回默认）。 */
function applyFonts(fonts: FontsConfig): void {
  const root = document.documentElement;
  for (const [area, prefs] of Object.entries(fonts) as [FontArea, FontPrefs][]) {
    const key = `--font-${area}`;
    if (prefs.family !== "") {
      root.style.setProperty(`${key}-family`, prefs.family);
    } else {
      root.style.removeProperty(`${key}-family`);
    }
    if (prefs.size !== null && Number.isFinite(prefs.size)) {
      root.style.setProperty(`${key}-size`, `${String(prefs.size)}px`);
    } else {
      root.style.removeProperty(`${key}-size`);
    }
  }
}

function toPrefs(
  value: Partial<{ family: string | null; size: number | null }> | undefined,
): FontPrefs {
  return {
    family: typeof value?.family === "string" ? value.family : "",
    size: typeof value?.size === "number" && Number.isFinite(value.size) ? value.size : null,
  };
}

/** 合并写盘（保留未变更字段）；无桥接（浏览器预览）时静默跳过。 */
let writes: Promise<void> = Promise.resolve();

function persist(patch: {
  theme?: ThemeMode;
  language?: LanguagePreference;
  lastConfigFile?: string | null;
  fonts?: FontsConfig;
}): Promise<void> {
  writes = writes
    .then(async () => {
      const current = await readDisplaySettings();
      const fontsValue = patch.fonts
        ? Object.fromEntries(
            Object.entries(patch.fonts).map(([area, prefs]) => [
              area,
              {
                family: prefs.family === "" ? null : prefs.family,
                size: prefs.size,
              },
            ]),
          )
        : undefined;
      await writeDisplaySettings({
        theme: patch.theme ?? current?.theme ?? null,
        language:
          patch.language ?? normalizePreference(current?.language ?? getLanguagePreference()),
        lastConfigFile:
          patch.lastConfigFile !== undefined
            ? patch.lastConfigFile
            : (current?.lastConfigFile ?? null),
        fonts: (fontsValue ?? current?.fonts ?? null) as DisplaySettings["fonts"],
      });
    })
    .catch((error: unknown) => {
      console.error("display settings persist failed", error);
    });
  return writes;
}

/* ---- 模块级 store ---- */

let state: DisplaySettingsState = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ---- 自动加载（backend 就绪重试；瞬态错误不进可见告警） ---- */

/**
 * 自动加载上次配置（带 backend 就绪重试）：启动时 guardian/backend 可能仍在
 * 启动中（BACKEND_NOT_READY 等瞬态错误），立即发 loadConfig 会失败。轮询重试
 * 直到成功、明确业务失败（不重试）或超时；重试期间清掉瞬态 lastError 并在
 * 日志里记一条等待提示——用户不应看到 raw "guardian protocol violation"。
 */
async function autoLoadWithRetry(path: string): Promise<void> {
  const { useSessionStore } = await import("./session-store");
  const deadline = Date.now() + STARTUP_RETRY_TIMEOUT_MS;
  let noticed = false;
  for (;;) {
    const store = useSessionStore.getState();
    if (store.snapshot !== null) return;
    const ok = await store.loadConfig(path);
    if (ok) return;
    const error = useSessionStore.getState().lastError ?? "";
    if (!isRetryableStartupError(error)) {
      // 业务失败（文件不存在/CONFIG_ERROR）：保持 lastError 可见，不重试。
      return;
    }
    if (Date.now() + STARTUP_RETRY_INTERVAL_MS > deadline) {
      // 超时：保留最后的瞬态错误为可见错误（不再静默）。
      useSessionStore
        .getState()
        .appendLocalLog(t("diagnostics.autoLoadTimeout", { error }), "error");
      return;
    }
    if (!noticed) {
      noticed = true;
      useSessionStore
        .getState()
        .appendLocalLog(
          t("diagnostics.autoLoadWait", { seconds: Math.round(STARTUP_RETRY_TIMEOUT_MS / 1000) }),
          "info",
        );
    }
    // 瞬态错误不留在告警区（重试成功后无需用户处理）。
    useSessionStore.setState({ lastError: null });
    await new Promise((resolve) => setTimeout(resolve, STARTUP_RETRY_INTERVAL_MS));
  }
}

/** 解析自动加载目标：优先 CLI --input（ 启动参数语义），其次上次文件。 */
async function resolveAutoLoadTarget(
  fallback: string | null,
  matchesPromise: Promise<Record<string, unknown>>,
): Promise<string | null> {
  try {
    const matches = await matchesPromise;
    const cliInput: unknown = (matches as { input?: unknown }).input;
    if (typeof cliInput === "string" && cliInput.length > 0) {
      return cliInput;
    }
    if (typeof cliInput === "object" && cliInput !== null) {
      const value = (cliInput as { value?: unknown }).value;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  } catch {
    /* CLI 读取失败回退上次文件 */
  }
  return fallback;
}

/* ---- 一次性引导（模块级，StrictMode 安全） ---- */

let bootstrapStarted = false;
let bootstrapGeneration = 0;
let languageEdited = false;

/** 测试隔离：恢复启动状态，已挂载的订阅由 React cleanup 释放。 */
export function resetDisplaySettings(): void {
  bootstrapStarted = false;
  bootstrapGeneration++;
  languageEdited = false;
  state = DEFAULT_SETTINGS;
  writes = Promise.resolve();
  resetLocalization();
}

function bootstrap(): void {
  if (bootstrapStarted) return;
  bootstrapStarted = true;
  const generation = bootstrapGeneration;
  const cliMatches = getCliMatches().catch(() => ({}));
  Promise.all([readDisplaySettings().catch(() => null), getSystemLocales().catch(() => [])])
    .then(async ([loaded, systemLocales]) => {
      if (generation !== bootstrapGeneration) return;
      setSystemLocales(Array.isArray(systemLocales) ? systemLocales : []);
      if (!languageEdited) setLanguagePreference(loaded?.language);
      state = {
        theme: loaded?.theme ?? "system",
        lastConfigFile: loaded?.lastConfigFile ?? null,
        fonts: {
          global: toPrefs(loaded?.fonts?.global),
          ui: toPrefs(loaded?.fonts?.ui),
          tree: toPrefs(loaded?.fonts?.tree),
          log: toPrefs(loaded?.fonts?.log),
        },
      };
      applyTheme(state.theme);
      applyFonts(state.fonts);
      emit();
      const target = await resolveAutoLoadTarget(state.lastConfigFile, cliMatches);
      if (target !== null && target.length > 0) {
        await autoLoadWithRetry(target);
      }
    })
    .catch(() => {
      /* 无桥接（浏览器预览）：默认主题即可 */
    });
}

export function useDisplaySettings(): DisplaySettingsState & {
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
  setTheme: (theme: ThemeMode) => void;
  setFontPrefs: (area: FontArea, prefs: FontPrefs) => void;
} {
  const { preference: language } = useI18n();
  const settings = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    bootstrap();
  }, []);

  const setTheme = (theme: ThemeMode) => {
    state = { ...state, theme };
    applyTheme(theme);
    emit();
    void persist({ theme });
  };

  const setFontPrefs = (area: FontArea, prefs: FontPrefs) => {
    state = { ...state, fonts: { ...state.fonts, [area]: prefs } };
    applyFonts(state.fonts);
    emit();
    void persist({ fonts: state.fonts });
  };

  const setLanguage = (language: LanguagePreference) => {
    languageEdited = true;
    setLanguagePreference(language);
    void persist({ language });
  };

  return { ...settings, language, setLanguage, setTheme, setFontPrefs };
}

/** loadConfig 成功后调用：持久化上次文件（供自动加载）。 */
export function rememberLoadedConfig(path: string): void {
  state = { ...state, lastConfigFile: path };
  emit();
  void persist({ lastConfigFile: path });
}
