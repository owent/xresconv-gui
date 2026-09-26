import { useEffect, useRef, useState } from "react";
import {
  type DisplaySettings,
  getCliMatches,
  readDisplaySettings,
  writeDisplaySettings,
} from "../adapters/tauri";

/**
 * 显示设置（2026-09-26 用户需求）：
 * - 主题三态（system/light/dark）：写入 `<html data-theme>`；"system" 移除属性
 *   交回 prefers-color-scheme（tokens.css 三态支持）。
 * - 上次转换列表文件：loadConfig 成功后持久化；启动时读取并自动加载
 *   （backend 就绪重试；失败不阻塞，错误走 lastError 可见）。
 * - 分区字体（全局/UI/树/日志 的 family+size）：经 CSS 变量应用到对应区域
 *   （--font-global-* / --font-ui-* / --font-tree-* / --font-log-*）。
 * - 状态为 UI 本地（不经 session store——与后端会话无关）；写盘合并保留其它字段。
 */
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
  const areas: Record<FontArea, { family: string; size: number | null }> = {
    global: fonts.global,
    ui: fonts.ui,
    tree: fonts.tree,
    log: fonts.log,
  };
  for (const [area, prefs] of Object.entries(areas)) {
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
async function persist(patch: {
  theme?: ThemeMode;
  lastConfigFile?: string | null;
  fonts?: FontsConfig;
}): Promise<void> {
  try {
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
      lastConfigFile:
        patch.lastConfigFile !== undefined
          ? patch.lastConfigFile
          : (current?.lastConfigFile ?? null),
      fonts: fontsValue as DisplaySettings["fonts"],
    });
  } catch (error) {
    console.error("display settings persist failed", error);
  }
}

/**
 * 自动加载上次配置（带 backend 就绪重试）：启动时 guardian/backend 可能仍在
 * 启动中（BACKEND_NOT_READY/BACKEND_TIMEOUT/guardian 通道未就绪），立即发
 * loadConfig 会以 "guardian protocol violation" 失败。轮询重试直到成功、
 * 明确的业务失败（如文件不存在）或超时；业务失败不重试（重试无意义）。
 */
const AUTO_LOAD_RETRY_MS = 600;
const AUTO_LOAD_TIMEOUT_MS = 30_000;

function isRetryableStartupError(message: string): boolean {
  return (
    message.includes("BACKEND_NOT_READY") ||
    message.includes("BACKEND_TIMEOUT") ||
    message.includes("guardian") ||
    message.includes("channel")
  );
}

async function autoLoadWithRetry(path: string): Promise<void> {
  const { useSessionStore } = await import("./session-store");
  const deadline = Date.now() + AUTO_LOAD_TIMEOUT_MS;
  for (;;) {
    if (useSessionStore.getState().snapshot !== null) return;
    const ok = await useSessionStore.getState().loadConfig(path);
    if (ok) return;
    const error = useSessionStore.getState().lastError ?? "";
    if (!isRetryableStartupError(error) || Date.now() + AUTO_LOAD_RETRY_MS > deadline) {
      // 明确失败（文件不存在/CONFIG_ERROR）或超时：保留 lastError 可见，不再重试。
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, AUTO_LOAD_RETRY_MS));
  }
}

export function useDisplaySettings(): DisplaySettingsState & {
  setTheme: (theme: ThemeMode) => void;
  setFontPrefs: (area: FontArea, prefs: FontPrefs) => void;
} {
  const [settings, setSettings] = useState<DisplaySettingsState>(DEFAULT_SETTINGS);
  const wired = useRef(false);

  useEffect(() => {
    if (wired.current) return;
    wired.current = true;
    let cancelled = false;
    readDisplaySettings()
      .then((loaded) => {
        if (cancelled || loaded === null) return;
        const next: DisplaySettingsState = {
          theme: (loaded.theme ?? "system") as ThemeMode,
          lastConfigFile: loaded.lastConfigFile ?? null,
          fonts: {
            global: toPrefs(loaded.fonts?.global),
            ui: toPrefs(loaded.fonts?.ui),
            tree: toPrefs(loaded.fonts?.tree),
            log: toPrefs(loaded.fonts?.log),
          },
        };
        setSettings(next);
        applyTheme(next.theme);
        applyFonts(next.fonts);
        // 自动加载（backend 就绪重试；失败可见不阻塞）：优先 CLI --input
        // （F11 启动参数语义），其次显示设置的上次文件（2026-09-26 用户需求）。
        void (async () => {
          let target: string | null = null;
          try {
            const matches = await getCliMatches();
            const cliInput: unknown = (matches as { input?: unknown }).input;
            if (typeof cliInput === "string" && cliInput.length > 0) {
              target = cliInput;
            } else if (typeof cliInput === "object" && cliInput !== null) {
              const value = (cliInput as { value?: unknown }).value;
              if (typeof value === "string" && value.length > 0) {
                target = value;
              }
            }
          } catch {
            /* CLI 读取失败回退上次文件 */
          }
          if (target === null) {
            target = next.lastConfigFile;
          }
          if (target !== null && target.length > 0) {
            await autoLoadWithRetry(target);
          }
        })();
      })
      .catch(() => {
        /* 无桥接（浏览器预览）：默认主题即可 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = (theme: ThemeMode) => {
    setSettings((prev) => ({ ...prev, theme }));
    applyTheme(theme);
    void persist({ theme });
  };

  const setFontPrefs = (area: FontArea, prefs: FontPrefs) => {
    setSettings((prev) => {
      const fonts = { ...prev.fonts, [area]: prefs };
      applyFonts(fonts);
      void persist({ fonts });
      return { ...prev, fonts };
    });
  };

  return { ...settings, setTheme, setFontPrefs };
}

/** loadConfig 成功后调用：持久化上次文件（供自动加载）。 */
export function rememberLoadedConfig(path: string): void {
  void persist({ lastConfigFile: path });
}
