/**
 * Runtime validators for the contract schemas (schema/ is the single source
 * of truth). Every role boundary validates inbound frames with these;
 * generated TS types alone are NOT runtime validation (Plan §4.2).
 */
import { createRequire } from "node:module";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);

const ajv = new Ajv2020({ strict: true, allErrors: true });
const cache = new Map<string, ValidateFunction>();

function loadValidator(name: string): ValidateFunction {
  let validate = cache.get(name);
  if (!validate) {
    const schemaPath = require.resolve(`@xresconv/contracts/schema/${name}.json`);
    const schema = require(schemaPath) as object;
    validate = ajv.compile(schema);
    cache.set(name, validate);
  }
  return validate;
}

export class ContractError extends Error {
  readonly schema: string;
  readonly errors: ErrorObject[] | null | undefined;

  constructor(schema: string, errors: ErrorObject[] | null | undefined) {
    super(
      `contract violation (${schema}): ${(errors ?? [])
        .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
        .join("; ")}`,
    );
    this.name = "ContractError";
    this.schema = schema;
    this.errors = errors;
  }
}

/**
 * Validates value against schema/<name>.json and returns it typed.
 * Throws ContractError listing every violation.
 */
export function validate<T>(name: string, value: unknown): T {
  const validateFn = loadValidator(name);
  if (!validateFn(value)) {
    throw new ContractError(name, validateFn.errors);
  }
  return value as T;
}
