import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemLocales, pickSavePath, pickXmlConfig } from "../src/adapters/tauri";
import { CustomActionBar } from "../src/app/CustomActionBar";
import { DialogHost } from "../src/app/DialogHost";
import { DisplaySettingsDialog } from "../src/app/DisplaySettingsDialog";
import {
  rememberLoadedConfig,
  resetDisplaySettings,
  useDisplaySettings,
} from "../src/app/display-settings";
import { RunControls } from "../src/app/RunControls";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";
import { TreeToolbar } from "../src/app/TreeToolbar";
import {
  catalogs,
  getLocale,
  setLanguagePreference,
  setSystemLocales,
  translate,
} from "../src/i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));
const mockedInvoke = vi.mocked(invoke);
let disk: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  resetSessionStore();
  resetDisplaySettings();
  disk = {
    theme: "light",
    language: "system",
    lastConfigFile: null,
    fonts: { tree: { family: "Sarasa", size: 18 } },
  };
  mockedInvoke.mockImplementation(async (command, args) => {
    if (command === "read_display_settings") return structuredClone(disk);
    if (command === "write_display_settings") {
      disk = structuredClone({ ...args });
      return null;
    }
    if (command === "get_system_locales") return ["ru-RU", "fr-CA"];
    if (command === "get_cli_matches") return {};
    return null;
  });
});

describe("native language and preferences", () => {
  it("normalizes an unsupported saved language when merging other preference changes", async () => {
    disk.language = "ru";
    const { result } = renderHook(() => useDisplaySettings());
    await waitFor(() => expect(result.current.fonts.tree.family).toBe("Sarasa"));
    expect(result.current.language).toBe("system");
    act(() => result.current.setTheme("dark"));
    await waitFor(() => expect(disk).toMatchObject({ language: "system", theme: "dark" }));
  });

  it("restores manual language, switches back to native preferences and deduplicates startup", async () => {
    disk.language = "ja";
    const { result } = renderHook(() => useDisplaySettings(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.language).toBe("ja"));
    expect(document.documentElement.lang).toBe("ja");
    for (const command of ["get_system_locales", "get_cli_matches"]) {
      expect(mockedInvoke.mock.calls.filter(([name]) => name === command)).toHaveLength(1);
    }
    act(() => result.current.setLanguage("system"));
    expect(getLocale()).toBe("fr");
    await waitFor(() => expect(disk.language).toBe("system"));
  });

  it("accepts older settings and falls back to English for unsupported native languages", async () => {
    delete disk.language;
    mockedInvoke.mockImplementation(async (command) =>
      command === "read_display_settings"
        ? structuredClone(disk)
        : command === "get_system_locales"
          ? ["pt-BR", "ru-RU"]
          : {},
    );
    const { result } = renderHook(() => useDisplaySettings());
    await waitFor(() => expect(result.current.fonts.tree.family).toBe("Sarasa"));
    expect(result.current.language).toBe("system");
    expect(getLocale()).toBe("en");
  });

  it("merges language, theme, font and last-file writes and restores saved language", async () => {
    const { result } = renderHook(() => useDisplaySettings());
    await waitFor(() => expect(result.current.fonts.tree.family).toBe("Sarasa"));
    act(() => {
      result.current.setLanguage("de");
      result.current.setTheme("dark");
      result.current.setFontPrefs("ui", { family: "Arial", size: 16 });
      rememberLoadedConfig("project.xml");
    });
    await waitFor(() =>
      expect(disk).toMatchObject({
        language: "de",
        theme: "dark",
        lastConfigFile: "project.xml",
        fonts: { tree: { family: "Sarasa", size: 18 }, ui: { family: "Arial", size: 16 } },
      }),
    );
    resetDisplaySettings();
    renderHook(() => useDisplaySettings());
    await waitFor(() => expect(getLocale()).toBe("de"));
  });

  it("does not overwrite a user's language change with delayed startup settings", async () => {
    let release!: (value: unknown) => void;
    let reads = 0;
    mockedInvoke.mockImplementation((command) => {
      if (command === "read_display_settings" && ++reads === 1)
        return new Promise((resolve) => {
          release = resolve;
        });
      return Promise.resolve(command === "get_system_locales" ? ["fr"] : {});
    });
    const { result } = renderHook(() => useDisplaySettings());
    act(() => result.current.setLanguage("es"));
    act(() => release({ language: "ja", theme: "light", lastConfigFile: null }));
    await waitFor(() => expect(result.current.theme).toBe("light"));
    expect(getLocale()).toBe("es");
  });

  it("handles browser languagechange while manual overrides remain in force", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await getSystemLocales()).toEqual(["zh-CN"]);
    const { result } = renderHook(() => useDisplaySettings());
    await waitFor(() => expect(result.current.fonts.tree.family).toBe("Sarasa"));
    const changeBrowserLanguage = (tag: string) =>
      act(() => {
        Object.defineProperty(navigator, "languages", { configurable: true, value: [tag] });
        window.dispatchEvent(new Event("languagechange"));
      });
    changeBrowserLanguage("es-MX");
    expect(getLocale()).toBe("es");
    act(() => result.current.setLanguage("de"));
    changeBrowserLanguage("ja-JP");
    expect(getLocale()).toBe("de");
    act(() => result.current.setLanguage("system"));
    expect(getLocale()).toBe("ja");
  });
});

