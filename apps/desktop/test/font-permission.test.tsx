import { invoke, isTauri } from "@tauri-apps/api/core";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplaySettingsDialog } from "../src/app/DisplaySettingsDialog";
import { resetDisplaySettings } from "../src/app/display-settings";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const nativeInvoke = vi.mocked(invoke);
const queryFonts = vi.fn(async function (this: Window) {
  expect(this).toBe(window);
  return [{ family: "Local Only Font" }, { family: "Local Only Font" }];
});

describe("local font access without a WebView permission prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDisplaySettings();
    vi.mocked(isTauri).mockReturnValue(true);
    nativeInvoke.mockResolvedValue(null);
    vi.stubGlobal("queryLocalFonts", queryFonts);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("waits for native permission completion before enumerating fonts", async () => {
    let grant!: (allowed: boolean) => void;
    nativeInvoke.mockImplementation(async (command) => {
      if (command === "allow_local_fonts") {
        return new Promise<boolean>((resolve) => {
          grant = resolve;
        });
      }
      return null;
    });
    render(<DisplaySettingsDialog open onClose={() => {}} />);
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith("allow_local_fonts"));
    expect(queryFonts).not.toHaveBeenCalled();
    await act(async () => grant(true));
    await waitFor(() =>
      expect(document.querySelectorAll('datalist option[value="Local Only Font"]')).toHaveLength(4),
    );
    expect(queryFonts).toHaveBeenCalledOnce();
  });

  it.each(["unsupported", "error"])(
    "uses fallback fonts when native authorization returns %s",
    async (result) => {
      nativeInvoke.mockImplementation(async (command) => {
        if (command === "allow_local_fonts") {
          if (result === "error") throw new Error("profile permission unavailable");
          return false;
        }
        return null;
      });
      render(<DisplaySettingsDialog open onClose={() => {}} />);
      await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith("allow_local_fonts"));
      expect(queryFonts).not.toHaveBeenCalled();
      expect(document.querySelectorAll('datalist option[value="system-ui"]')).toHaveLength(4);
    },
  );

  it("keeps browser previews independent of native permissions", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<DisplaySettingsDialog open onClose={() => {}} />);
    await waitFor(() =>
      expect(document.querySelectorAll('datalist option[value="Local Only Font"]')).toHaveLength(4),
    );
    expect(nativeInvoke).not.toHaveBeenCalledWith("allow_local_fonts");
  });

  it("does not request permission on platforms without the font API", async () => {
    vi.stubGlobal("queryLocalFonts", undefined);
    render(<DisplaySettingsDialog open onClose={() => {}} />);
    await act(async () => {});
    expect(nativeInvoke).not.toHaveBeenCalledWith("allow_local_fonts");
    expect(document.querySelectorAll('datalist option[value="system-ui"]')).toHaveLength(4);
  });
});
