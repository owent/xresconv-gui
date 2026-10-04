import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driverProvider, desktopSessions, testBuildArgs } from './options.mjs';

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
