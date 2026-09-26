/**
 * SelectionRuleService（P2-08/P3-04 整合）：选择器资格判定经隔离 matcher
 * 求值（MatcherService），灾难性 regex 不阻塞 backend 事件循环/日志服务。
 *
 * 语义与 domain/selection.ts 的 resolveSelectorItems 逐点一致（else-if 互斥、
 * 首条命中 break、DataSource `|` 切分、sheet 缺段按空串求值），只是求值改为
 * 按规则批量 round-trip：每条规则至多两轮批量（file 轮 → 条件 scheme/sheet
 * 轮），结果与逐项短路的旧版等价（匹配谓词是纯函数，只求值次数不同）。
 *
 * BD-M4：隔离域求值超时 → 该规则 fail-closed（不匹配任何输入）+ 诊断；
 * 旧版等价场景是渲染进程白屏卡死。
 */

import type { TreeItem } from "../config/model.ts";
import type {
  CustomSelectorRules,
  SelectorSchemeRule,
  SelectorSheetRule,
} from "../domain/selection.ts";
import { type MatcherService, MatcherTimeoutError } from "./matcher-service.ts";

export interface IsolatedSelectorOptions {
  /** 诊断出口（超时 fail-closed、worker 死亡等）。 */
  log?: (message: string) => void;
}

/** 逐条规则批量求值；超时 fail-closed（BD-M4），结构性失败上抛。 */
async function evalRule(
  matcher: MatcherService,
  rule: string | undefined,
  inputs: readonly string[],
  log?: (message: string) => void,
): Promise<boolean[]> {
  if (rule === undefined) {
    // 缺省规则 = 空规则语义（buildMatchStringRule(undefined)）：只中空输入。
    return inputs.map((input) => input.length === 0);
  }
  try {
    return await matcher.matchBatch(rule, inputs);
  } catch (err) {
    if (err instanceof MatcherTimeoutError) {
      log?.(`matcher timeout, rule treated as matching nothing (BD-M4): ${rule.slice(0, 80)}`);
      return inputs.map(() => false);
    }
    throw err;
  }
}

/** by_schemes 求值（main.js:339-364 等价；file 必中、scheme 缺省或中、首条命中 break）。 */
async function evalSchemeRules(
  matcher: MatcherService,
  rules: readonly SelectorSchemeRule[],
  candidates: readonly TreeItem[],
  matched: Set<TreeItem>,
  log?: (message: string) => void,
): Promise<void> {
  for (const rule of rules) {
    const pending = candidates.filter((item) => !matched.has(item));
    if (pending.length === 0) {
      return;
    }
    const fileResults = await evalRule(
      matcher,
      rule.file,
      pending.map((item) => item.file ?? ""),
      log,
    );
    const needScheme: TreeItem[] = [];
    for (const [index, item] of pending.entries()) {
      if (!fileResults[index]) {
        continue;
      }
      if (!rule.scheme) {
        matched.add(item);
      } else {
        needScheme.push(item);
      }
    }
    if (needScheme.length > 0) {
      const schemeResults = await evalRule(
        matcher,
        rule.scheme,
        needScheme.map((item) => item.scheme ?? ""),
        log,
      );
      needScheme.forEach((item, index) => {
        if (schemeResults[index]) {
          matched.add(item);
        }
      });
    }
  }
}

/** by_sheets 求值（main.js:375-407 等价；DataSource `|` 切分、sheet 缺段空串、任一命中即中）。 */
async function evalSheetRules(
  matcher: MatcherService,
  rules: readonly SelectorSheetRule[],
  candidates: readonly TreeItem[],
  matched: Set<TreeItem>,
  log?: (message: string) => void,
): Promise<void> {
  for (const rule of rules) {
    const pending = candidates.filter((item) => !matched.has(item));
    if (pending.length === 0) {
      return;
    }
    // 展开 (item × DataSource) 为扁平输入，记录每个展开槽归属的 item。
    const owners: TreeItem[] = [];
    const fileInputs: string[] = [];
    const sheetInputs: (string | undefined)[] = [];
    for (const item of pending) {
      for (const value of item.schemeData.DataSource ?? []) {
        const parts = value.split("|");
        owners.push(item);
        fileInputs.push(parts[0] ?? "");
        sheetInputs.push(parts[1]);
      }
    }
    if (owners.length === 0) {
      continue;
    }
    const fileResults = await evalRule(matcher, rule.file, fileInputs, log);
    if (!rule.sheet) {
      owners.forEach((item, index) => {
        if (fileResults[index]) {
          matched.add(item);
        }
      });
      continue;
    }
    const sheetOwners: number[] = [];
    const sheetEvalInputs: string[] = [];
    fileResults.forEach((hit, index) => {
      if (hit) {
        sheetOwners.push(index);
        sheetEvalInputs.push(sheetInputs[index] ?? "");
      }
    });
    if (sheetOwners.length === 0) {
      continue;
    }
    const sheetResults = await evalRule(matcher, rule.sheet, sheetEvalInputs, log);
    sheetResults.forEach((hit, index) => {
      if (hit) {
        matched.add(owners[sheetOwners[index] as number] as TreeItem);
      }
    });
  }
}

/**
 * 隔离版选择器资格判定。返回按输入顺序命中的 item 列表（每 item 至多一次）。
 * 分流互斥与 resolveSelectorItems 相同：`item.file && item.scheme` → 只参与
 * by_schemes；否则有 DataSource → 只参与 by_sheets。
 */
export async function resolveSelectorItemsIsolated(
  matcher: MatcherService,
  selector: CustomSelectorRules,
  items: readonly TreeItem[],
  options: IsolatedSelectorOptions = {},
): Promise<TreeItem[]> {
  const matched = new Set<TreeItem>();
  const schemeCandidates = items.filter((item) => item.file && item.scheme);
  const sheetCandidates = items.filter(
    (item) => !(item.file && item.scheme) && item.schemeData.DataSource,
  );
  await evalSchemeRules(matcher, selector.by_schemes ?? [], schemeCandidates, matched, options.log);
  await evalSheetRules(matcher, selector.by_sheets ?? [], sheetCandidates, matched, options.log);
  return items.filter((item) => matched.has(item));
}
