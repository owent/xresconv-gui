#!/usr/bin/env node
/** 有界桌面验收：显式管理驱动进程树，不隐式下载驱动或依赖外部服务。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProcessScope } from '@xresconv/guardian';

if (process.platform === 'darwin') {
  throw new Error('This external tauri-driver harness supports Windows/Linux; macOS requires a separately validated driver provider (see P5-09).');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const exe = process.env.XRESCONV_E2E_APP ?? path.join(root, 'target', 'debug', process.platform === 'win32' ? 'xresconv-gui.exe' : 'xresconv-gui');
const scope = createProcessScope({ name: 'desktop-e2e' });
const env = { ...process.env };
const artifacts = path.join(root, 'build', 'desktop-test-results');
mkdirSync(artifacts, { recursive: true });
Object.assign(env, { TMP: artifacts, TEMP: artifacts, TMPDIR: artifacts });
let driver;
let driverError;
let settings;
let settingsFile;

async function run(command, args, timeout, extraEnv = {}) {
  const child = spawn(command, args, scope.decorateSpawnOptions({ cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv }, windowsHide: true }));
  scope.register(child);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void scope.terminate(0);
      reject(new Error(`${command} exceeded ${timeout} ms`));
    }, timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server;
}

try {
  if (!env.XRESCONV_E2E_SKIP_BUILD) {
    await run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--debug', '--no-bundle'], 30 * 60_000);
  }
  if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
  const driverPort = await reservePort();
  const nativePort = await reservePort();
  env.XRESCONV_E2E_DRIVER_PORT = String(driverPort.address().port);
  const args = ['--port', env.XRESCONV_E2E_DRIVER_PORT, '--native-port', String(nativePort.address().port)];
  const nativeDriver = env.MSEDGEDRIVER_PATH;
  if (nativeDriver) args.push('--native-driver', statSync(nativeDriver).isDirectory() ? path.join(nativeDriver, 'msedgedriver.exe') : nativeDriver);
  await Promise.all([driverPort, nativePort].map((server) => new Promise((resolve) => server.close(resolve))));
  driver = spawn(env.TAURI_DRIVER_PATH ?? 'tauri-driver', args, scope.decorateSpawnOptions({ cwd: root, env, stdio: 'inherit', windowsHide: true }));
  scope.register(driver);
  driver.once('error', (error) => { driverError = error; });
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (driverError) throw driverError;
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited (${driver.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${env.XRESCONV_E2E_DRIVER_PORT}/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* driver has not bound its listener yet */ }
    if (Date.now() >= deadline) throw new Error('tauri-driver readiness exceeded 15 seconds');
    await delay(100);
  }
  settingsFile = path.join(path.dirname(exe), 'display-settings.json');
  settings = existsSync(settingsFile) ? readFileSync(settingsFile) : null;
  // 每轮验证首次启动，不依赖开发者的上次配置；无论成功失败都恢复原始字节。
  const inputs = env.XRESCONV_E2E_INPUT ? [env.XRESCONV_E2E_INPUT] : ['', path.join(root, 'tests/fixtures/config/tree-items.xml')];
  for (const input of inputs) {
    writeFileSync(settingsFile, '{}\n');
    await run(process.execPath, [path.join(root, 'node_modules/@wdio/cli/bin/wdio.js'), 'run', 'tests/desktop/wdio.conf.mjs'], 5 * 60_000, { XRESCONV_E2E_INPUT: input });
  }
} finally {
  await scope.terminate(0);
  await scope.dispose();
  if (settingsFile && settings !== undefined) {
    if (settings === null) rmSync(settingsFile, { force: true });
    else writeFileSync(settingsFile, settings);
  }
}
console.log('[e2e] done');
