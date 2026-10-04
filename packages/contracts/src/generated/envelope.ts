/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * Message envelope for shell, guardian, backend and script-worker roles. Correlation fields are optional per kind. Receivers validate payloads with the corresponding schema. TypeScript types are generated from this schema.
 */
export interface Envelope {
  protocol_version: 1;
  kind:
    | "invoke"
    | "complete"
    | "fail"
    | "log"
    | "dialog_request"
    | "dialog_respond"
    | "event"
    | "health"
    | "shutdown"
    | "fault"
    | "rpc"
    | "rpc_result";
  id: string;
  role: "shell" | "guardian" | "backend" | "script-worker" | "compat-service";
  in_reply_to?: string;
  session_id?: string;
  revision?: number;
  run_id?: string;
  invocation_id?: string;
  generation?: number;
  payload: {
    [k: string]: unknown | undefined;
  };
}
