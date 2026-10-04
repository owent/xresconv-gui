import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({ yarn: "" }));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((command: string) =>
    command === "rustc" ? "rustc 1.98.1 (test)" : tools.yarn,
  ),
}));
afterEach(() => vi.restoreAllMocks());

it.each([true, false])(
  "toolchain CLI checks the packageManager pin (matching=%s)",
  async (matching) => {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    tools.yarn = matching ? pkg.packageManager.replace(/^yarn@/, "") : "0.0.0";
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    const checker = new URL("../../../scripts/check-toolchain.mjs", import.meta.url).href;
    await import(checker);
    expect(exit).toHaveBeenCalledWith(matching ? 0 : 1);
  },
);
