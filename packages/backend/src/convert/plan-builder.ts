/**
 * 转换计划构建（P3-05）。
 *
 * 严格对齐旧版 conv_start 的命令生成（main.js:1898-2048）：
 * 全局前缀（-p 协议、-a 版本仅非空，main.js:1911-1913/1945-1947/1955-1960）
 * → globalOptions value 原样（main.js:1962-1966）
 * → -f 每 protoFile 重复（main.js:1968-1978）
 * → -d 每 dataSrcDir 重复（main.js:1980-1992）；
 * 每个选中 item × 每条矩阵规则：资格过滤（check_matrix_rule）
 * → -t/-n/-o（规则值否则全局，main.js:2015-2025）
 * → item options value 原样（main.js:2027-2031）
 * → file+scheme 直给 `-s f -m s`，否则 schemeData 每 key 每 value `-m k=v`（main.js:2033-2043）。
 *
 * 结构性差异（BD-P 编号记录于 docs/plan/records/P3-05.md）：
 * - 旧版把命令拼成字符串交给 Java tokenizer 切分；新版 plan 直接产出 argv token，
 *   其中"原样片段"（global/item option 的 value）经 {@link tokenizeStdinLine}
 *   （Main.java:344-374 同形移植）切分，语义与旧版一致。
 * - 任务派发旧版 push 后 LIFO pop（main.js:2092）；新版保持计划数组顺序 FIFO（BD-P1）。
 *
 * P4-04a：ConversionOverrides 扩展 workDir/xresloaderPath/protoFile/dataSrcDir/matrix
 * （旧版 conv_start 读取的全部输入框），undefined=配置默认、空串/空数组=用户清空生效；
 * 另导出 resolveEffectiveWorkDir/resolveEffectiveSettings 供会话层回填表单有效值。
 */

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
  /** 来源 item 的 name（模型无独立 id，main.js:1612 的 id 为 GUI 运行时身份）。 */
  itemKey?: string;
  /** 本任务生效的输出目录（-o 值；缺省时未发 -o）。 */
  outputDir?: string;
  /** 本任务生效的 rename 规则（-n 值；缺省时未发 -n）。冲突预览分组用（P4-04a）。 */
  rename?: string;
  /** 旧式单行展示串（仅日志用，对齐 main.js:1955-2045 的拼接形态）。 */
  display: string;
}

/** 一份可执行的转换计划。 */
export interface ConversionPlan {
  /** 有效工作目录（resolveWorkDir 一次解析；未配置时回退入口文件目录）。 */
  workDir: string;
  /** xresloader JAR 路径（原值，可能相对 workDir）。 */
  xresloaderPath: string;
  /** JVM 参数（含模型内置的 -Dfile.encoding=UTF-8，main.js:931）。 */
  javaArgs: string[];
  /** 任务列表，派发顺序 = 数组顺序（FIFO，BD-P1）。 */
  tasks: ConversionTask[];
}

/** 显式勾选集合（三态级联由 UI 层完成，此处只消费最终列表）。 */
export interface ConversionSelection {
  items: TreeItem[];
}

/**
 * UI 覆盖值（对应旧版 conv_start 读取的输入框，main.js:1909-1947）。
 * undefined = 未覆盖（用配置默认值）；空串/空数组 = 用户清空（生效为空）。
 * P4-04a 扩展：workDir/xresloaderPath/protoFile/dataSrcDir/matrix。
 */
export interface ConversionOverrides {
  outputDir?: string;
  rename?: string;
  type?: string;
  proto?: string;
  dataVersion?: string;
  /**
   * work_dir 覆盖（main.js:1900-1906）：相对路径按入口文件目录解析；
   * 空串 = 用户清空，视为未设置并回退入口文件目录（BD-P5 等价）。
   */
  workDir?: string;
  /** xresloader 路径覆盖；空串 = 用户清空 → 存在性检查失败（XRESLOADER_NOT_FOUND，同 BD-P4 未配置语义）。 */
  xresloaderPath?: string;
  /** proto_file 覆盖列表（每值一条 -f）；空数组 = 不发 -f（与 P3-05 冻结行为一致）。 */
  protoFile?: string[];
  /** data_src_dir 覆盖列表（每值一条 -d）；空数组 = 不发 -d。 */
  dataSrcDir?: string[];
  /** 输出矩阵覆盖；空数组 = 清空矩阵（回到单类型模式）。 */
  matrix?: OutputMatrixRule[];
}

/**
 * 表单有效值快照（P4-04a，配置默认 ⊕ overrides 合并后的全量字段）。
 * 字符串字段无配置且无覆盖时回退 ""（对齐旧版表单 `.val()` 空串）；
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

/** 矩阵规则回退全局值后的有效形态（main.js:1926-1934 的 `output.type || global` 等）。 */
interface EffectiveRule {
  type?: string;
  rename?: string;
  outputDir?: string;
  tags: string[];
  classes: string[];
}

/** 旧版下载提示（main.js:2067-2068）；headless 场景去掉了 HTML 链接标签（BD-P4）。 */
const XRESLOADER_DOWNLOAD_HINT =
  "you can download it from https://github.com/xresloader/xresloader/releases";

/**
 * 有效工作目录：overrides.workDir 的相对值按入口文件目录解析（main.js:1900-1906），
 * 空串 = 用户清空 → 回退入口文件目录（BD-P5 等价）；undefined → 配置 work_dir
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
 * 表单有效值快照（P4-04a）：配置默认 ⊕ overrides 的全量字段。
 * type/rename 缺省回退链与 resolveEffectiveRules 同规则（单类型模式取矩阵首条，
 * main.js:1397-1422；矩阵模式全局类型缺省 "bin"）。
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
 * 矩阵规则回退全局值后的有效形态（main.js:1926-1934 的 `output.type || global` 等）。
 * 矩阵来源：overrides.matrix 覆盖优先，否则配置矩阵（P4-04a）。
 */
function resolveEffectiveRules(
  config: ParsedConfig,
  overrides: ConversionOverrides,
  globalOutputDir: string | undefined,
): EffectiveRule[] {
  const matrix = overrides.matrix ?? config.outputMatrix;
  const first = matrix[0];

  if (!isMatrixMode(matrix)) {
    // 单类型模式（main.js:1935-1942 + 1397-1418）：类型默认取矩阵首条，再缺省 "bin"
    // （index.html:146 下拉框 selected 默认值）；rename 默认取矩阵首条（main.js:1420-1422）。
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

  // 矩阵模式（main.js:1920-1934）：逐条回退全局值。全局类型缺省 "bin"（下拉框默认）。
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
 *   或绝对路径自身不存在 / 相对路径 join(workDir) 后不存在（main.js:2068-2085）。
 */
export function buildConversionPlan(
  config: ParsedConfig,
  selection: ConversionSelection,
  overrides: ConversionOverrides = {},
): ConversionPlan {
  // 未配置 work_dir 时回退入口文件目录（BD-P5：旧版空串流入 spawn cwd，行为依赖 GUI 进程 cwd）。
  // overrides.workDir 覆盖走同一相对解析（main.js:1900-1906）。
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

  // 全局前缀（main.js:1955-1992），argv token 与旧式展示串同步构建。
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
      // 原始片段经同形 tokenizer 切分（旧版由 Java 在整行上切分，语义一致）。
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
      // 空输出目录不发 -o（BD-P3：旧版发 `-o ""`，空 token 被 Main.java:363-365
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
