import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Tauri copies /usr/bin/xdg-open into offline AppImages. The ARM runner does
// not preinstall it; every AppImage workflow must declare the build dependency.
it.each(["release.yml", "portable-build.yml"])(
  "%s installs xdg-utils before packaging Linux AppImages",
  (workflow) => {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${workflow}`, import.meta.url),
      "utf8",
    );
    const linuxJob = source.match(
      /^ {2}build-linux:\r?\n([\s\S]*?)(?=^ {2}[\w-]+:|(?![\s\S]))/m,
    )?.[1];
    expect(linuxJob, "Linux build job must exist").toBeDefined();
    const install = linuxJob?.match(/^\s*sudo apt-get install[^\r\n]*$/m)?.[0];
    expect(install, "AppImage builds require an explicit xdg-utils installation").toMatch(
      /\bxdg-utils\b/,
    );
    const packageAt = linuxJob?.search(
      /corepack yarn package:linux[^\r\n]*--variant=(?:offline|all|\$\{\{)/,
    );
    expect(packageAt, "offline packaging step must exist").toBeGreaterThanOrEqual(0);
    expect(linuxJob?.indexOf(install ?? "")).toBeLessThan(packageAt ?? -1);
    const checkAt = linuxJob?.indexOf("test -x /usr/bin/xdg-open") ?? -1;
    expect(checkAt, "missing bundler dependencies must fail before compilation").toBeGreaterThan(
      linuxJob?.indexOf(install ?? "") ?? -1,
    );
    expect(checkAt).toBeLessThan(packageAt ?? -1);
  },
);
