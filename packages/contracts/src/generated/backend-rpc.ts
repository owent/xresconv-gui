/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * shell <-> guardian <-> backend business RPC payload (P4-02), carried in envelope kinds `rpc` (request) and `rpc_result` (result); guardian relays `rpc` verbatim to the backend and answers with the backend's `rpc_result` payload (or its own error when the backend cannot serve). Request: `method` + optional `params` (per-method shape validated by the backend, bad params -> INVALID_PARAMS). Result: `ok` true carries `result`, false carries `error`. Error codes — backend: INVALID_PARAMS (schema/params violation), UNKNOWN_METHOD, INVALID_STATE (no config loaded / run active / disposed), CONFIG_ERROR (loadConfig/parse failure), XRESLOADER_NOT_FOUND (preview/plan build: xresloader jar missing, P4-04a), INTERNAL (unexpected); guardian: BACKEND_NOT_READY (no ready backend), BACKEND_DIED (backend lost mid-request), BACKEND_TIMEOUT (request deadline exceeded). Unknown methods/params MUST yield an error result, never a channel fault.
 */
export type BackendRpc =
  | {
      type: "request";
      method:
        | "loadConfig"
        | "reload"
        | "getSnapshot"
        | "applyOps"
        | "updateSettings"
        | "preview"
        | "run"
        | "cancel"
        | "reset"
        | "respondDialog";
      /**
       * Per-method arguments (loadConfig {path}, applyOps {ops}, respondDialog {token, choice}, updateSettings {fields}); omitted means {}.
       */
      params?: {
        [k: string]: unknown | undefined;
      };
    }
  | {
      type: "result";
      ok: boolean;
      /**
       * Method-specific result payload; present when ok is true.
       */
      result?: {
        [k: string]: unknown | undefined;
      };
      error?: {
        code: string;
        message: string;
      };
    };
