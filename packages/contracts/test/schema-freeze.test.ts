// P2-12 接口冻结守卫：schema/ 是唯一事实源（D6），src/generated/ 由
// scripts/build-types.mjs 生成。冻结规则（记录于 docs/plan/records/P2-12.md）：
// - protocol_version 冻结为 1；破坏既有字段语义的改动必须 bump 并写迁移说明；
// - 本测试断言冻结集合（schema 文件清单）、重新生成零漂移、版本常量不变。
// - 扩展记录：P4-02 按冻结规则 2 新增 backend-rpc（业务 RPC payload），并给
//   envelope kind 枚举追加 rpc/rpc_result（docs/plan/records/P4-02.md）；
//   P4-04a 给 backend-rpc method 枚举追加 updateSettings/preview、错误码词表
//   补 XRESLOADER_NOT_FOUND（docs/plan/records/P4-04a.md）；
//   P4-04b 给 backend-rpc params 描述补 updateSettings fields 的 parallelism
//   （number, 1..16，会话级，不进 overrides；纯文本变更，docs/plan/records/P4-04b.md）；
//   P4-05a 给 backend-rpc method 枚举追加 setHookEnabled/setCustomSelectors/
//   invokeCustomButton、params 描述补三方法参数形状（docs/plan/records/P4-05a.md）。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** 冻结的 schema 集合（P2-12；P4-02 追加 backend-rpc）；增删文件必须同步更新本清单与冻结记录。 */
const FROZEN_SCHEMAS = [
  "backend-rpc",
  "envelope",
  "error-info",
  "handshake",
  "node-health",
  "script-invoke",
  "script-result",
];

describe("contract freeze (P2-12)", () => {
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
