import { expect, test } from "@playwright/test";
import { selectValue } from "../desktop/interactions.mjs";

test("embedded select adapter changes the real settings dialog language", async ({ page }) => {
  const original = process.env.XRESCONV_E2E_DRIVER_PROVIDER;
  process.env.XRESCONV_E2E_DRIVER_PROVIDER = "embedded";
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "显示设置" }).click();
    const select = page.getByTestId("language-select");
    await expect(select).toBeVisible();
    const browser = { execute: (callback, element, value) => element.evaluate(callback, value) };
    await selectValue(browser, select, "en");
    await expect(page.getByRole("dialog", { name: "Display settings" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(select).toHaveValue("en");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start conversion" })).toBeVisible();
  } finally {
    if (original === undefined) delete process.env.XRESCONV_E2E_DRIVER_PROVIDER;
    else process.env.XRESCONV_E2E_DRIVER_PROVIDER = original;
  }
});
