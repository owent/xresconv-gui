/** 内部共享小工具。 */

/** 把未知异常值格式化为多行文本（Error 取 stack，对齐旧版 logger_format_exception_message 取 stack 的行为，main.js:319-330；HTML 转义属 UI 层，此处不做）。 */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}
