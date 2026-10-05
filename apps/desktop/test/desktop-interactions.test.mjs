import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { selectValue } from "../../../tests/desktop/interactions.mjs";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("embedded selection updates a controlled React select through a bubbling change event", async () => {
  vi.stubEnv("XRESCONV_E2E_DRIVER_PROVIDER", "embedded");
  function LanguageSelect() {
    const [language, setLanguage] = useState("zh-CN");
    return createElement(
      "div",
      { "data-testid": "language", lang: language },
      createElement(
        "select",
        {
          "aria-label": "Language",
          value: language,
          onChange: (event) => setLanguage(event.target.value),
        },
        ["zh-CN", "en"].map((value) => createElement("option", { key: value, value }, value)),
      ),
    );
  }
  render(createElement(LanguageSelect));
  const select = screen.getByRole("combobox");
  const events = [];
  select.parentElement.addEventListener("input", () => events.push(["input", select.value]));
  select.parentElement.addEventListener("change", () => events.push(["change", select.value]));
  const element = {
    // The embedded driver's elementClick only calls option.click().
    selectByAttribute: async (_attribute, value) => {
      [...select.options].find((option) => option.value === value).click();
    },
  };
  const browser = { execute: async (callback, _element, value) => callback(select, value) };
  await act(() => selectValue(browser, element, "en"));
  expect(screen.getByTestId("language").lang).toBe("en");
  expect(events).toEqual([
    ["input", "en"],
    ["change", "en"],
  ]);
});

it("external drivers retain native select interaction", async () => {
  vi.stubEnv("XRESCONV_E2E_DRIVER_PROVIDER", "tauri");
  const select = { selectByAttribute: vi.fn().mockResolvedValue(undefined) };
  const browser = { execute: vi.fn() };
  await selectValue(browser, select, "en");
  expect(select.selectByAttribute).toHaveBeenCalledWith("value", "en");
  expect(browser.execute).not.toHaveBeenCalled();
});
