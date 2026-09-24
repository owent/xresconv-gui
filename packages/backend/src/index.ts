export type { XmlLocation } from "./config/check-well-formed.ts";
export { assertWellFormed, ConfigError, checkWellFormed } from "./config/check-well-formed.ts";
export { parseXmlConfig, resolveWorkDir } from "./config/loader.ts";
export type {
  ConfigDiagnostic,
  DefaultSchemeEntry,
  EventToggle,
  GlobalOption,
  GuiButtonScript,
  GuiConfig,
  Hook,
  ItemOption,
  OutputMatrixRule,
  ParsedConfig,
  TreeCategoryNode,
  TreeItem,
  TreeItemNode,
  TreeNode,
} from "./config/model.ts";
export {
  buildConversionPlan,
  type ConversionOverrides,
  type ConversionPlan,
  type ConversionSelection,
  type ConversionTask,
  PlanBuildError,
} from "./convert/plan-builder.ts";
export {
  buildArgvFallbackCommand,
  encodeTaskLine,
  encodeToken,
  StdinEncodeError,
  tokenizeStdinLine,
} from "./convert/stdin-encoder.ts";
export {
  assertTransition,
  canTransition,
  isTerminal,
  RUN_STATES,
  type RunState,
} from "./domain/run-state.ts";
export {
  type CustomSelectorRules,
  flattenTreeItems,
  matrixRuleMatchesItem,
  resolveSelectorItems,
  type SelectorSchemeRule,
  type SelectorSheetRule,
} from "./domain/selection.ts";
export { formatUnknownError } from "./service/format.ts";
export {
  DEFAULT_SET_NAME_TIMEOUT_MS,
  type LoadConfigOptions,
  loadConfig,
} from "./service/load-config.ts";
export {
  type AppendLogInput,
  type AppendLogOptions,
  createLog4jsSink,
  DEFAULT_LOG_CAPACITY,
  type Log4jsSink,
  type LogEntry,
  type LogHookRunner,
  type LogLevel,
  type LogObject,
  LogPipeline,
} from "./service/log-pipeline.ts";
export {
  MatcherService,
  type MatcherServiceOptions,
  MatcherTimeoutError,
  MatcherWorkerExitError,
} from "./service/matcher-service.ts";
export {
  type BackendAppEvent,
  BackendRpcApp,
  type BackendRpcAppOptions,
  type BackendRpcMethod,
  type BackendSnapshot,
  RpcError,
  type RpcErrorCode,
} from "./service/rpc-app.ts";
export {
  type JavaRunner,
  type RunOptions,
  type RunSummary,
  runConversion,
} from "./service/run.ts";
export {
  type IsolatedSelectorOptions,
  resolveSelectorItemsIsolated,
} from "./service/selection-rule-service.ts";
export {
  ConversionSession,
  type ConversionSessionOptions,
  DEFAULT_PARALLELISM,
  MAX_PARALLELISM,
} from "./service/session.ts";
