/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * One-shot health line emitted by a Node role entry (guardian/backend) and consumed by the supervising process. The guardian nests the backend's line under `backend`, proving the shell -> guardian -> backend spawn chain. Single source of truth; TypeScript types are generated from this file.
 */
export interface NodeHealth {
  ok: boolean;
  role: "guardian" | "backend";
  pid: number;
  node: string;
  protocol_version?: number;
  backend?: NodeHealth;
}
