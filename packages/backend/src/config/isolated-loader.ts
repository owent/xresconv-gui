import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessScope } from "@xresconv/guardian";
import { FrameDecoder } from "@xresconv/ipc";
import { ConfigError } from "./check-well-formed.ts";
import type { ParsedConfig, TreeNode } from "./model.ts";

const BUNDLED = fileURLToPath(new URL("./config-worker.mjs", import.meta.url));
const SOURCE = fileURLToPath(new URL("./config-worker.ts", import.meta.url));
export const CONFIG_PARSE_TIMEOUT_MS = 30_000;

export interface IsolatedParseOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Internal test seam for a stalled/crashed helper. */
  workerPath?: string;
}

/** JSON framing loses null prototypes; restore the model's dictionary semantics. */
function restoreDictionaries(config: ParsedConfig): ParsedConfig {
  config.gui.scripts = Object.assign(Object.create(null), config.gui.scripts);
  const pending: TreeNode[] = [...config.tree];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.kind === "category") {
      for (const child of node.children) pending.push(child);
    } else if (node?.kind === "item")
      node.item.schemeData = Object.assign(Object.create(null), node.item.schemeData);
  }
  return config;
}

/** External deadline stays responsive even while XML validation/parsing loops in the helper. */
export async function parseXmlConfigIsolated(
  file: string,
  options: IsolatedParseOptions = {},
): Promise<ParsedConfig> {
  const timeoutMs = options.timeoutMs ?? CONFIG_PARSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new RangeError("invalid configuration parse timeout");
  if (options.signal?.aborted)
    throw new ConfigError("CONFIG_CANCELLED", "configuration load cancelled");
  const scope = createProcessScope({ name: "config-parser" });
  let child: ReturnType<typeof spawn> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  let result: ParsedConfig | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = await new Promise<ParsedConfig>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, config?: ParsedConfig) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (config) resolve(config);
      };
      timer = setTimeout(
        () =>
          finish(
            new ConfigError("CONFIG_TIMEOUT", `configuration parse exceeded ${timeoutMs}ms`, {
              path: file,
            }),
          ),
        timeoutMs,
      );
      abort = () =>
        finish(new ConfigError("CONFIG_CANCELLED", "configuration load cancelled", { path: file }));
      options.signal?.addEventListener("abort", abort, { once: true });
      child = spawn(
        process.execPath,
        [
          "--max-old-space-size=1024",
          options.workerPath ?? (existsSync(BUNDLED) ? BUNDLED : SOURCE),
          path.resolve(file),
        ],
        scope.decorateSpawnOptions({ stdio: ["ignore", "pipe", "pipe"] }),
      );
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4096);
      });
      child.once("error", (error) => finish(error));
      child.once("close", (code) =>
        finish(
          new ConfigError(
            "CONFIG_WORKER_EXIT",
            `configuration helper exited (${code}): ${stderr}`,
            { path: file },
          ),
        ),
      );
      scope.register(child);
      const decoder = new FrameDecoder(
        (value) => {
          const reply = value as {
            config?: ParsedConfig;
            error?: { code: string; message: string; details?: Record<string, unknown> };
          } | null;
          if (
            reply?.error &&
            typeof reply.error.code === "string" &&
            typeof reply.error.message === "string"
          )
            finish(new ConfigError(reply.error.code, reply.error.message, reply.error.details));
          else if (
            reply?.config?.path === path.resolve(file) &&
            Array.isArray(reply.config.tree) &&
            reply.config.gui?.scripts
          )
            finish(undefined, reply.config);
          else
            finish(new ConfigError("CONFIG_WORKER_PROTOCOL", "invalid configuration helper reply"));
        },
        (error) => finish(error),
      );
      child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
      // An abort arriving during spawn/registration must not be lost.
      if (options.signal?.aborted) abort();
    });
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
  }
  try {
    const report = await scope.terminate(0);
    if (report.unreapedPids.length > 0)
      throw new ConfigError("CONFIG_CLEANUP_FAILED", "configuration helper cleanup unconfirmed", {
        pids: report.unreapedPids,
      });
  } finally {
    await scope.dispose();
  }
  if (failed) throw failure;
  if (!result) throw new ConfigError("CONFIG_WORKER_PROTOCOL", "missing configuration candidate");
  return restoreDictionaries(result);
}
