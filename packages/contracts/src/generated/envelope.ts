/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * Universal message envelope between shell/guardian/backend/script-worker roles (Plan 02 §消息 envelope). Correlation fields are optional per kind; payload is validated per kind by the receiving handler against its own schema. Single source of truth; TypeScript types are generated from this file.
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
    | "fault";
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
