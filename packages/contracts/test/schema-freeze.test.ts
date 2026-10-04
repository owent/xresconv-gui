// Schema 是唯一协议事实源；生成类型不得漂移，破坏字段语义需升级协议版本。

//   envelope kind 枚举追加 rpc/rpc_result（docs/development/testing.md）；
//    给 backend-rpc method 枚举追加 updateSettings/preview、错误码词表
//   补 XRESLOADER_NOT_FOUND（docs/development/testing.md）；
//    给 backend-rpc params 描述补 updateSettings fields 的 parallelism
//   （number，1..16，会话级，不进 overrides；纯文本变更，docs/development/testing.md）；
//    给 backend-rpc method 枚举追加 setHookEnabled/setCustomSelectors/
//   invokeCustomButton、params 描述补三方法参数形状（docs/development/testing.md）；
//    给 backend-rpc method 枚举追加 checkJava（java -version 探测，
//   conv_env_check 恢复）
//    给 backend-rpc method 枚举追加 getLogs、params 描述补 {limit:
//   integer 1..1000}（日志游标窗口，docs/development/testing.md）。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** 冻结的 schema 集合(追加 backend-rpc）；增删文件必须同步更新本清单与冻结记录。 */
const FROZEN_SCHEMAS = [
  "backend-rpc",
  "envelope",
  "error-info",
  "handshake",
  "node-health",
  "script-invoke",
  "script-result",
];

describe("contract freeze", () => {
  it("protocol_version 冻结为 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("schema 集合与冻结清单一一对应", () => {
    const onDisk = readdirSync(join(root, "schema"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(onDisk).toEqual([...FROZEN_SCHEMAS].sort());
    const generated = readdirSync(join(root, "src", "generated"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    expect(generated).toEqual([...FROZEN_SCHEMAS].sort());
  });

  it.each(FROZEN_SCHEMAS)("schema %s 重新生成零漂移", async (name) => {
    const schema = JSON.parse(readFileSync(join(root, "schema", `${name}.json`), "utf8"));
    const regenerated = await compile(schema, schema.title ?? name, {
      bannerComment:
        "/* eslint-disable */\n// Generated from packages/contracts/schema/*.json. Do not edit.",
      strictIndexSignatures: true,
    });
    const committed = readFileSync(join(root, "src", "generated", `${name}.ts`), "utf8");
    expect(regenerated).toBe(committed);
  });
});
