/**
 * ANSI SGR 安全渲染解析（P4-07，BD-04）。
 *
 * 对齐旧版 shell_color_to_html（main.js:433-500）的可见语义：
 * - SGR 序列（`\x1b[...m`，旧版正则容许缺省 ESC，保持一致）按数字 flag 解析；
 *   flag 0 关闭全部已开样式；1/4 加粗/下划线；30-37/40-47 映射固定颜色词表。
 * - 其余文本按字面保留（`\r\n`/`\r` 归一为 `\n`，`\t` 展开两空格，对齐旧版），
 *   由 React 以文本节点渲染 —— 标签、事件属性、URL 一律不执行（BD-04/R12，
 *   修复旧版 `.replace("<","&lt;")` 只转义首个字符的缺陷，不复活 innerHTML 路径）。
 * - 颜色词表为固定枚举（非日志内容），渲染为内联 style；嵌套 SGR 合并样式
 *   （旧版嵌套 span 的等效可见行为）。
 */

export interface AnsiStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  /** 渲染键（解析期分配；不可变文本的稳定序号）。 */
  key: string;
  text: string;
  style: AnsiStyle;
}

/** 旧版固定颜色词表（main.js:433-452）；值全部为 CSS 命名颜色。 */
const SGR_FOREGROUND: Readonly<Record<string, string>> = {
  30: "black",
  31: "darkred",
  32: "darkgreen",
  33: "brown",
  34: "darkblue",
  35: "purple",
  36: "darkcyan",
  37: "gray",
};

const SGR_BACKGROUND: Readonly<Record<string, string>> = {
  40: "black",
  41: "darkred",
  42: "darkgreen",
  43: "brown",
  44: "darkblue",
  45: "purple",
  46: "darkcyan",
  47: "white",
};

// ANSI SGR 序列以 ESC 控制字符开头（本模块的解析对象）；旧版正则容许缺省 ESC。
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR 分隔符即 ESC 控制字符
const SGR_SPLIT = /(\x1b?\[[\d;]*m)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR 令牌即 ESC 控制字符
const SGR_TOKEN = /^\x1b?\[[\d;]*m$/;

function hasAny(style: AnsiStyle): boolean {
  return (
    style.color !== undefined ||
    style.background !== undefined ||
    style.bold === true ||
    style.underline === true
  );
}

/** 把含 ANSI SGR 的文本解析为带样式的纯文本段（样式合并自嵌套 SGR 栈）。 */
export function parseAnsi(input: string): AnsiSegment[] {
  const stack: AnsiStyle[] = [];
  const merged = (): AnsiStyle => {
    const out: AnsiStyle = {};
    for (const style of stack) {
      if (style.color !== undefined) out.color = style.color;
      if (style.background !== undefined) out.background = style.background;
      if (style.bold === true) out.bold = true;
      if (style.underline === true) out.underline = true;
    }
    return out;
  };
  const segments: AnsiSegment[] = [];
  for (const part of input.split(SGR_SPLIT)) {
    if (part === "") continue;
    if (!SGR_TOKEN.test(part)) {
      segments.push({
        key: String(segments.length),
        text: part.replace(/\r\n?/g, "\n").replace(/\t/g, "  "),
        style: merged(),
      });
      continue;
    }
    let reset = false;
    const next: AnsiStyle = {};
    for (const flag of part.match(/\d+/g) ?? []) {
      if (flag === "0") {
        // 旧版：flag 0 关闭全部已开 span 并忽略同序列其余 flag。
        reset = true;
        break;
      }
      const fg = SGR_FOREGROUND[flag];
      if (fg !== undefined) next.color = fg;
      const bg = SGR_BACKGROUND[flag];
      if (bg !== undefined) next.background = bg;
      if (flag === "1") next.bold = true;
      if (flag === "4") next.underline = true;
    }
    if (reset) {
      stack.length = 0;
      continue;
    }
    if (hasAny(next)) stack.push(next);
  }
  return segments;
}
