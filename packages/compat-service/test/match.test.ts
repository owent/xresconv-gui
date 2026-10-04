import { describe, expect, it } from "vitest";
import {
  buildMatchStringRule,
  matchClasses,
  matchGlob,
  matchRegex,
  matchStringRule,
} from "../src/index.ts";

describe("matchStringRule", () => {
  it("both empty → true; exactly one empty → false", () => {
    expect(matchStringRule(undefined, undefined)).toBe(true);
    expect(matchStringRule(null, null)).toBe(true);
    expect(matchStringRule("", "")).toBe(true);
    expect(matchStringRule("x", undefined)).toBe(false);
    expect(matchStringRule("x", null)).toBe(false);
    expect(matchStringRule("x", "")).toBe(false);
    expect(matchStringRule(undefined, "x")).toBe(false);
    expect(matchStringRule(null, "x")).toBe(false);
    expect(matchStringRule("", "x")).toBe(false);
  });

  it("accepts a compiled MatchRuleFn (legacy *_fn call sites)", () => {
    const fn = buildMatchStringRule("regex:\\.bin$");
    expect(matchStringRule(fn, "role.bin")).toBe(true);
    expect(matchStringRule(fn, "role.json")).toBe(false);
    // A compiled fn is always truthy → empty input still fails.
    expect(matchStringRule(fn, undefined)).toBe(false);
  });

  it("compiles raw rule strings on the spot", () => {
    expect(matchStringRule("exact-name", "exact-name")).toBe(true);
    expect(matchStringRule("exact-name", "other")).toBe(false);
  });
});

describe("buildMatchStringRule empty rule", () => {
  it("matches only empty input", () => {
    const fn = buildMatchStringRule(undefined);
    expect(fn(undefined)).toBe(true);
    expect(fn(null)).toBe(true);
    expect(fn("")).toBe(true);
    expect(fn("x")).toBe(false);
  });
});

describe("buildMatchStringRule regex branch", () => {
  it("matches and rejects per the compiled RegExp", () => {
    const fn = buildMatchStringRule("regex:\\.bin$");
    expect(fn("role_cfg.bin")).toBe(true);
    expect(fn("role_cfg.json")).toBe(false);
  });

  it("prefix check is case-insensitive", () => {
    const fn = buildMatchStringRule("REGEX:\\.bin$");
    expect(fn("role_cfg.bin")).toBe(true);
    expect(fn("role_cfg.json")).toBe(false);
  });

  it("rest is trimmed before compilation", () => {
    const fn = buildMatchStringRule("regex:  \\.bin$  ");
    expect(fn("role_cfg.bin")).toBe(true);
  });

  it("empty input is coerced to '' before matching", () => {
    expect(buildMatchStringRule("regex:^$")(undefined)).toBe(true);
    expect(buildMatchStringRule("regex:bin")(undefined)).toBe(false);
  });

  it("valid inline case-insensitive group (?i:..) works", () => {
    const fn = buildMatchStringRule("regex:(?i:\\.BIN)$");
    expect(fn("role_cfg.bin")).toBe(true);
  });
});

describe("buildMatchStringRule glob branch", () => {
  it("matches ** patterns with minimatch default options", () => {
    const fn = buildMatchStringRule("glob:**/*.xlsx");
    expect(fn("config/role.xlsx")).toBe(true);
    expect(fn("role.xlsx")).toBe(true);
    expect(fn("config/role.xlsm")).toBe(false);
  });

  it("prefix check is case-insensitive; rest is trimmed", () => {
    const fn = buildMatchStringRule("GLOB: *.xlsx ");
    expect(fn("role.xlsx")).toBe(true);
  });

  it("dotfiles: minimatch default (dot:false) — plain * does not match dotfile", () => {
    // U5 ( 附录 C) resolved as-is: minimatch 10.2.6 default options mean
    // a pattern without a leading dot segment never matches a dotfile path.
    expect(matchStringRule("glob:*.bin", ".role.bin")).toBe(false);
    expect(matchStringRule("glob:.*.bin", ".role.bin")).toBe(true);
  });
});

