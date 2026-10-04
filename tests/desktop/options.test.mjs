import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverProvider, desktopSessions, displaySettingsFile, testBuildArgs } from './options.mjs';

test('AppRun settings belong beside the real GUI, preserving the launcher file', (t) => {
  const base = fileURLToPath(new URL('../../build/desktop-options/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'appdir-'));
  assert(dir.startsWith(base));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'usr/bin'), { recursive: true });
  writeFileSync(path.join(dir, 'usr/bin/xresconv-gui'), 'fixture GUI');
  const launcherSettings = path.join(dir, 'display-settings.json');
  const actualSettings = path.join(dir, 'usr/bin/display-settings.json');
  writeFileSync(launcherSettings, 'unrelated launcher data');
  const backup = Buffer.from('{"lastConfigFile":"用户配置.xml"}\n', 'utf8');
  writeFileSync(actualSettings, backup);
  const selected = displaySettingsFile(path.join(dir, 'AppRun'));
  assert.equal(selected, actualSettings);
  writeFileSync(selected, '{}\n');
  assert.equal(readFileSync(launcherSettings, 'utf8'), 'unrelated launcher data');
  writeFileSync(selected, backup);
  assert.deepEqual(readFileSync(actualSettings), backup);
});

test('ordinary desktop executables keep settings next to the executable', () => {
  const app = path.resolve('build/desktop-options/plain/xresconv-gui');
  assert.equal(existsSync(path.join(path.dirname(app), 'usr/bin/xresconv-gui')), false);
  assert.equal(displaySettingsFile(app), path.join(path.dirname(app), 'display-settings.json'));
});

test('macOS uses embedded WKWebView while existing platforms keep external drivers', () => {
  assert.equal(driverProvider('darwin'), 'embedded');
  for (const platform of ['win32', 'linux']) assert.equal(driverProvider(platform), 'external');
  assert.equal(driverProvider('win32', 'embedded'), 'embedded');
  assert.throws(() => driverProvider('darwin', 'external'), /macOS/);
  assert.throws(() => driverProvider('linux', 'typo'), /provider/);
});

test('embedded specs each start an isolated app with the correct CLI input', () => {
  assert.deepEqual(desktopSessions('embedded', ['', 'config with spaces.xml']), [
    { input: '', specs: ['launch'] },
    { input: '', specs: ['p4-ui'] },
    { input: 'config with spaces.xml', specs: ['tree-select'] },
  ]);
  assert.deepEqual(desktopSessions('external', ['', 'config.xml']), [
    { input: '', specs: ['launch', 'p4-ui'] },
    { input: 'config.xml', specs: ['tree-select'] },
  ]);
});

test('test driver is enabled only in an explicit debug, unbundled build', () => {
  assert.deepEqual(testBuildArgs('external'), ['build', '--debug', '--no-bundle']);
  assert.deepEqual(testBuildArgs('embedded'), ['build', '--debug', '--no-bundle', '--features', 'e2e']);
});
