/** 根据运行开始时的已选条目与输出资格构造转换任务，保留参数顺序和全局回退。校验 JAR 与输出冲突，生成 argv / stdin 执行数据。 */

import { existsSync } from "node:fs";
import path from "node:path";
import { resolveWorkDir } from "../config/loader.ts";
import type { OutputMatrixRule, ParsedConfig, TreeItem } from "../config/model.ts";
import { isMatrixMode, matrixRuleMatchesItem } from "../domain/selection.ts";
import { tokenizeStdinLine } from "./stdin-encoder.ts";

/** ConfigError 风格的计划构建错误（code + details）。 */
export class PlanBuildError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PlanBuildError";
    this.code = code;
    this.details = details;
  }
}

/** 单个转换任务。 */
export interface ConversionTask {
  /** 完整业务 argv（不含 JVM 参数与 -jar/--stdin），按 token 切分完毕。 */
  argv: string[];
  /** 来源 item 的 name（模型无独立 id， 的 id 为 GUI 运行时身份）。 */
  itemKey?: string;
  /** 本任务生效的输出类型(t 值；缺省时未发 -t）。冲突预览分组用。 */
  type?: string;
  /** 本任务生效的输出目录(o 值；缺省时未发 -o）。 */
  outputDir?: string;
  /** 本任务生效的 rename 规则(n 值；缺省时未发 -n）。冲突预览分组用。 */
  rename?: string;
  /** 旧式单行展示串（仅日志用，对齐  的拼接形态）。 */
  display: string;
}

/** 一份可执行的转换计划。 */
export interface ConversionPlan {
  /** 有效工作目录（resolveWorkDir 一次解析；未配置时回退入口文件目录）。 */
  workDir: string;
  /** xresloader JAR 路径（原值，可能相对 workDir）。 */
  xresloaderPath: string;
  /** JVM 参数（含模型内置的 -Dfile.encoding=UTF-8)。 */
  javaArgs: string[];
  /** 任务列表，派发顺序 = 数组顺序（FIFO，BD)。 */
  tasks: ConversionTask[];
}

/** 显式勾选集合（三态级联由 UI 层完成，此处只消费最终列表）。 */
export interface ConversionSelection {
  items: TreeItem[];
}

/**
 * UI 覆盖值（对应 conv_start 读取的输入框)。
 * undefined = 未覆盖（用配置默认值）；空串/空数组 = 用户清空（生效为空）。
 *  扩展：workDir/xresloaderPath/protoFile/dataSrcDir/matrix。
 */
export interface ConversionOverrides {
  outputDir?: string;
  rename?: string;
  type?: string;
  proto?: string;
  dataVersion?: string;
  /**
   * work_dir 覆盖：相对路径按入口文件目录解析；
   * 空串 = 用户清空，视为未设置并回退入口文件目录。
   */
  workDir?: string;
  /** xresloader 路径覆盖；空串 = 用户清空 → 存在性检查失败（XRESLOADER_NOT_FOUND，同 BD- 未配置语义）。 */
  xresloaderPath?: string;
  /** proto_file 覆盖列表（每值一条 -f）；空数组 = 不发 -f（与  冻结行为一致）。 */
  protoFile?: string[];
  /** data_src_dir 覆盖列表（每值一条 -d）；空数组 = 不发 -d。 */
  dataSrcDir?: string[];
  /** 输出矩阵覆盖；空数组 = 清空矩阵（回到单类型模式）。 */
  matrix?: OutputMatrixRule[];
}

/**
 * 表单有效值快照(配置默认 ⊕ overrides 合并后的全量字段）。
 * 字符串字段无配置且无覆盖时回退 ""（对齐表单 `.val` 空串）；
 * type/rename 的缺省回退链与 resolveEffectiveRules 完全一致。
 */
export interface EffectiveSettings {
  /** 有效工作目录（已按入口目录相对化）。 */
  workDir: string;
  /** xresloader 路径原值（可能相对 workDir）。 */
  xresloaderPath: string;
  proto: string;
  dataVersion: string;
  outputDir: string;
  rename: string;
  type: string;
  protoFile: string[];
  dataSrcDir: string[];
  matrix: OutputMatrixRule[];
}

