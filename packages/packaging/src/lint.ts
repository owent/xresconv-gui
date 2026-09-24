/**
 * Manifest hygiene lint (PK01): a runtime manifest must never carry
 * developer-machine absolute paths or secrets. Heuristic by design; the
 * release pipeline fails on any finding.
 */

export interface ManifestLintFinding {
  /** JSON pointer of the offending value (RFC 6901). */
  pointer: string;
  /** Stable rule id, e.g. windows-drive-path, secret-key, private-key-block. */
  rule: string;
  /** Truncated offending content for diagnostics. */
  excerpt: string;
}

const SECRET_KEY_PATTERN =
  /(?:pass(?:word|wd)?|secret|token|api[-_]?key|private[-_]?key|credential)/i;
/** Placeholder values like <redacted> under a secret-looking key are allowed. */
const PLACEHOLDER_PATTERN = /^<[^>]+>$/;

const SECRET_VALUE_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: "private-key-block", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { rule: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    rule: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  { rule: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    rule: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

const ABSOLUTE_PATH_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: "windows-drive-path", pattern: /^[A-Za-z]:[\\/]/ },
  { rule: "unc-path", pattern: /^\\\\/ },
  { rule: "unix-user-path", pattern: /^\/(?:Users|home)\// },
];

const EXCERPT_LIMIT = 80;

function excerpt(value: string): string {
  return value.length <= EXCERPT_LIMIT ? value : `${value.slice(0, EXCERPT_LIMIT)}…`;
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Recursively scans any JSON-like value. Returns every finding; an empty
 * array means clean. Independent of schema validation so it can lint
 * arbitrary payloads (including targets.json and partial manifests).
 */
export function lintManifest(value: unknown): ManifestLintFinding[] {
  const findings: ManifestLintFinding[] = [];
  const walk = (node: unknown, pointer: string, key: string | null): void => {
    if (typeof node === "string") {
      if (key !== null && SECRET_KEY_PATTERN.test(key) && node.length > 0) {
        if (!PLACEHOLDER_PATTERN.test(node)) {
          findings.push({ pointer, rule: "secret-key", excerpt: excerpt(node) });
        }
      }
      for (const { rule, pattern } of SECRET_VALUE_RULES) {
        if (pattern.test(node)) {
          findings.push({ pointer, rule, excerpt: excerpt(node) });
        }
      }
      for (const { rule, pattern } of ABSOLUTE_PATH_RULES) {
        if (pattern.test(node)) {
          findings.push({ pointer, rule, excerpt: excerpt(node) });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, `${pointer}/${index}`, null);
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [childKey, child] of Object.entries(node)) {
        walk(child, `${pointer}/${escapePointer(childKey)}`, childKey);
      }
    }
  };
  walk(value, "", null);
  return findings;
}
