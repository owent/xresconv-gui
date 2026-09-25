/**
 * 自定义选择器/按钮定义加载与校验（P4-05a）。
 *
 * 对齐旧版两段逻辑：
 * - 文件读取（setup.js:54-105）：UTF-8 读 + JSON.parse；顶层允许数组或单对象
 *   展平（setup.js:70-78）；逐文件 try/catch，失败以错误字符串入列（setup.js:87-105）。
 * - 渲染侧校验（main.js:752-767）：字符串项直接作错误条目；无 name /
 *   by_schemes+by_sheets+action 全空 → "规则无效"错误（module "CUSTOM SELECTOR"）。
 *
 * BD-O19（缺陷修复）：旧版非数组 action 走 else 分支 `actions.push(action_type)`
 * （main.js:805-807），引用了 if 分支 for-of 的块级变量，实际压入 undefined，
 * 字符串形式的 action 永远等效无动作。新版把字符串 action 归一化为单元素数组。
 * 既有样本（docs/custom-selector.json）均为数组形式，该修复不改变既有样本行为。
 */

import { readFileSync } from "node:fs";
import type { CustomSelectorRules } from "../domain/selection.ts";
import { formatUnknownError } from "./format.ts";

/** 校验通过的自定义选择器/按钮定义（字段名保留外部文件格式 snake_case）。 */
export interface CustomSelectorDef extends CustomSelectorRules {
  name: string;
  /** 动作链（BD-O19：字符串已归一化为单元素数组；元素可非字符串，派发时按 no-op）。 */
  action?: unknown[];
  /** 缺省 false（main.js:826-828 仅 truthy 时建按钮后立即执行一次 force=true）。 */
  default_selected?: unknown;
  /** 样式原值（白名单校验旧版恒真缺陷 B6 不复活；语义映射归 UI 层）。 */
  style?: unknown;
}

/** 一个文件条目的解析结果：合法定义或错误条目（旧版字符串项语义）。 */
export type CustomSelectorEntry =
  | { ok: true; def: CustomSelectorDef }
  | { ok: false; error: string };

/** 快照/视图形态（UI 渲染用；JSON 安全）。 */
export type CustomSelectorView =
  | {
      name: string;
      hasAction: boolean;
      defaultSelected: boolean;
      style: string | null;
    }
  | { name: null; error: string };

/** 顶层数组或单对象展平（setup.js:70-78）。非数组/非对象顶层视为单对象条目走校验。 */
export function flattenSelectorDocument(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function asRuleList(value: unknown): { file?: string; scheme?: string; sheet?: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  // 非对象规则项旧版会在匹配阶段抛 TypeError；新版校验期丢弃（不致命的脏数据）。
  return value.filter(
    (rule): rule is { file?: string; scheme?: string; sheet?: string } =>
      typeof rule === "object" && rule !== null,
  );
}

/** 单条目校验与归一化（main.js:752-767）。返回定义或错误条目。 */
export function validateSelectorEntry(raw: unknown): CustomSelectorEntry {
  if (typeof raw === "string") {
    // 旧版：文件级失败以错误字符串入列，渲染侧原样作为错误显示。
    return { ok: false, error: raw };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "自定义选择器条目必须是对象" };
  }
  const source = raw as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name : "";
  if (name === "") {
    return { ok: false, error: "自定义选择器必须配置名称" };
  }
  const bySchemes = asRuleList(source.by_schemes);
  const bySheets = asRuleList(source.by_sheets);
  // BD-O19：字符串 action 归一化为单元素数组；非数组非字符串按无动作。
  const rawAction = source.action;
  const action =
    typeof rawAction === "string" ? [rawAction] : Array.isArray(rawAction) ? rawAction : undefined;
  // 校验用旧版同口径：(action || []).length —— 字符串 action 的 length 是字符串长度。
  const actionLen =
    typeof rawAction === "string"
      ? rawAction.length
      : Array.isArray(rawAction)
        ? rawAction.length
        : 0;
  if (bySchemes.length <= 0 && bySheets.length <= 0 && actionLen <= 0) {
    return { ok: false, error: `自定义选择器 ${name} 的规则无效` };
  }
  const def: CustomSelectorDef = { name };
  if (bySchemes.length > 0) {
    def.by_schemes = bySchemes;
  }
  if (bySheets.length > 0) {
    def.by_sheets = bySheets;
  }
  if (action !== undefined && action.length > 0) {
    def.action = action;
  }
  if (source.default_selected !== undefined) {
    def.default_selected = source.default_selected;
  }
  if (source.style !== undefined) {
    def.style = source.style;
  }
  return { ok: true, def };
}

/**
 * 读取并校验一组选择器文件（逐文件 try/catch；文件失败成为错误条目，不中断其余）。
 * 错误文本不含文件内容，只含路径与解析错误（诊断不回显疑似密钥，PK01 口径）。
 */
export function loadCustomSelectorFiles(files: readonly string[]): CustomSelectorEntry[] {
  const entries: CustomSelectorEntry[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      entries.push({
        ok: false,
        error: `读取自定义选择器文件失败 ${file}: ${formatUnknownError(err)}`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      entries.push({
        ok: false,
        error: `解析自定义选择器文件失败 ${file}: ${formatUnknownError(err)}`,
      });
      continue;
    }
    for (const raw of flattenSelectorDocument(parsed)) {
      entries.push(validateSelectorEntry(raw));
    }
  }
  return entries;
}

/** 视图投影（快照用）。 */
export function selectorViews(entries: readonly CustomSelectorEntry[]): CustomSelectorView[] {
  return entries.map((entry) => {
    if (!entry.ok) {
      return { name: null, error: entry.error };
    }
    const style = typeof entry.def.style === "string" ? entry.def.style : null;
    return {
      name: entry.def.name,
      hasAction: (entry.def.action ?? []).length > 0,
      defaultSelected: entry.def.default_selected === true,
      style: style === "" ? null : style,
    };
  });
}

/** 按钮动作（main.js:663-714 分发结果）。 */
export type CustomButtonAction =
  | { kind: "reload" }
  | { kind: "select_all" }
  | { kind: "unselect_all" }
  | { kind: "script"; name: string }
  | { kind: "noop"; raw: unknown };

/**
 * 解析单个动作（main.js:663-714）：非字符串 → no-op；trim 后小写比较
 * reload/select_all/unselect_all；/script\s*:(.*)/i 提取脚本名。
 *
 * BD-O20（B3 缺陷修复）：旧版剥离引号用 `substr(0, len-2)`（main.js:708-710），
 * 保留前引号又砍尾两字符，带引号脚本名永远失配。新版正确剥离成对引号；
 * 不带引号的名字行为不变。
 */
export function parseButtonAction(raw: unknown): CustomButtonAction {
  if (typeof raw !== "string") {
    return { kind: "noop", raw };
  }
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered === "reload") {
    return { kind: "reload" };
  }
  if (lowered === "select_all") {
    return { kind: "select_all" };
  }
  if (lowered === "unselect_all") {
    return { kind: "unselect_all" };
  }
  const scriptMatch = /script\s*:(.*)/i.exec(trimmed);
  if (scriptMatch !== null) {
    let name = (scriptMatch[1] ?? "").trim();
    if (
      name.length >= 2 &&
      name[0] === name[name.length - 1] &&
      (name[0] === '"' || name[0] === "'")
    ) {
      // BD-O20：成对引号整体剥离（旧版 B3 缺陷不复活）。
      name = name.slice(1, -1);
    }
    return { kind: "script", name };
  }
  return { kind: "noop", raw };
}
