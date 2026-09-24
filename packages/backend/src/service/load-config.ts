/**
 * 配置加载编排（P3-03）：parseXmlConfig + set_name 整合。
 *
 * 旧版每个 `<item>` 入树前同步执行一次 gui.set_name（main.js:1704-1758）：
 * - 上下文：work_dir（解析期相对化）、configure_file=set_name 所在文件（main.js:1710）、
 *   item_data 活引用、每 item 新建 data、alert_*、log_*（module "CONV EVENT"），
 *   无 require/resolve/reject、vm 无 timeout（main.js:1748）。
 * - 单条异常 → catch 记 error（module "GUI EVENT"）后加载继续（main.js:1749-1757）。
 *
 * 新版经 ScriptWorkerPool invoke（entry_kind "set_name"）执行，ops 应用顺序 =
 * invoke 完成顺序 = 树文档顺序（逐条 await）。差异（详见 docs/plan/records/P3-06.md）：
 * - BD-O1：旧版 set_name 无超时（死循环卡死加载）；新版 invoke 带显式 timeoutMs
 *   （默认 {@link DEFAULT_SET_NAME_TIMEOUT_MS}），超时由 guardian 销毁并补员 worker，
 *   记诊断、item 保留原值、加载继续。
 * - BD-O16：error outcome（脚本异常）仍应用 ops 中的部分修改——与旧版活引用语义
 *   一致（main.js:1711 item_data 本体传入，异常前已改的字段保留）；invoke 级失败
 *   （WORKER_TIMEOUT 等）拿不到 ops，item 保留原值。
 */

import { randomUUID } from "node:crypto";
import type { ScriptResult } from "@xresconv/contracts";
import type { ScriptWorkerPool } from "@xresconv/guardian";
import { parseXmlConfig, resolveWorkDir } from "../config/loader.ts";
import type { ParsedConfig, TreeItem } from "../config/model.ts";
import { flattenTreeItems } from "../domain/selection.ts";
import { formatUnknownError } from "./format.ts";
import type { LogPipeline } from "./log-pipeline.ts";

/** set_name 单条 invoke 的默认硬超时（BD-O1；旧版无超时，main.js:1748）。 */
export const DEFAULT_SET_NAME_TIMEOUT_MS = 5000;

export interface LoadConfigOptions {
  /** 会话共享的 worker 池（backend 不自己 spawn）。 */
  pool: ScriptWorkerPool;
  /** 诊断日志出口；缺省则只进返回值的 diagnostics 语义不变、set_name 失败静默程度同旧版无 GUI 时。 */
  pipeline?: LogPipeline;
  /** set_name 单条 invoke 超时（毫秒），默认 5000（BD-O1）。 */
  setNameTimeoutMs?: number;
}

/**
 * 加载并整合配置文件：解析 + include 合并后，对每个 item 按树文档顺序执行
 * set_name（如配置定义）并应用其字段改写。
 *
 * @throws ConfigError 解析/校验/include 硬错误（parseXmlConfig 原样透传）。
 */
export async function loadConfig(
  configPath: string,
  options: LoadConfigOptions,
): Promise<ParsedConfig> {
  const config = await parseXmlConfig(configPath);
  const setName = config.gui.setName;
  if (setName === undefined) {
    return config;
  }
  const workDir = resolveWorkDir(config) ?? config.dir;
  const timeoutMs = options.setNameTimeoutMs ?? DEFAULT_SET_NAME_TIMEOUT_MS;
  // 逐条 await：ops 应用顺序 = invoke 完成顺序 = 树文档顺序。
  for (const item of flattenTreeItems(config.tree)) {
    let result: ScriptResult;
    try {
      result = await options.pool.invoke(
        {
          invocation_id: randomUUID(),
          entry_kind: "set_name",
          filename: setName.filename,
          source: setName.source,
          timeout_ms: timeoutMs,
          context: {
            work_dir: workDir,
            configure_file: setName.filename,
            item_data: item,
          },
        },
        { timeoutMs },
      );
    } catch (err) {
      // invoke 级失败（WORKER_TIMEOUT/WORKER_EXIT/...）：item 保留原值，加载继续
      // （main.js:1749-1757 的"记错误后继续"语义 + BD-O1 硬超时）。
      void options.pipeline?.error(
        `set_name failed for item "${item.name}": ${formatUnknownError(err)}`,
        "GUI EVENT",
      );
      continue;
    }
    // error outcome 也回传部分修改 ops（BD-S3），与旧版活引用语义一致，先应用再记诊断。
    for (const op of result.ops ?? []) {
      if (
        op.op === "set_fields" &&
        op.target === "item_data" &&
        typeof op.fields === "object" &&
        op.fields !== null
      ) {
        applyItemFields(item, op.fields as Record<string, unknown>);
      }
    }
    if (result.outcome === "error") {
      void options.pipeline?.error(
        `set_name error for item "${item.name}": ${result.error?.message ?? "unknown error"}`,
        "GUI EVENT",
      );
    }
  }
  return config;
}

/** 把 set_fields ops 应用到 item（value===null → 删键，对齐 worker diffFields 语义）。 */
function applyItemFields(item: TreeItem, fields: Record<string, unknown>): void {
  const target = item as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}
