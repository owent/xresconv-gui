export type { XmlLocation } from "./config/check-well-formed.js";
export { assertWellFormed, ConfigError, checkWellFormed } from "./config/check-well-formed.js";
export {
  assertTransition,
  canTransition,
  isTerminal,
  RUN_STATES,
  type RunState,
} from "./domain/run-state.js";
