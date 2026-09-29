import { cpSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Runtime UI resources only; this does not translate the application's UI.
 * English must remain available as Chromium's final locale fallback. */
export const WEBVIEW_LOCALES = [
  "en-US",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "de",
  "fr",
  "es",
  "pt-BR",
  "ru",
] as const;
export type WebViewLocalePolicy = "all" | "mainstream";

/** Work on the archive copy, never delete files from the download cache. Keep
 * unknown resource families, binaries, ICU and license data unchanged. */
export function copyFixedRuntime(source: string, dest: string, policy: WebViewLocalePolicy) {
  if (policy !== "all" && policy !== "mainstream") throw new Error("invalid WebView locale policy");
  const omitted = new Set<string>();
  let removedBytes = 0;
  if (policy === "mainstream") {
    const locales = path.join(source, "Locales");
    const entries = readdirSync(locales, { withFileTypes: true });
    const families = ["", "copilot_overlay_strings_"];
    for (const prefix of families) {
      // The primary family is required; optional overlay families are validated
      // in full when present, so a changed upstream layout cannot lose fallback.
      if (prefix && !entries.some((entry) => entry.name.startsWith(prefix))) continue;
      for (const locale of WEBVIEW_LOCALES) {
        const name = `${prefix}${locale}.pak`;
        const entry = entries.find((entry) => entry.name === name);
        if (!entry?.isFile() || statSync(path.join(locales, name)).size === 0)
          throw new Error(`required WebView locale resource missing or empty: ${name}`);
      }
    }
    const retained = new Set<string>(WEBVIEW_LOCALES);
    for (const entry of entries) {
      const match = /^(?:copilot_overlay_strings_)?([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\.pak$/.exec(
        entry.name,
      );
      if (entry.isFile() && match && !retained.has(match[1] as string)) {
        const file = path.join(locales, entry.name);
        omitted.add(file);
        removedBytes += statSync(file).size;
      }
    }
  }
  cpSync(source, dest, { recursive: true, filter: (file) => !omitted.has(file) });
  return { removedFiles: omitted.size, removedBytes };
}
