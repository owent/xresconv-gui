import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForAppTitle } from './readiness.mjs';

function driver(titles) {
  let reads = 0;
  return {
    get reads() { return reads; },
    async getTitle() { return titles[Math.min(reads++, titles.length - 1)]; },
    async waitUntil(condition, options) {
      assert.equal(options.timeout, 30_000);
      assert.equal(options.interval, 100);
      for (let attempt = 0; attempt < titles.length; attempt++) {
        if (await condition()) return;
      }
      throw new Error(options.timeoutMsg);
    },
  };
}

test('waits for the initial blank WebView to navigate to the app', async () => {
  const browser = driver(['', '', 'xresconv-gui']);
  await waitForAppTitle(browser);
  assert.equal(browser.reads, 3);
});

test('accepts an already loaded app without an extra delay', async () => {
  const browser = driver(['xresconv-gui']);
  await waitForAppTitle(browser);
  assert.equal(browser.reads, 1);
});

test('a permanently blank or wrong page still fails at the deadline', async () => {
  for (const title of ['', 'unexpected page']) {
    await assert.rejects(waitForAppTitle(driver([title])), /app title did not become xresconv-gui/);
  }
});
