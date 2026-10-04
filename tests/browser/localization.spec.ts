import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const languages = [
  { tag: "en-GB", resolved: "en", tree: "Conversion list", run: "Start conversion", settings: "Display settings", language: "Language" },
  { tag: "zh-CN", resolved: "zh-CN", tree: "转换列表", run: "开始转换", settings: "显示设置", language: "语言" },
  { tag: "zh-HK", resolved: "zh-TW", tree: "轉換清單", run: "開始轉換", settings: "顯示設定", language: "語言" },
  { tag: "ja-JP", resolved: "ja", tree: "変換リスト", run: "変換を開始", settings: "表示設定", language: "言語" },
  { tag: "de-AT", resolved: "de", tree: "Konvertierungsliste", run: "Konvertierung starten", settings: "Anzeigeeinstellungen", language: "Sprache" },
  { tag: "fr-CA", resolved: "fr", tree: "Liste de conversion", run: "Lancer la conversion", settings: "Paramètres d’affichage", language: "Langue" },
  { tag: "es-MX", resolved: "es", tree: "Lista de conversión", run: "Iniciar conversión", settings: "Ajustes de pantalla", language: "Idioma" },
];

for (const language of languages) {
  test.describe(language.tag, () => {
    test.use({ locale: language.tag });
    test("detects language and translates accessible controls", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language.resolved);
      await expect(page.getByRole("heading", { name: language.tree })).toBeVisible();
      await expect(page.getByRole("button", { name: language.run })).toBeVisible();
      await page.getByRole("button", { name: language.settings }).click();
      await expect(page.getByRole("dialog", { name: language.settings })).toBeVisible();
      await expect(page.getByRole("combobox", { name: language.language })).toHaveValue("system");
      await expect(page.getByRole("option", { name: "English", exact: true })).toBeAttached();
      await page.getByRole("combobox", { name: language.language }).selectOption("en");
      await expect(page.getByRole("dialog", { name: "Display settings" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Conversion list" })).toBeVisible();
    });
  });
}

test.describe("unsupported system language", () => {
  test.use({ locale: "pt-BR" });
  test("uses English automatically", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Start conversion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conversion list" })).toBeVisible();
  });
});

test.describe("long translations", () => {
  test.use({ locale: "de-DE" });
  for (const width of [1280, 720]) {
    test(`keeps German and French controls usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "Anzeigeeinstellungen" }).click();
      const dialog = page.getByRole("dialog", { name: "Anzeigeeinstellungen" });
      await expect(dialog).toBeVisible();
      const withinViewport = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth && node.scrollWidth <= node.clientWidth + 1;
      });
      expect(withinViewport).toBe(true);
      await page.getByRole("combobox", { name: "Sprache" }).selectOption("fr");
      await expect(page.getByRole("dialog", { name: "Paramètres d’affichage" })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag21a", "wcag2aa"]).analyze();
      expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
      await page.getByRole("button", { name: "Fermer", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }
});
