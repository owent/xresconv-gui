import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

// The WebView bridge is not present under jsdom; mock the Tauri API layer.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_app_info") {
      return { name: "xresconv-gui", version: "3.0.0-dev.0", protocol_version: 1 };
    }
    if (cmd === "get_cli_matches") {
      return { input: { value: "tests/fixtures/config/basic.xml" } };
    }
    if (cmd === "get_backend_health") {
      return {
        ok: true,
        role: "guardian",
        pid: 1234,
        node: "v24.21.0",
        backend: { ok: true, role: "backend", pid: 1235, node: "v24.21.0", protocol_version: 1 },
      };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

describe("App skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows handshake info from the shell", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/xresconv-gui v3\.0\.0-dev\.0 · protocol v1/)).toBeTruthy();
    });
  });

  it("renders the config pick button", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "选择 XML 配置…" })).toBeTruthy();
  });

  it("lists CLI args returned by the shell", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/tests\/fixtures\/config\/basic\.xml/)).toBeTruthy();
    });
  });

  it("shows the guardian and backend handshake", async () => {
    render(<App />);
    await waitFor(() => {
      const text = screen.getByTestId("backend-health").textContent ?? "";
      expect(text).toContain("guardian ok · node v24.21.0");
      expect(text).toContain("backend ok · pid 1235 · protocol v1");
    });
  });
});
