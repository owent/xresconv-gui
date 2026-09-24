/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * guardian -> script-worker: execute one legacy script entry (five kinds, tests/fixtures/scripts/contract.md). `context` carries only JSON-serializable data; functions (require/resolve/reject/log_* /alert_*) are reconstructed inside the worker. Button `data` never crosses the wire: it lives in the session worker keyed by button_id.
 */
export interface ScriptInvoke {
  invocation_id: string;
  entry_kind: "set_name" | "on_before_convert" | "on_after_convert" | "button" | "on_append_log";
  filename: string;
  source: string;
  timeout_ms: number;
  button_id?: string;
  log_group_id?: string;
  run_seq?: number;
  /**
   * Entry-specific JSON data: work_dir, configure_file, xresloader_path, item_data (set_name), selected_items/selected_nodes mirror data, global_options (object form for events, array form for buttons), log_object (on_append_log: {message, module_name, style}).
   */
  context: {
    [k: string]: unknown | undefined;
  };
}
