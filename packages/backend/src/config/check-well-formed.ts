/**
 * Configuration loading: strict XML parsing, include graph, path rules.
 *
 * BD-07: unlike the legacy GUI (jQuery HTML-tolerant parsing), malformed XML
 * is rejected with a locatable error and never silently loaded.
 *
 * P1 provides the well-formedness boundary and error model; the full
 * configuration model lands in P3 against tests/fixtures/config.
 */

import { XMLValidator } from "fast-xml-parser";

export class ConfigError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.details = details;
  }
}

export interface XmlLocation {
  line: number;
  column: number;
}

/**
 * Strict well-formedness check. Returns null when valid, otherwise the
 * 1-based location of the first error.
 */
export function checkWellFormed(input: string): XmlLocation | null {
  const result = XMLValidator.validate(input, {});
  if (result === true) return null;
  return {
    line: result.err.line,
    column: result.err.col,
  };
}

/** Throws ConfigError with a locatable message when the input is malformed. */
export function assertWellFormed(input: string, source = "<input>"): void {
  const loc = checkWellFormed(input);
  if (loc) {
    throw new ConfigError(
      "config.parse_error",
      `${source}: malformed XML at line ${loc.line}, column ${loc.column}`,
      { source, ...loc },
    );
  }
}
