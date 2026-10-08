import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { prepareAppResources, type ResourceProgress } from "../adapters/tauri";

interface StartupSnapshot {
  state: "preparing" | "ready" | "error";
  progress: ResourceProgress;
  error: string | null;
}
const initialProgress: ResourceProgress = {
  phase: "verifying",
  completedBytes: 0,
  totalBytes: 0,
  completedFiles: 0,
  totalFiles: 0,
};
const preview: StartupSnapshot = { state: "ready", progress: initialProgress, error: null };
let snapshot: StartupSnapshot = { state: "preparing", progress: initialProgress, error: null };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(value: StartupSnapshot): void {
  snapshot = value;
  for (const listener of listeners) listener();
}

export function prepareResources(): void {
  if (!isTauri() || pending || snapshot.state === "ready") return;
  publish({ state: "preparing", progress: initialProgress, error: null });
  pending = prepareAppResources((progress) =>
    publish({ state: "preparing", progress, error: null }),
  )
    .then(() => publish({ ...snapshot, state: "ready", error: null }))
    .catch((error: unknown) => publish({ ...snapshot, state: "error", error: String(error) }))
    .finally(() => {
      pending = null;
    });
}

export function useResourceStartup(): StartupSnapshot {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (isTauri() ? snapshot : preview),
  );
  useEffect(prepareResources, []);
  return value;
}

export function resetResourceStartup(): void {
  pending = null;
  snapshot = { state: "preparing", progress: initialProgress, error: null };
}
