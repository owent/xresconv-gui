import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { glibcExclusion } from "../src/assemble.ts";
import { loadTargets } from "../src/load.ts";

/**
 * musl 变体剔除（P5-06）：glibc（gnu triple）Linux 目标的闭包不携带
 * musl 专用原生模块——linuxdeploy 按 glibc 解析 musl ELF 会失败
 * （"Could not find dependency: libc.musl-x86_64.so.1"，WSL Debian 13 实测）。
 */

const tmp = mkdtempSync(path.join(tmpdir(), "xresconv-closure-filter-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("glibcExclusion（P5-06 musl 变体剔除）", () => {
  it("仅 gnu triple 的 Linux 目标启用排除", () => {
    const targets = loadTargets();
    const linuxGnu = targets.targets.find(
      (t) => t.os === "linux" && t.arch === "x86_64" && t.variant === "bootstrap",
    );
    expect(linuxGnu).toBeDefined();
    expect(glibcExclusion(linuxGnu as never)).not.toBeNull();
    const windows = targets.targets.find((t) => t.os === "windows");
    expect(glibcExclusion(windows as never)).toBeNull();
  });

  it("cpSync 过滤：musl 目录被剔除，glibc 变体保留", () => {
    const src = path.join(tmp, "koffi-linux-x64");
    const dest = path.join(tmp, "copied");
    mkdirSync(path.join(src, "linux_x64"), { recursive: true });
    mkdirSync(path.join(src, "musl_x64"), { recursive: true });
    writeFileSync(path.join(src, "linux_x64", "koffi.node"), "glibc");
    writeFileSync(path.join(src, "musl_x64", "koffi.node"), "musl");
    writeFileSync(path.join(src, "index.js"), "js");
    const exclusion = /(^|[/\\])[^/\\]*musl[^/\\]*([/\\]|$)/;
    cpSync(src, dest, { recursive: true, filter: (p) => !exclusion.test(p) });
    expect(existsSync(path.join(dest, "linux_x64", "koffi.node"))).toBe(true);
    expect(existsSync(path.join(dest, "musl_x64"))).toBe(false);
    expect(existsSync(path.join(dest, "index.js"))).toBe(true);
  });
});
