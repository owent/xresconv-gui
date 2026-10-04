import { describe, expect, it } from "vitest";
import { catalogs, detectLocale, normalizePreference, translateMessage } from "../src/i18n";

describe("locale negotiation", () => {
  it("uses the first supported system preference and matches regions", () => {
    expect(detectLocale(["pt-BR", "fr-CA", "ja-JP"])).toBe("fr");
    expect(detectLocale(["en-AU", "de-DE"])).toBe("en");
    expect(detectLocale(["de_AT"])).toBe("de");
    expect(detectLocale(["es-MX"])).toBe("es");
  });

  it("distinguishes Chinese scripts and regions", () => {
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-TW"]) {
      expect(detectLocale([tag])).toBe("zh-CN");
    }
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN"]) {
      expect(detectLocale([tag])).toBe("zh-TW");
    }
  });

  it("falls back to English for missing, invalid or unsupported languages", () => {
    for (const tags of [[], [""], ["garbage!"], ["pt-BR", "ru"], ["x-private"]]) {
      expect(detectLocale(tags)).toBe("en");
    }
    expect(detectLocale(["invalid!", "ja-JP"])).toBe("ja");
  });

  it("accepts only supported persisted preferences", () => {
    expect(normalizePreference("fr")).toBe("fr");
    for (const preference of [null, undefined, "", "en-US", "__proto__", "ru"]) {
      expect(normalizePreference(preference)).toBe("system");
    }
  });
});

describe("message fallback and interpolation", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`keeps ${locale} keys and placeholders complete`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(catalogs.en).sort());
      for (const [key, english] of Object.entries(catalogs.en)) {
        const translated = catalog[key as keyof typeof catalog];
        expect(translated.trim(), `${locale}: ${key}`).not.toBe("");
        const placeholders = (text: string) =>
          [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]).sort();
        expect(placeholders(translated), `${locale}: ${key}`).toEqual(placeholders(english));
      }
    });
  }

  it("uses the English message when a translation is missing or empty", () => {
    expect(translateMessage("fr", "common.close", undefined, {})).toBe("Close");
    expect(translateMessage("fr", "common.close", undefined, { "common.close": " " })).toBe(
      "Close",
    );
  });

  it("inserts text literally without interpreting markup or replacement tokens", () => {
    const title = '<img src=x onerror="alert(1)"> $& {count}';
    expect(translateMessage("en", "tree.select", { title })).toBe(`Select ${title}`);
    expect(translateMessage("en", "tree.matches", { count: 0 })).toContain("0");
  });
});
