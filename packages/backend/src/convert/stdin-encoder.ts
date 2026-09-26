/**
 * xresloader stdin 协议编码器（P3-06）。
 *
 * xresloader 以 `--stdin` 启动后逐行读取命令，每行经固定 tokenizer 切分为 argv：
 * `Pattern.compile("('[^']*')|(\"[^\"]*\")|(\\S+)", MULTILINE|CASE_INSENSITIVE)`
 * （Main.java:344-345），单/双引号成对剥除（Main.java:357-361），
 * 空 token 直接丢弃（Main.java:363-365），无转义机制；一行一命令（Main.java:352、401）。
 *
 * 本模块提供两个方向：
 * - {@link encodeTaskLine}：argv → 单行文本（保证经上述 tokenizer 还原为原 argv）。
 * - {@link tokenizeStdinLine}：同形 JS 移植的 tokenizer，用于把旧版"原始命令片段"
 *   （global/item `<option>` 的 value，main.js:1962-1966、2027-2031 原样拼接进命令串）
 *   切成 argv token。计划构建器消费它，保证与旧版"拼接后由 Java 切分"语义一致。
 */

/** tokenizer 同形移植（Main.java:344-345）。MULTILINE/CASE_INSENSITIVE 对该模式无实际影响。 */
// Java Pattern's default \S excludes only ASCII whitespace; JS \S also
// excludes NBSP and ideographic spaces and would change literal options.
const STDIN_TOKEN_PATTERN = /'[^']*'|"[^"]*"|[^ \t\n\v\f\r]+/g;

/**
 * 把一行 stdin 命令文本切分为 argv token（Main.java:347-374 同形移植）。
 * 引号成对剥除；空 token（""/''）丢弃——与 Java 行为一致。
 */
export function tokenizeStdinLine(line: string): string[] {
  const tokens: string[] = [];
  for (const match of line.matchAll(STDIN_TOKEN_PATTERN)) {
    let token = match[0];
    const first = token.charAt(0);
    const last = token.charAt(token.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      token = token.length > 2 ? token.slice(1, -1) : "";
    }
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** 不可编码输入错误：携带字段值与原因，由调用方决定是否走 per-task argv 回退。 */
export class StdinEncodeError extends Error {
  readonly code = "STDIN_ENCODE_ERROR";
  /** 触发错误的 token 原文。 */
  readonly token: string;
  /** 失败原因（人类可读）。 */
  readonly reason: string;

  constructor(token: string, reason: string) {
    super(
      `cannot encode token for xresloader stdin protocol: ${reason} (token: ${JSON.stringify(token)})`,
    );
    this.name = "StdinEncodeError";
    this.token = token;
    this.reason = reason;
  }
}

/**
 * 编码单个 token，对齐 Main.java tokenizer 的还原能力：
 * - 含 `"` 不含 `'` → 单引号包裹；
 * - 含 `'` 不含 `"` → 双引号包裹；
 * - 两者都含、含 \r/\n、或为空串 → 抛 {@link StdinEncodeError}
 *   （tokenizer 无转义机制；空 token 会被 Main.java:363-365 丢弃导致 argv 错位）；
 * - 其余含空白 → 双引号包裹；无空白无引号 → 原样（bare）。
 */
export function encodeToken(token: string): string {
  if (token.length === 0) {
    throw new StdinEncodeError(token, "empty token would be dropped by the stdin tokenizer");
  }
  // Scanner.nextLine also splits NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR.
  if (/[\r\n\u0085\u2028\u2029]/.test(token)) {
    throw new StdinEncodeError(
      token,
      "token contains a line break; the stdin protocol is one line per command",
    );
  }
  const hasSingle = token.includes("'");
  const hasDouble = token.includes('"');
  if (hasSingle && hasDouble) {
    throw new StdinEncodeError(
      token,
      "token contains both single and double quotes; the tokenizer has no escaping",
    );
  }
  if (hasDouble) {
    return `'${token}'`;
  }
  if (hasSingle) {
    return `"${token}"`;
  }
  if (/\s/.test(token)) {
    return `"${token}"`;
  }
  return token;
}

/** 编码整行：逐 token 编码后以单空格连接（Main.java 按行读取，token 间空白任意）。 */
export function encodeTaskLine(argv: string[]): string {
  return argv.map(encodeToken).join(" ");
}

/**
 * 不经 stdin 的逐任务 argv 回退命令：不可编码输入时由调用方改为
 * `spawn("java", buildArgvFallbackCommand(...))` 直接传 argv（无 tokenizer 限制）。
 */
export function buildArgvFallbackCommand(
  javaArgs: string[],
  jarPath: string,
  taskArgv: string[],
): string[] {
  return javaArgs.concat(["-jar", jarPath], taskArgv);
}