/** 矩阵规则回退全局值后的有效形态（ 的 `output.type || global` 等）。 */
interface EffectiveRule {
  type?: string;
  rename?: string;
  outputDir?: string;
  tags: string[];
  classes: string[];
}

/** 下载提示；headless 场景去掉了 HTML 链接标签（BD)。 */
const XRESLOADER_DOWNLOAD_HINT =
  "you can download it from https://github.com/xresloader/xresloader/releases";

/**
 * 有效工作目录：overrides.workDir 的相对值按入口文件目录解析，
 * 空串 = 用户清空 → 回退入口文件目录；undefined → 配置 work_dir
 * （resolveWorkDir）再回退入口目录。
 */
export function resolveEffectiveWorkDir(
  config: ParsedConfig,
  overrides: ConversionOverrides,
): string {
  const override = overrides.workDir;
  if (override !== undefined) {
    if (override === "") {
      return config.dir;
    }
    return path.isAbsolute(override)
      ? path.normalize(override)
      : path.resolve(config.dir, override);
  }
  return resolveWorkDir(config) ?? config.dir;
}

/**
 * 表单有效值快照：配置默认 ⊕ overrides 的全量字段。
 * type/rename 缺省回退链与 resolveEffectiveRules 同规则（单类型模式取矩阵首条，
 * ；矩阵模式全局类型缺省 "bin"）。
 */
export function resolveEffectiveSettings(
  config: ParsedConfig,
  overrides: ConversionOverrides,
): EffectiveSettings {
  const matrix = overrides.matrix ?? config.outputMatrix;
  const first = matrix[0];
  const single = !isMatrixMode(matrix);
  return {
    workDir: resolveEffectiveWorkDir(config, overrides),
    xresloaderPath: overrides.xresloaderPath ?? config.xresloaderPath ?? "",
    proto: overrides.proto ?? config.proto ?? "",
    dataVersion: overrides.dataVersion ?? config.dataVersion ?? "",
    outputDir: overrides.outputDir ?? config.outputDir ?? "",
    rename: overrides.rename ?? (single ? (first?.rename ?? config.rename) : config.rename) ?? "",
    type: overrides.type ?? (single ? first?.type : undefined) ?? "bin",
    protoFile: overrides.protoFile ?? config.protoFile,
    dataSrcDir: overrides.dataSrcDir ?? config.dataSrcDir,
    matrix,
  };
}

/**
 * 矩阵规则回退全局值后的有效形态（ 的 `output.type || global` 等）。
 * 矩阵来源：overrides.matrix 覆盖优先，否则配置矩阵。
 */
function resolveEffectiveRules(
  config: ParsedConfig,
  overrides: ConversionOverrides,
  globalOutputDir: string | undefined,
): EffectiveRule[] {
  const matrix = overrides.matrix ?? config.outputMatrix;
  const first = matrix[0];

  if (!isMatrixMode(matrix)) {
    // 单类型模式（ + 1397-1418）：类型默认取矩阵首条，再缺省 "bin"
    // （index.html:146 下拉框 selected 默认值）；rename 默认取矩阵首条。
    const type = overrides.type ?? first?.type ?? "bin";
    const rename = overrides.rename ?? first?.rename ?? config.rename;
    return [
      {
        type: type || undefined,
        rename: rename || undefined,
        outputDir: globalOutputDir,
        tags: [],
        classes: [],
      },
    ];
  }

  // 矩阵模式：逐条回退全局值。全局类型缺省 "bin"（下拉框默认）。
  const globalType = overrides.type ?? "bin";
  const globalRename = overrides.rename ?? config.rename;
  return matrix.map((rule) => ({
    type: rule.type || globalType,
    rename: rule.rename || globalRename || undefined,
    outputDir: rule.outputDir || globalOutputDir,
    tags: rule.tags,
    classes: rule.classes,
  }));
}

/**
 * 构建转换计划。
 *
 * @throws PlanBuildError code "XRESLOADER_NOT_FOUND"：xresloaderPath 未配置，
 *   或绝对路径自身不存在 / 相对路径 join(workDir) 后不存在。
 */
