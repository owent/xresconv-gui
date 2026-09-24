/**
 * 选择与资格判定（P3-04 余量）。
 *
 * 三块旧行为的后端移植：
 * - 矩阵资格：item.tags/classes（item 的 tag/class 属性空白切分，main.js:1624-1631）
 *   对 output_type 矩阵规则的 tags/classes 交集判定（check_matrix_rule，main.js:1012-1032；
 *   tags 分支旧版 ReferenceError 缺陷已由 BD-M1 修复，两者统一走 matchClasses）。
 * - 选择器资格：custom_selector_on_click 的 by_schemes/by_sheets 匹配（main.js:333-414），
 *   选择器定义来自外部自定义选择器文件，字段名保留 snake_case（by_schemes/by_sheets）。
 * - 三态选择：fancytree selectMode 3 的级联勾选属 UI 层职责（P0-08 §3.1，
 *   main.js:1949-1953、511）；本层只消费显式勾选列表。folder 节点不产生任务，
 *   由 {@link flattenTreeItems} 展开树时只取 item 叶子。
 */

import {
  buildMatchStringRule,
  type MatchRuleFn,
  matchClasses,
  matchStringRule,
  type RuleDiagnosticLogger,
} from "@xresconv/compat-service";
import type { OutputMatrixRule, TreeItem, TreeNode } from "../config/model.ts";

/**
 * 矩阵规则对 item 的资格判定（main.js:1012-1032）。
 * 规则 tags 非空 → 须与 item.tags 有交集；classes 同理；两者均空 → 通过。
 * tags 复用 matchClasses（BD-M1：旧版 tags 分支必抛 ReferenceError，tag 限定实际不可用）。
 */
export function matrixRuleMatchesItem(rule: OutputMatrixRule, item: TreeItem): boolean {
  if (rule.tags.length > 0 && !matchClasses(rule.tags, item.tags)) {
    return false;
  }
  if (rule.classes.length > 0 && !matchClasses(rule.classes, item.classes)) {
    return false;
  }
  return true;
}

/**
 * 矩阵模式判定（main.js:1333-1338）：规则多于一条，或唯一规则带 tags/classes
 * 限定时走矩阵；否则单类型模式（旧版对应下拉框未选中"自定义输出类型"）。
 * plan-builder（规则回退）、tree-state（加载期资格）与会话（overrides 矩阵
 * 变更后的资格重估，P4-04a）共用同一规则，禁止分叉。
 */
export function isMatrixMode(matrix: readonly OutputMatrixRule[]): boolean {
  const first = matrix[0];
  return (
    matrix.length > 1 ||
    (matrix.length === 1 &&
      first !== undefined &&
      (first.tags.length > 0 || first.classes.length > 0))
  );
}

/**
 * DFS 文档顺序展开树，只取 item 叶子；category/folder 节点不产生任务
 * （main.js:2004-2008 只收集 `conv_data.items[node.key]` 存在的节点）。
 */
export function flattenTreeItems(nodes: TreeNode[]): TreeItem[] {
  const items: TreeItem[] = [];
  const walk = (list: TreeNode[]): void => {
    for (const node of list) {
      if (node.kind === "item") {
        items.push(node.item);
      } else {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return items;
}

/** by_schemes 规则（main.js:339-364）：file 必中且 scheme 缺省或中。字段名对齐外部选择器文件格式。 */
export interface SelectorSchemeRule {
  file?: string;
  scheme?: string;
}

/** by_sheets 规则（main.js:375-407）：DataSource 按 `|` 切分，第 1 段 file、第 2 段 sheet，sheet 缺省任意命中。 */
export interface SelectorSheetRule {
  file?: string;
  sheet?: string;
}

/** 自定义选择器定义（外部文件；仅资格判定所需字段，action/default_selected 属 UI/脚本层）。 */
export interface CustomSelectorRules {
  name?: string;
  by_schemes?: SelectorSchemeRule[];
  by_sheets?: SelectorSheetRule[];
}

interface CompiledSchemeRule {
  fileFn: MatchRuleFn;
  schemeFn: MatchRuleFn | undefined;
  hasScheme: boolean;
}

interface CompiledSheetRule {
  fileFn: MatchRuleFn;
  sheetFn: MatchRuleFn | undefined;
  hasSheet: boolean;
}

/**
 * 选择器资格判定（main.js:333-414 的匹配部分；ft_node 勾选与 default_selected
 * 联动属 UI 层）。返回按输入顺序命中的 item 列表，每个 item 至多命中一次。
 *
 * 分流（else-if 互斥，main.js:338/365）：
 * - `item.file && item.scheme` → 只参与 by_schemes：file 规则必中，
 *   scheme 规则缺省或中（main.js:353-360），首条命中即 break（main.js:360-363）；
 * - 否则 `schemeData.DataSource` 存在 → 只参与 by_sheets：每个 DataSource 值按 `|`
 *   切分（main.js:366-373），file=第 1 段、sheet=第 2 段（缺第二段时 sheet 匹配输入为
 *   undefined），sheet 规则缺省任意命中（main.js:398-400），任一 DataSource 命中即
 *   整 item 命中并跳出全部规则循环（has_matched，main.js:374-377、401-405）。
 *
 * 规则编译一次性完成（旧版 file_fn/scheme_fn/sheet_fn 懒缓存，main.js:340-351、380-391，
 * 多次调用不重复编译；此处 upfront 编译，语义等价）。
 */
export function resolveSelectorItems(
  selector: CustomSelectorRules,
  items: TreeItem[],
  log?: RuleDiagnosticLogger,
): TreeItem[] {
  const schemeRules: CompiledSchemeRule[] = (selector.by_schemes ?? []).map((rule) => ({
    fileFn: buildMatchStringRule(rule.file, selector.name, log),
    schemeFn: rule.scheme ? buildMatchStringRule(rule.scheme, selector.name, log) : undefined,
    hasScheme: !!rule.scheme,
  }));
  const sheetRules: CompiledSheetRule[] = (selector.by_sheets ?? []).map((rule) => ({
    fileFn: buildMatchStringRule(rule.file, selector.name, log),
    sheetFn: rule.sheet ? buildMatchStringRule(rule.sheet, selector.name, log) : undefined,
    hasSheet: !!rule.sheet,
  }));

  const matched: TreeItem[] = [];
  for (const item of items) {
    if (item.file && item.scheme) {
      for (const rule of schemeRules) {
        if (
          matchStringRule(rule.fileFn, item.file) &&
          (!rule.hasScheme || matchStringRule(rule.schemeFn, item.scheme))
        ) {
          matched.push(item);
          break;
        }
      }
    } else if (item.schemeData.DataSource) {
      const dataSources = item.schemeData.DataSource.map((value) => value.split("|"));
      let hasMatched = false;
      for (const rule of sheetRules) {
        if (hasMatched) {
          break;
        }
        for (const source of dataSources) {
          if (
            matchStringRule(rule.fileFn, source[0]) &&
            (!rule.hasSheet || matchStringRule(rule.sheetFn, source[1]))
          ) {
            matched.push(item);
            hasMatched = true;
            break;
          }
        }
      }
    }
  }
  return matched;
}
