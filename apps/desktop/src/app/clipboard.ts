/**
 * 剪贴板写入（P4-07）：优先 navigator.clipboard（WebView2/WKWebView 的安全
 * 上下文可用）；不可用时回退隐藏 textarea + execCommand（deprecated 但作为
 * 无插件兜底）。两条路径都只写纯文本——日志内容不经任何富文本/HTML 通道。
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command returned false");
    }
  } finally {
    area.remove();
  }
}
