/**
 * 值比较/克隆/字段差分工具（P2-03 从 executor 抽出，P2-05 起 node-mirror 复用）。
 * 语义与原 executor.ts 内联实现一致，未做任何行为调整。
 */

/** item_data/log_object 经 JSON 到达；脚本可挂任意值，安全降级。 */
export function safeClone(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    // fall through to JSON round-trip
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || typeof a !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
  );
}

/**
 * 顶层字段 diff：执行前快照 vs 活对象。变化/新增键带执行后值，删除键映射为 null。
 * `skipKeys` 中的键不参与 diff（如 ft_node/id 这类别名或身份字段，P2-05）。
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skipKeys?: ReadonlySet<string>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (skipKeys?.has(key)) {
      continue;
    }
    if (!Object.hasOwn(after, key)) {
      fields[key] = null;
      continue;
    }
    if (!Object.hasOwn(before, key) || !deepEqual(before[key], after[key])) {
      fields[key] = safeClone(after[key]);
    }
  }
  return fields;
}
