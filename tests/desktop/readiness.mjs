export async function waitForAppTitle(browser) {
  await browser.waitUntil(async () => (await browser.getTitle()) === 'xresconv-gui', {
    timeout: 30_000,
    interval: 100,
    timeoutMsg: 'app title did not become xresconv-gui within 30 seconds',
  });
}
