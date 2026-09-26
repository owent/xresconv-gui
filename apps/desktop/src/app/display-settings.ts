import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { type DisplaySettings, readDisplaySettings, writeDisplaySettings } from "../adapters/tauri";

/**
 * 显示设置（2026-09-26 用户需求）：
 * - 主题三态（system/light/dark）：写入 `<html data-theme>`；"system" 移除属性
 *   交回 prefers-color-scheme（tokens.css 三态支持）。
 * - 上次转换列表文件：loadConfig 成功后持久化；启动时读取并自动加载
 *   （仅在桥接可用时；文件不存在/加载失败不阻塞，错误走 lastError 可见）。
 * - 状态为 UI 本地（不经 session store——与后端会话无关）；写盘合并保留另一字段。
 */
export type ThemeMode = NonNullable<DisplaySettings["theme"]>;

export interface DisplaySettingsState {
  theme: ThemeMode;
  lastConfigFile: string | null;
}

const DEFAULT_SETTINGS: DisplaySettingsState = { theme: "system", lastConfigFile: null };

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/** 合并写盘（保留未变更字段）；无桥接（浏览器预览）时静默跳过。 */
async function persist(patch: Partial<DisplaySettingsState>): Promise<void> {
  try {
    const current = await readDisplaySettings();
    const next: DisplaySettings = {
      theme: patch.theme ?? current?.theme ?? null,
      lastConfigFile:
        patch.lastConfigFile !== undefined
          ? patch.lastConfigFile
          : (current?.lastConfigFile ?? null),
    };
    await writeDisplaySettings(next);
  } catch (error) {
    if (invoke !== undefined) {
      // 桥接存在但读写失败：可见提示（不静默丢设置）。
      console.error("display settings persist failed", error);
    }
  }
}

/**
 * 挂载即读取设置：应用主题；有 lastConfigFile 且桥接可用时自动加载。
 * 一次性闸（StrictMode 双挂载不重复加载）。
 */
export function useDisplaySettings(): DisplaySettingsState & {
  setTheme: (theme: ThemeMode) => void;
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
        };
        setSettings(next);
        applyTheme(next.theme);
        // 自动加载上次转换列表（存在性由 backend loadConfig 判定；失败可见不阻塞）。
        if (next.lastConfigFile !== null && next.lastConfigFile.length > 0) {
          void import("./session-store").then(({ useSessionStore }) => {
            if (useSessionStore.getState().snapshot === null) {
              void useSessionStore.getState().loadConfig(next.lastConfigFile as string);
            }
          });
        }
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

  return { ...settings, setTheme };
}

/** loadConfig 成功后调用：持久化上次文件（供自动加载）。 */
export function rememberLoadedConfig(path: string): void {
  void persist({ lastConfigFile: path });
}
