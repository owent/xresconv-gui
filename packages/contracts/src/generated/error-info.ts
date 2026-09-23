/* eslint-disable */
// Generated from packages/contracts/schema/*.json. Do not edit.

/**
 * Structured error returned by every fallible command across all Node roles and the Tauri bridge.
 */
export interface ErrorInfo {
  /**
   * Stable machine-readable code, e.g. config.parse_error
   */
  code: string;
  /**
   * User-actionable message
   */
  message: string;
  /**
   * Optional structured context (file, line, column, ...); any JSON value
   */
  details?: {
    [k: string]: unknown | undefined;
  };
}
