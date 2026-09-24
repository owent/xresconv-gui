export type PackagingErrorCode =
  | "IO_ERROR"
  | "PARSE_ERROR"
  | "SCHEMA_VIOLATION"
  | "DUPLICATE_TARGET"
  | "MISSING_TARGET"
  | "UNEXPECTED_TARGET"
  | "UNKNOWN_TARGET"
  | "FORBIDDEN_ARCH"
  | "INCOHERENT_TARGET"
  | "INVALID_VERSION"
  | "MANIFEST_LINT";

/** All packaging-matrix failures carry a stable machine-readable code (PK01). */
export class PackagingError extends Error {
  readonly code: PackagingErrorCode;
  readonly details: readonly string[];

  constructor(code: PackagingErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "PackagingError";
    this.code = code;
    this.details = details;
  }
}