export function buildConversionPlan(
  config: ParsedConfig,
  selection: ConversionSelection,
  overrides: ConversionOverrides = {},
): ConversionPlan {
  // 未配置工作目录时回退到入口文件目录。
  // overrides.workDir 覆盖走同一相对解析。
  const workDir = resolveEffectiveWorkDir(config, overrides);

  // overrides.xresloaderPath 覆盖走同一存在性检查（空串 = 用户清空 → 失败，同未配置）。
  const xresloaderPath = overrides.xresloaderPath ?? config.xresloaderPath;
  const xresloaderExists = xresloaderPath
    ? path.isAbsolute(xresloaderPath)
      ? existsSync(xresloaderPath)
      : existsSync(path.join(workDir, xresloaderPath))
    : false;
  if (!xresloaderPath || !xresloaderExists) {
    throw new PlanBuildError(
      "XRESLOADER_NOT_FOUND",
      `[${workDir}] ${xresloaderPath ?? ""} not exists, ${XRESLOADER_DOWNLOAD_HINT}`,
      { workDir, xresloaderPath },
    );
  }

  const globalOutputDir = overrides.outputDir ?? config.outputDir;
  const rules = resolveEffectiveRules(config, overrides, globalOutputDir || undefined);

  // 全局前缀，argv token 与旧式展示串同步构建。
  const prefixArgv: string[] = [];
  const prefixDisplay: string[] = [];
  const proto = overrides.proto ?? config.proto;
  if (proto) {
    prefixArgv.push("-p", proto);
    prefixDisplay.push(`-p "${proto}"`);
  }
  const dataVersion = overrides.dataVersion ?? config.dataVersion;
  if (dataVersion) {
    prefixArgv.push("-a", dataVersion);
    prefixDisplay.push(`-a "${dataVersion}"`);
  }
  for (const option of config.globalOptions) {
    if (option.value) {
      // 原始片段经同形 tokenizer 切分（由 Java 在整行上切分，语义一致）。
      prefixArgv.push(...tokenizeStdinLine(option.value));
      prefixDisplay.push(option.value);
    }
  }
  for (const file of overrides.protoFile ?? config.protoFile) {
    prefixArgv.push("-f", file);
    prefixDisplay.push(`-f "${file}"`);
  }
  for (const dir of overrides.dataSrcDir ?? config.dataSrcDir) {
    prefixArgv.push("-d", dir);
    prefixDisplay.push(`-d "${dir}"`);
  }

  const tasks: ConversionTask[] = [];
  for (const item of selection.items) {
    for (const rule of rules) {
      if (!matrixRuleMatchesItem(rule, item)) {
        continue;
      }

      const argv = [...prefixArgv];
      const display = [...prefixDisplay];
      if (rule.type) {
        argv.push("-t", rule.type);
        display.push(`-t "${rule.type}"`);
      }
      if (rule.rename) {
        argv.push("-n", rule.rename);
        display.push(`-n "${rule.rename}"`);
      }
      if (rule.outputDir) {
        argv.push("-o", rule.outputDir);
        display.push(`-o "${rule.outputDir}"`);
      }
      // 空输出目录不发送 -o，避免 JAR 丢失空 token 后将下一个参数当作目录。
      // 丢弃，-o 会错位吞掉下一个 token）。

      for (const option of item.options) {
        if (option.value) {
          argv.push(...tokenizeStdinLine(option.value));
          display.push(option.value);
        }
      }

      if (item.file && item.scheme) {
        argv.push("-s", item.file, "-m", item.scheme);
        display.push(`-s "${item.file}" -m "${item.scheme}"`);
      } else {
        for (const key of Object.keys(item.schemeData)) {
          for (const value of item.schemeData[key] ?? []) {
            argv.push("-m", `${key}=${value}`);
            display.push(`-m "${key}=${value}"`);
          }
        }
      }

      tasks.push({
        argv,
        itemKey: item.name,
        type: rule.type,
        outputDir: rule.outputDir,
        rename: rule.rename,
        display: display.join(" "),
      });
    }
  }

  return {
    workDir,
    xresloaderPath,
    javaArgs: [...config.javaOptions],
    tasks,
  };
}