describe("buildMatchStringRule exact branch", () => {
  it("is case-sensitive", () => {
    const fn = buildMatchStringRule("Role");
    expect(fn("Role")).toBe(true);
    expect(fn("role")).toBe(false);
  });

  it("rule is NOT trimmed — surrounding spaces are significant", () => {
    const fn = buildMatchStringRule(" role ");
    expect(fn(" role ")).toBe(true);
    expect(fn("role")).toBe(false);
  });
});

describe("buildMatchStringRule invalid rule fallback", () => {
  it("invalid regex falls back to exact match on the FULL original rule string", () => {
    const diagnostics: unknown[] = [];
    // Bare (?i) is not valid JavaScript RegExp syntax.
    const fn = buildMatchStringRule("regex:(?i)abc", "sel", (m) => diagnostics.push(m));
    expect(fn("regex:(?i)abc")).toBe(true);
    expect(fn("abc")).toBe(false);
    expect(fn("ABC")).toBe(false);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toBe("sel 的规则无效: regex:(?i)abc");
    expect(diagnostics[1]).toBeInstanceOf(SyntaxError);
  });

  it("omitted name logs only the exception", () => {
    const diagnostics: unknown[] = [];
    buildMatchStringRule("regex:(", undefined, (m) => diagnostics.push(m));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toBeInstanceOf(SyntaxError);
  });

  it("minimatch v10 is lenient: malformed braces compile and match literally", () => {
    // new Minimatch("a{") does NOT throw, so the glob
    // 该 glob 模式有效，按 minimatch 的实际结果断言。
    // literal text. The try/catch fallback therefore only fires for regex.
    const diagnostics: unknown[] = [];
    const fn = buildMatchStringRule("glob:a{", undefined, (m) => diagnostics.push(m));
    expect(fn("a{")).toBe(true);
    expect(fn("a")).toBe(false);
    expect(diagnostics).toHaveLength(0);
  });
});

describe("buildMatchStringRule compile-once semantics", () => {
  it("reusing the built fn does not recompile (diagnostics fire only at build)", () => {
    const diagnostics: unknown[] = [];
    const fn = buildMatchStringRule("regex:(", undefined, (m) => diagnostics.push(m));
    fn("regex:(");
    fn("regex:(");
    expect(diagnostics).toHaveLength(1);
  });
});

describe("matchGlob / matchRegex thin wrappers", () => {
  it("matchGlob uses minimatch semantics", () => {
    expect(matchGlob("*.bin", "role_cfg.bin")).toBe(true);
    expect(matchGlob("*.bin", "role_cfg.json")).toBe(false);
  });

  it("matchRegex matches valid regex", () => {
    expect(matchRegex("\\.bin$", "role_cfg.bin")).toBe(true);
    expect(matchRegex("\\.bin$", "role_cfg.json")).toBe(false);
    expect(matchRegex("(?i:\\.BIN)$", "role_cfg.bin")).toBe(true);
  });

  it("matchRegex falls back to exact match on invalid regex", () => {
    expect(matchRegex("(", "(")).toBe(true);
    expect(matchRegex("(", "anything-else")).toBe(false);
  });
});

describe("matchClasses (tags fixed per )", () => {
  it("any intersection passes", () => {
    expect(matchClasses(["a", "b"], ["c", "b"])).toBe(true);
    expect(matchClasses(["a"], ["a"])).toBe(true);
  });

  it("no intersection fails", () => {
    expect(matchClasses(["a"], ["b", "c"])).toBe(false);
  });

  it("empty rule or empty item classes never intersect", () => {
    expect(matchClasses([], [])).toBe(false);
    expect(matchClasses([], ["a"])).toBe(false);
    expect(matchClasses(["a"], [])).toBe(false);
  });

  it("comparison is exact (case-sensitive, no trimming)", () => {
    expect(matchClasses(["A"], ["a"])).toBe(false);
    expect(matchClasses(["a "], ["a"])).toBe(false);
  });
});
