/**
 * Run lifecycle state machine (Plan.md §4.3).
 *
 * Idle → Loading → Ready → BeforeHooks → Converting → AfterHooks → Succeeded
 *                  │          │             │           │
 *                  └──────────┴─────────────┴───────────┴→ Failed / Cancelled
 *
 * The Node backend is the single owner of these transitions; the Tauri shell
 * and the UI only display snapshots. No second copy may live in Rust.
 */

export const RUN_STATES = [
  "idle",
  "loading",
  "ready",
  "before_hooks",
  "converting",
  "after_hooks",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RunState = (typeof RUN_STATES)[number];

const TERMINAL: ReadonlySet<RunState> = new Set(["succeeded", "failed", "cancelled"]);

export function isTerminal(state: RunState): boolean {
  return TERMINAL.has(state);
}

/** Legal forward transitions; anything else is a protocol violation. */
const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  idle: ["loading"],
  loading: ["ready", "failed", "cancelled"],
  ready: ["before_hooks", "converting", "cancelled", "loading"],
  before_hooks: ["converting", "failed", "cancelled"],
  converting: ["after_hooks", "failed", "cancelled"],
  after_hooks: ["succeeded", "failed", "cancelled"],
  succeeded: ["idle", "loading"],
  failed: ["idle", "loading"],
  cancelled: ["idle", "loading"],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal run-state transition: ${from} -> ${to}`);
  }
}
