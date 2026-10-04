// 共享三态选择与模式匹配实现，后端和脚本镜像复用相同语义。

import { Minimatch, minimatch } from "minimatch";

/** Compiled matcher produced by {@link buildMatchStringRule}. */
export type MatchRuleFn = (input: string | undefined | null) => boolean;

/** 无效规则诊断通过注入回调交给调用方处理。 */
export type RuleDiagnosticLogger = (message: string | unknown) => void;

const noopLogger: RuleDiagnosticLogger = () => {};

/** 规则可为原始文本或已编译的 MatchRuleFn，原始文本首次使用时编译。 */
export function matchStringRule(
  rule: MatchRuleFn | string | undefined | null,
  input: string | undefined | null,
): boolean {
  if (!input && !rule) {
    return true;
  }
  if (!input || !rule) {
    return false;
  }
  const fn = typeof rule === "function" ? rule : buildMatchStringRule(rule);
  return !!fn(input);
}

/** 编译匹配器复用已编译 RegExp/Minimatch。规则支持完全匹配、regex: 与 glob:，编译失败记录诊断并回退到原始规则文本匹配。 */
export function buildMatchStringRule(
  rule: string | undefined | null,
  name?: string,
  log: RuleDiagnosticLogger = noopLogger,
): MatchRuleFn {
  if (!rule) {
    return (input) => !input;
  }

  try {
    const lower = rule.toLowerCase();
    if (lower.startsWith("regex:")) {
      const regexRule = new RegExp(rule.substring(6).trim());
      //正则按字符串输入求值，空输入按空串处理。

      return (input) => regexRule.test(input || "");
    }
    if (lower.startsWith("glob:")) {
      const globRule = new Minimatch(rule.substring(5).trim());
      //  calls glob_rule.match(input) directly; the port
      // coerces empty input to "" (never matches a glob) instead of throwing.
      return (input) => globRule.match(input ?? "");
    }
    // 输入与规则统一为字符串后进行完全匹配，规则保留首尾空白。
    // operands are strings here so `===` is identical.
    return (input) => input === rule;
  } catch (e) {
    // log then fall back to exact match on the original rule.
    if (name) {
      log(`${name} 的规则无效: ${rule}`);
    }
    log(e);
    return (input) => input === rule;
  }
}

/** Thin glob wrapper kept from the skeleton: minimatch default options. */
export function matchGlob(pattern: string, value: string): boolean {
  return minimatch(value, pattern);
}

/** 无效正则回退为原始模式文本的完全匹配。 */
export function matchRegex(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return value === pattern;
  }
}

/** 矩阵资格检查：class 或 tag 与条目对应集合有交集时通过。 */
export function matchClasses(ruleClasses: string[], itemClasses: string[]): boolean {
  return ruleClasses.some((x) => itemClasses.some((y) => x === y));
}

export * from "./tree-model.ts";
