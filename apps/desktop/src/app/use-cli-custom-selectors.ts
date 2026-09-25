import { useEffect } from "react";
import { getCliMatches } from "../adapters/tauri";
import { useSessionStore } from "./session-store";

/**
 * CLI 自定义选择器接线（P4-05b，F11）：启动时读取壳解析的
 * --custom-selector/--custom-button（tauri.conf.json multiple 参数），
 * 非空则一次性 setCustomSelectors 进后端（后端允许先于 loadConfig；
 * 之后每次加载/重载自动重放 default_selected）。
 *
 * 模块级 wired 闸：StrictMode 双挂载与重渲染不重复接线（setCustomSelectors
 * 是变更类 RPC，重复调用会无谓递增后端选择器代际）。wired 在参数解析成功
 * 且文件列表非空时才置位——首轮挂载被 StrictMode 回收（cancelled）时
 * 第二轮仍能接线；并发挂载由后置检查兜底。
 */
let wired = false;

/** 从 get_cli_matches 结果收集选择器文件（值形态 string | string[]，防御性归一）。 */
export function collectCustomSelectorFiles(matches: Record<string, unknown>): string[] {
  const files: string[] = [];
  for (const key of ["custom-selector", "custom-button"]) {
    const entry = matches[key];
    const value =
      typeof entry === "object" && entry !== null
        ? (entry as { value?: unknown }).value
        : undefined;
    if (typeof value === "string") {
      files.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          files.push(item);
        }
      }
    }
  }
  return files;
}

export function useCliCustomSelectors(): void {
  useEffect(() => {
    if (wired) return;
    let cancelled = false;
    getCliMatches()
      .then(async (matches) => {
        const files = collectCustomSelectorFiles(matches);
        if (cancelled || files.length === 0 || wired) return;
        wired = true;
        // 失败时 store.lastError 已可见，这里无需额外处理。
        await useSessionStore.getState().setCustomSelectors(files);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          useSessionStore.setState({
            lastError: `读取启动参数失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
}

/** 测试隔离：允许下一用例重新接线。 */
export function resetCliCustomSelectorsWiring(): void {
  wired = false;
}
