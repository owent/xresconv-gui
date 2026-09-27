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

it("blocks running during matrix writes and invalidates queued edits on guardian death", async () => {
  const pending = deferred<BackendSnapshot["settings"]>();
  useSessionStore.setState({ snapshot: snapshot() });
  vi.mocked(invoke).mockReturnValue(pending.promise);
  const first = useSessionStore
    .getState()
    .updateSettings((current) => ({ matrix: current.matrix }));
  const secondFactory = vi.fn((current) => ({ matrix: current.matrix }));
  const second = useSessionStore.getState().updateSettings(secondFactory);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(useSessionStore.getState().settingsPending).toBe(2);
  await expect(useSessionStore.getState().startRun()).resolves.toBe(false);
  await expect(useSessionStore.getState().runPreview()).resolves.toBe(false);
  useSessionStore.getState().markGuardianDead({ reason: "gone" });
  expect(useSessionStore.getState().settingsPending).toBe(0);
  pending.resolve(snapshot().settings);
  await expect(first).resolves.toBe(false);
  await expect(second).resolves.toBe(false);
  expect(secondFactory).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(1);
});

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

it("refreshes tree eligibility/version after updating the matrix", async () => {
  const current = snapshot();
  useSessionStore.setState({ snapshot: current });
  const updated = snapshot();
  updated.tree = { version: 2, nodes: [{ ...node(1, "old"), unselectable: true }] };
  vi.mocked(invoke).mockImplementation(async (_cmd, args) =>
    (args as { method?: string })?.method === "getSnapshot" ? updated : updated.settings,
  );
  await useSessionStore
    .getState()
    .updateSettings({ matrix: [{ type: "bin", tags: ["server"], classes: [] }] });
  expect(useSessionStore.getState().snapshot?.tree).toEqual(updated.tree);
});

it("keeps logs and a fast run result emitted before the run RPC reply", async () => {
  const pending = deferred<{ runSeq: number }>();
  useSessionStore.setState({ snapshot: snapshot() });
  useSessionStore.getState().appendLocalLog("previous run");
  vi.mocked(invoke).mockImplementation((_cmd, args) =>
    (args as { method?: string })?.method === "run"
      ? pending.promise
      : Promise.resolve({ ...snapshot(), state: "succeeded", runSeq: 1 }),
  );
  const start = useSessionStore.getState().startRun();
  useSessionStore.getState().appendLocalLog("current run");
  useSessionStore.getState().recordBackendEvent({
    kind: "event",
    payload: {
      source: "backend",
      type: "run_end",
      summary: { runSeq: 1, state: "succeeded", failedCount: 0, taskCount: 1, durationMs: 1 },
    },
  });
  pending.resolve({ runSeq: 1 });
  await start;
  expect(useSessionStore.getState().logs.entries.map((entry) => entry.message)).toEqual([
    "current run",
  ]);
  expect(useSessionStore.getState().lastRun?.state).toBe("succeeded");
});

it("does not restore old log pages after starting a run", async () => {
  const page = deferred<unknown>();
  useSessionStore.setState({ snapshot: snapshot() });
  vi.mocked(invoke).mockImplementation((_cmd, args) =>
    (args as { method?: string })?.method === "getLogs"
      ? page.promise
      : Promise.resolve(
          (args as { method?: string })?.method === "run" ? { runSeq: 1 } : snapshot(),
        ),
  );
  const init = useSessionStore.getState().initLogs();
  await useSessionStore.getState().startRun();
  page.resolve({ entries: [{ message: "old page", seq: 1 }], droppedCount: 0 });
  await init;
  expect(useSessionStore.getState().logs.entries).toEqual([]);
});

it("reports native save dialog failures without rejecting the UI action", async () => {
  useSessionStore.getState().appendLocalLog("export me");
  vi.mocked(invoke).mockRejectedValue("native dialog failed");
  await expect(useSessionStore.getState().exportLogs()).resolves.toBe(false);
  expect(useSessionStore.getState().lastError).not.toBeNull();
});
