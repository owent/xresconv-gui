import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { NodeHealth } from "@xresconv/contracts";

export interface AppInfo {
  name: string;
  version: string;
  protocol_version: number;
}

/**
 * 壳桥接适配层：把 @tauri-apps/api 的直连调用收敛成可注入/可替换的函数集。
 * 组件只依赖本模块，测试按 App.test.tsx 的方式 mock @tauri-apps/api 即可生效。
 *
 * 同命令在途去重：React StrictMode 会同步重放挂载副作用（setup→cleanup→setup），
 * 在途 Promise 复用保证重复挂载不会放大成重复的 invoke 往返（docs/plan/04-ui.md
 * §状态分层：重复挂载不能建立重复任务）。Promise 结算后条目自动移除，
 * 之后再次调用（如“重载配置”）会发起新的探测。
 */
const inflight = new Map<string, Promise<unknown>>();

function dedupeInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }
  const promise = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function getAppInfo(): Promise<AppInfo> {
  return dedupeInflight("get_app_info", () => invoke<AppInfo>("get_app_info"));
}

export function getCliMatches(): Promise<Record<string, unknown>> {
  return dedupeInflight("get_cli_matches", () =>
    invoke<Record<string, unknown>>("get_cli_matches"),
  );
}

export function getBackendHealth(): Promise<NodeHealth> {
  return dedupeInflight("get_backend_health", () => invoke<NodeHealth>("get_backend_health"));
}

/** 打开原生 XML 配置选择框；用户取消时返回 null。 */
export async function pickXmlConfig(): Promise<string | null> {
  const selected = await open({
    title: "选择转换配置",
    filters: [{ name: "xresconv XML", extensions: ["xml"] }],
  });
  return typeof selected === "string" ? selected : null;
}
