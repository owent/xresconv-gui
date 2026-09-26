// Compatibility service: selector/string-rule matching primitives (P3-04 匹配原语).
//
// Ported from src/main.js (legacy renderer). Every semantic is anchored to the
// original line numbers; behaviour deltas are recorded as BD-M* entries in
// docs/plan/records/P3-04.md.

import { Minimatch, minimatch } from "minimatch";

/** Compiled matcher produced by {@link buildMatchStringRule}. */
export type MatchRuleFn = (input: string | undefined | null) => boolean;

/**
 * Diagnostic sink for invalid rules. Legacy behaviour wrote two error log
 * lines (`${name} 的规则无效: ${rule}` then the compile exception) via
 * logger_append_error_message (main.js:156-159); the port injects a callback
 * instead so callers decide where diagnostics go (BD-M3).
 */
export type RuleDiagnosticLogger = (message: string | unknown) => void;

const noopLogger: RuleDiagnosticLogger = () => {};

/**
 * main.js:119-129 (match_string_rule).
 *
 * Both empty → true; exactly one empty → false. `rule` may be either a raw
 * rule string or a compiled {@link MatchRuleFn} (legacy call sites pass the
 * lazily cached `*_fn` built by build_match_string_rule). Raw strings are
 * compiled on the spot via {@link buildMatchStringRule}.
 *
 * BD-M2: the legacy regex branch returned the match array / null; the port
 * coerces to boolean (truthiness semantics unchanged).
 */
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

/**
 * main.js:131-163 (build_match_string_rule).
 *
 * - Empty rule → matches only empty input (main.js:132-136).
 * - Prefix "regex:" / "glob:" (prefix check case-insensitive, main.js:139/144)
 *   → `new RegExp(rest.trim())` / `new Minimatch(rest.trim())` with minimatch
 *   default options (main.js:140-146).
 * - Otherwise exact match against the **untrimmed** rule (main.js:148-152).
 * - Compile exception → diagnostic via `log` and **fallback to exact match
 *   against the full original rule string** (main.js:155-162).
 *
 * Compilation happens once at build time; the returned closure reuses the
 * compiled RegExp/Minimatch (legacy lazy-cache semantics: callers cache the
 * built fn on scheme_rule.file_fn / sheet_rule.file_fn, main.js:340-351,
 * 380-391, so repeated calls never recompile).
 */
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
      // main.js:141-143: legacy `(input || "").match(regex_rule)`; test() is
      // the boolean equivalent (BD-M2).
      return (input) => regexRule.test(input || "");
    }
    if (lower.startsWith("glob:")) {
      const globRule = new Minimatch(rule.substring(5).trim());
      // main.js:147-149 calls glob_rule.match(input) directly; the port
      // coerces empty input to "" (never matches a glob) instead of throwing.
      return (input) => globRule.match(input ?? "");
    }
    // main.js:150-153: exact match, rule not trimmed. Legacy used `==`; both
    // operands are strings here so `===` is identical.
    return (input) => input === rule;
  } catch (e) {
    // main.js:155-162: log then fall back to exact match on the original rule.
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

/**
 * Thin regex wrapper kept from the skeleton. Mirrors the legacy fallback:
 * an invalid regex degrades to exact match against the original pattern
 * string (main.js:155-162).
 */
export function matchRegex(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return value === pattern;
  }
}

/**
 * main.js:1020-1028 (check_matrix_rule classes branch): any intersection
 * between rule classes and item classes passes.
 *
 * BD-M1: the legacy tags branch (main.js:1013-1019) referenced the undefined
 * free variable `output` and therefore always threw ReferenceError (P0-08
 * §1.4, defect B1). The port implements tags with the same intersection rule
 * as classes — call this function with tag arrays for tag matching.
 */
export function matchClasses(ruleClasses: string[], itemClasses: string[]): boolean {
  return ruleClasses.some((x) => itemClasses.some((y) => x === y));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({ ok: true, pid: process.pid })}\n`);
}

export * from "./tree-model.ts";
