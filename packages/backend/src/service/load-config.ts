/**
 * 配置加载编排：parseXmlConfig + set_name 整合。
 *
 * 每个 `<item>` 入树前同步执行一次 gui.set_name：
 * 上下文：work_dir（解析期相对化）、configure_file=set_name 所在文件、
 *   item_data 活引用（形状：snake_case scheme_data、含 id、ft_node 尚未赋值）、
 *   每 item 新建 data、alert_*、log_*（module "CONV EVENT"），
 *   无 require/resolve/reject、vm 无 timeout。
 * 单条异常 → catch 记 error（module "GUI EVENT"）后加载继续。
 *
 * item id（ generate_id）：解析后即按树文档顺序从 1 赋值，先于
 * set_name 循环（ set_name 已可见 item_data.id）；每次加载重新从 1 开始
 * （reload 归零的语义由"每次 loadConfig 重新解析"自然保证）。
 *
 * 经 ScriptWorkerPool invoke（entry_kind "set_name"）执行，ops 应用顺序 =
 * invoke 完成顺序 = 树文档顺序（逐条 await）。差异（详见 docs/development/testing.md）：
 * ： set_name 无超时（死循环卡死加载）； invoke 带显式 timeoutMs
 *   （默认 {@link DEFAULT_SET_NAME_TIMEOUT_MS}），超时由 guardian 销毁并补员 worker，
 *   记诊断、item 保留原值、加载继续。
 * ：error outcome（脚本异常）仍应用 ops 中的部分修改——与活引用语义
 *   一致（ item_data 本体传入，异常前已改的字段保留）；invoke 级失败
 *   （WORKER_TIMEOUT 等）拿不到 ops，item 保留原值。
 */

import { randomUUID } from "node:crypto";
import type { ScriptResult } from "@xresconv/contracts";
import type { ScriptWorkerPool } from "@xresconv/guardian";
import { parseXmlConfigIsolated } from "../config/isolated-loader.ts";
import { resolveWorkDir } from "../config/loader.ts";
import type { ParsedConfig } from "../config/model.ts";
import { flattenTreeItems } from "../domain/selection.ts";
import { formatUnknownError } from "./format.ts";
import type { LogPipeline } from "./log-pipeline.ts";
import { applyLegacyItemFields, toLegacyItemData } from "./tree-state.ts";

/** set_name 单条 invoke 的默认硬超时(无超时)。 */
export const DEFAULT_SET_NAME_TIMEOUT_MS = 5000;

export interface LoadConfigOptions {
  /** 会话共享的 worker 池（backend 不自己 spawn）。 */
  pool: ScriptWorkerPool;
  /** 诊断日志出口；缺省则只进返回值的 diagnostics 语义不变、set_name 失败静默程度同无 GUI 时。 */
  pipeline?: LogPipeline;
  /** set_name 单条 invoke 超时（毫秒），默认 5000。 */
  setNameTimeoutMs?: number;
  signal?: AbortSignal;
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
  const config = await parseXmlConfigIsolated(configPath, { signal: options.signal });
  // item id：树文档序从 1 赋值，先于 set_name（其中可见 id）。
  let nextId = 1;
  for (const item of flattenTreeItems(config.tree)) {
    item.id = nextId++;
  }
  const setName = config.gui.setName;
  if (setName === undefined) {
    return config;
  }
  const workDir = resolveWorkDir(config) ?? config.dir;
  const timeoutMs = options.setNameTimeoutMs ?? DEFAULT_SET_NAME_TIMEOUT_MS;
  // 逐条 await：ops 应用顺序 = invoke 完成顺序 = 树文档顺序。
  for (const item of flattenTreeItems(config.tree)) {
    options.signal?.throwIfAborted();
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
            // 形状：scheme_data 等 snake_case 字段 + id；ft_node 此时尚未赋值
            // （树节点创建于 set_name 之后)，以 null 占位。
            item_data: { ...toLegacyItemData(item), ft_node: null },
          },
        },
        { timeoutMs },
      );
    } catch (err) {
      // invoke 级失败（WORKER_TIMEOUT/WORKER_EXIT/.)：item 保留原值，加载继续
      // （ 的"记错误后继续"语义 +  硬超时）。
      void options.pipeline?.error(
        `set_name failed for item "${item.name}": ${formatUnknownError(err)}`,
        "GUI EVENT",
      );
      continue;
    }
    // error outcome 也回传部分修改 ops，与活引用语义一致，先应用再记诊断。
    for (const op of result.ops ?? []) {
      if (
        op.op === "set_fields" &&
        op.target === "item_data" &&
        typeof op.fields === "object" &&
        op.fields !== null
      ) {
        applyLegacyItemFields(item, op.fields as Record<string, unknown>);
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
