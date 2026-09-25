import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import type { BackendSnapshot, TreeNodeSnap } from "../src/adapters/backend";
import { filterTreeNodes } from "../src/app/ConversionTree";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
const node = (key: number, title: string, children: TreeNodeSnap[] = []): TreeNodeSnap => ({
  key,
  title,
  children,
  folder: children.length > 0,
  tooltip: "",
  selected: false,
  partsel: false,
  expanded: true,
  autoSelect: false,
  unselectable: false,
});
const snapshot = (path = "old.xml"): BackendSnapshot => ({
  state: "ready",
  runSeq: 0,
  config: { path },
  selectedItems: [],
  tree: { version: 1, nodes: [node(1, "old")] },
  settings: {
    overrides: {},
    effective: {
      workDir: "",
      xresloaderPath: "",
      proto: "",
      dataVersion: "",
      outputDir: "",
      rename: "",
      type: "bin",
      protoFile: [],
      dataSrcDir: [],
      matrix: [],
    },
    parallelism: 2,
  },
  customSelectors: null,
});
beforeEach(() => {
  resetSessionStore();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps the loaded path when opening another configuration fails", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(snapshot()).mockRejectedValueOnce("invalid config");
  await useSessionStore.getState().loadConfig("old.xml");
  await useSessionStore.getState().loadConfig("bad.xml");
  expect(useSessionStore.getState().configPath).toBe("old.xml");
});

it("ignores a snapshot response after guardian death", async () => {
  const pending = deferred<BackendSnapshot>();
  vi.mocked(invoke).mockReturnValue(pending.promise);
  const refresh = useSessionStore.getState().refreshSnapshot();
  useSessionStore.getState().markGuardianDead({ reason: "gone" });
  pending.resolve(snapshot());
  await refresh;
  expect(useSessionStore.getState().connection).toBe("degraded");
});

it("does not overwrite a newly loaded config with an older refresh", async () => {
  const pending = deferred<BackendSnapshot>();
  vi.mocked(invoke).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot("new.xml"));
  const refresh = useSessionStore.getState().refreshSnapshot();
  await useSessionStore.getState().loadConfig("new.xml");
  pending.resolve(snapshot());
  await refresh;
  expect(useSessionStore.getState().snapshot?.config?.path).toBe("new.xml");
});

it("drops queued selection from the old config on load", async () => {
  vi.mocked(invoke).mockResolvedValue(snapshot());
  await useSessionStore.getState().loadConfig("old.xml");
  vi.mocked(invoke).mockClear();
  const select = useSessionStore.getState().selectAll();
  await useSessionStore.getState().loadConfig("new.xml");
  await select;
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]) => (args as { method?: string })?.method === "applyOps"),
  ).toBe(false);
});

it("filters unmatched grandchildren even when immediate child count is unchanged", () => {
  const root = node(1, "root", [node(2, "folder", [node(3, "needle"), node(4, "other")])]);
  const filtered = filterTreeNodes([root], "needle");
  expect(filtered.nodes[0]?.children[0]?.children.map((child) => child.key)).toEqual([3]);
});

it("does not invalidate a pending load when a second load is refused", async () => {
  const pending = deferred<BackendSnapshot>();
  vi.mocked(invoke)
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce("INVALID_STATE: loading");
  const first = useSessionStore.getState().loadConfig("first.xml");
  expect(await useSessionStore.getState().loadConfig("second.xml")).toBe(false);
  pending.resolve(snapshot("first.xml"));
  await first;
  expect(useSessionStore.getState().snapshot?.config?.path).toBe("first.xml");
});
