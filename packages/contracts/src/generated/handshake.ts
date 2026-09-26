/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * First message exchanged between UI and the Tauri shell: proves the command round-trip and pins the protocol version both sides speak. Single source of truth; TypeScript types are generated from this file.
 */
export interface Handshake {
  name: string;
  version: string;
  protocol_version: number;
}
