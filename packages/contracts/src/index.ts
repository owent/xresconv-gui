export type { BackendRpc } from "./generated/backend-rpc.ts";
export type { Envelope } from "./generated/envelope.ts";
export type { ErrorInfo } from "./generated/error-info.ts";
export type { Handshake } from "./generated/handshake.ts";
export type { NodeHealth } from "./generated/node-health.ts";
export type { ScriptInvoke } from "./generated/script-invoke.ts";
export type { ScriptResult } from "./generated/script-result.ts";

export const PROTOCOL_VERSION = 1;

export { ContractError, validate } from "./validators.ts";