describe("translated controls and source text", () => {
  it("switches visible and accessible labels live without creating a business session", async () => {
    const { rerender } = render(
      <>
        <TreeToolbar hitCount={2} />
        <RunControls />
        <DisplaySettingsDialog open onClose={() => {}} />
      </>,
    );
    await screen.findByRole("dialog", { name: "Paramètres d’affichage" });
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Langue" }), "de");
    expect(screen.getByRole("dialog", { name: "Anzeigeeinstellungen" })).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: "Schriftgröße: Konvertierungsliste (px)" }),
    ).toBeTruthy();
    expect(screen.getByText("Treffer: 2")).toBeTruthy();
    expect(document.documentElement.lang).toBe("de");
    rerender(
      <>
        <TreeToolbar hitCount={2} />
        <RunControls />
        <DisplaySettingsDialog open={false} onClose={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Konvertierung starten" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Konvertierungseinträge suchen" })).toBeTruthy();
    expect(useSessionStore.getState().snapshot).toBeNull();
    await waitFor(() => expect(disk.language).toBe("de"));
  });

  it("keeps project action names and script dialog content literal in every language", () => {
    useSessionStore.setState({
      snapshot: {
        state: "ready",
        runSeq: 0,
        config: {},
        tree: null,
        selectedItems: [],
        settings: { overrides: {}, effective: null, parallelism: 4 },
        customSelectors: [
          { name: "项目按钮", hasAction: true, defaultSelected: false, style: null },
        ],
      },
      pendingDialogs: [
        {
          token: "dialog",
          title: "自定义标题",
          content: "<b>项目内容</b>",
          buttons: ["yes", "no"],
          answering: false,
        },
      ],
    });
    render(
      <>
        <CustomActionBar />
        <DialogHost />
      </>,
    );
    for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
      act(() => {
        setSystemLocales([locale]);
        setLanguagePreference("system");
      });
      expect(screen.getByText("项目按钮")).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "自定义标题" })).toBeTruthy();
      expect(screen.getByText("<b>项目内容</b>").querySelector("b")).toBeNull();
      expect(screen.getByRole("button", { name: translate("dialog.yes") })).toBeTruthy();
      expect(screen.getByRole("button", { name: translate("dialog.no") })).toBeTruthy();
    }
  });

  it("localizes native picker titles and preserves file extensions", async () => {
    act(() => setLanguagePreference("de"));
    await pickXmlConfig();
    await pickSavePath("conversion.log");
    expect(open).toHaveBeenCalledWith({
      title: "Konvertierungskonfiguration auswählen",
      filters: [{ name: "xresconv XML", extensions: ["xml"] }],
    });
    expect(save).toHaveBeenCalledWith({
      title: "Protokoll exportieren",
      defaultPath: "conversion.log",
      filters: [{ name: "Text", extensions: ["log", "txt"] }],
    });
  });
});
