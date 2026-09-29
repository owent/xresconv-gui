import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const script = readFileSync(new URL("../../../scripts/ensure-zstd.ps1", import.meta.url), "utf8");

it.skipIf(process.platform !== "win32").each([
  { probe: 0, install: 0, after: 0, repairs: 0, failed: false },
  { probe: 7, install: 0, after: 0, repairs: 1, failed: false },
  { probe: -1, install: 0, after: 0, repairs: 1, failed: false },
  { probe: 7, install: 9, after: 0, repairs: 1, failed: true },
  { probe: 7, install: 0, after: 8, repairs: 1, failed: true },
])("checks native exit codes and repair results: %j", (testCase) => {
  // Functions replace native processes; this never invokes a package manager.
  const result = spawnSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
$global:repairs = 0
function zstd {
  if ($global:repairs -eq 0) {
    if (${testCase.probe} -eq -1) { throw 'command missing' }
    $global:LASTEXITCODE = ${testCase.probe}
  } else { $global:LASTEXITCODE = ${testCase.after} }
}
function choco { $global:repairs++; $global:LASTEXITCODE = ${testCase.install} }
$failed = $false
try { & {
${script}
} } catch { $failed = $true }
@{ failed = $failed; repairs = $global:repairs } | ConvertTo-Json -Compress
`,
    ],
    { encoding: "utf8", timeout: 15_000, windowsHide: true },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ failed: testCase.failed, repairs: testCase.repairs });
});
