import path from 'node:path';
import { existsSync } from 'node:fs';

export function displaySettingsFile(application) {
  const dir = path.dirname(application);
  // Linux offline launcher execs usr/bin/xresconv-gui; current_exe() uses that path.
  const appdirGui = path.join(dir, 'usr', 'bin', 'xresconv-gui');
  return path.join(path.basename(application) === 'AppRun' && existsSync(appdirGui) ? path.dirname(appdirGui) : dir, 'display-settings.json');
}

/** Only the test binary contains an embedded driver. Published artifacts use external drivers. */
export function driverProvider(platform, override) {
  const provider = override ?? (platform === 'darwin' ? 'embedded' : 'external');
  if (!['external', 'embedded'].includes(provider)) throw new Error(`unknown desktop driver provider: ${provider}`);
  if (platform === 'darwin' && provider === 'external') throw new Error('macOS requires the embedded test driver; external tauri-driver has no WKWebView provider');
  return provider;
}

export function desktopSessions(provider, inputs) {
  return inputs.flatMap((input) => {
    const specs = input ? ['tree-select'] : ['launch', 'p4-ui'];
    return provider === 'embedded' ? specs.map((spec) => ({ input, specs: [spec] })) : [{ input, specs }];
  });
}

export function testBuildArgs(provider) {
  return ['build', '--debug', '--no-bundle', ...(provider === 'embedded' ? ['--features', 'e2e'] : [])];
}
