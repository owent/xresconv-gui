/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * script-worker -> guardian: terminal result of one invocation. `resolved`/`rejected` come from the legacy resolve/reject protocol (first call wins); `error` is an uncaught synchronous exception; `timeout` is reported by the guardian, never by the worker. `ops` is the ordered list of side effects the script produced (logs, field mutations, dialog requests already answered); guardian/backend apply them in order.
 */
export interface ScriptResult {
  invocation_id: string;
  outcome: "resolved" | "rejected" | "error";
  reason?: string;
  ops?: {
    [k: string]: unknown | undefined;
  }[];
  error?: {
    code: string;
    message: string;
  };
}
