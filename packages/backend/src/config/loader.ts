/** 严格 UTF-8/XML 加载、文档顺序合并与 realpath 包含检查。读取、节点、嵌套和脚本预算保持有界；仅成功解析后提交配置。 */

import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { ConfigError, checkWellFormed } from "./check-well-formed.ts";
import type {
  ConfigDiagnostic,
  DefaultSchemeEntry,
  GuiConfig,
  Hook,
  OutputMatrixRule,
  ParsedConfig,
  TreeCategoryNode,
  TreeItem,
  TreeNode,
} from "./model.ts";

/** convert_to_boolean 的字符串规则：非空且非 no/false/0/disable/disabled（大小写不敏感）。 */
function convertToBoolean(input: string | undefined): boolean {
  if (!input) return false;
  const lower = input.toLowerCase();
  return (
    lower.length > 0 &&
    lower !== "no" &&
    lower !== "false" &&
    lower !== "0" &&
    lower !== "disable" &&
    lower !== "disabled"
  );
}

/** 空白切分(1624-1631：trim 后 split([\s]+) 再过滤空串）。 */
function splitWords(input: string | undefined): string[] {
  return (input ?? "")
    .trim()
    .split(/[\s]+/)
    .filter((x) => !!x);
}

const DEFAULT_HOOK_TIMEOUT_MS = 30000; //  等
// 字节预算是防误配的保护上界，不是功能限制（03 册）。100k 条目压力用例的单文件
// XML 约 11 MiB（ 基线 10.8 MiB），故单文件上限须覆盖它；取值与 ipc/guardian
// 的 64/128 MiB 帧预算同尺度，仍保持有界。
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_INCLUDE_DEPTH = 64;
const MAX_FILES = 1024;
const MAX_XML_NODES = 1_000_000;
const MAX_XML_DEPTH = 100; // Preserve fast-xml-parser 5.11.1's existing default.
const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_TOTAL_SCRIPT_BYTES = 8 * 1024 * 1024;
const SCRIPT_TAGS = new Set([
  "set_name",
  "on_before_convert",
  "on_after_convert",
  "on_append_log",
  "script",
]);

/** 需要强制数组形态的子标签（isArray 回调查表）。 */
const ARRAY_TAGS: Record<string, true> = {
  include: true,
  output_type: true,
  proto_file: true,
  java_option: true,
  option: true,
  default_scheme: true,
  item: true,
  tree: true,
  group: true,
  scheme: true,
  on_before_convert: true,
  on_after_convert: true,
  on_append_log: true,
  script: true,
  data_src_dir: true,
  data_source_dir: true,
  category: true,
  list: true,
};

// XMLParser.parse 无状态可复用，模块级单例。
const PARSER = new XMLParser({
  maxNestedTags: MAX_XML_DEPTH,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  // 不 trim：标量字段在代码内显式 trim（对齐 .html.trim），
  // 脚本文本保留原文（仅实体解码，对齐 .html）。
  trimValues: false,
  // 保持默认 true：标准 XML 实体解码；外部实体被解析器直接拒绝。
  processEntities: true,
  isArray: (name) => ARRAY_TAGS[name] === true,
});

type RawNode = string | Record<string, unknown>;

function asArray(value: unknown): RawNode[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as RawNode[]) : [value as RawNode];
}

/** 取标签文本：无属性时为裸字符串，有属性时在 #text 键（fxp 行为，已实测）。 */
function textOf(node: RawNode): string {
  if (typeof node === "string") return node;
  const text = node["#text"];
  return typeof text === "string" ? text : "";
}

function attrOf(node: RawNode, name: string): string | undefined {
  if (typeof node === "string") return undefined;
  const value = node[`@${name}`];
  return typeof value === "string" ? value : undefined;
}

/** 子元素对象；`<x/>`/纯文本节点返回空对象。 */
function objOf(node: RawNode): Record<string, unknown> {
  return typeof node === "string" ? {} : node;
}

/** 遍历子元素：跳过属性键与 #text。 */
function childEntries(node: RawNode): Array<[string, RawNode[]]> {
  const entries: Array<[string, RawNode[]]> = [];
  for (const [key, value] of Object.entries(objOf(node))) {
    if (key.startsWith("@") || key === "#text") continue;
    entries.push([key, asArray(value)]);
  }
  return entries;
}

/** 合并中间态（对应 conv_data 的可变部分）。 */
interface MergeState {
  totalBytes: number;
  xmlNodes: number;
  scriptBytes: number;
  filesRead: number;
  diagnostics: ConfigDiagnostic[];
  loaded: Set<string>;
  visiting: string[];
  loadedFiles: string[];
  workDir?: string;
  workDirSourceDir?: string;
  xresloaderPath?: string;
  protoFile: string[];
  outputDir?: string;
  dataVersion?: string;
  dataSrcDir: string[];
  rename?: string;
  proto?: string;
  outputMatrix: OutputMatrixRule[];
  globalOptions: ParsedConfig["globalOptions"];
  javaOptions: string[];
  defaultScheme: DefaultSchemeEntry[];
  /** default_scheme 补缺用的按键分组（与 defaultScheme 数组同序构建）。 */
  defaultSchemeByKey: Map<string, string[]>;
  gui: GuiConfig;
  tree: TreeNode[];
  /** category id → 节点（ 的 cat_map）。 */
  catMap: Map<string, TreeCategoryNode>;
}

/** Count all elements, including ignored tags, without recursive JS stack growth. */
function checkDocumentBudget(
  document: Record<string, unknown>,
  file: string,
  state: MergeState,
): void {
  const pending: { node: RawNode; tag: string; depth: number }[] = [];
  const append = (node: RawNode, depth: number) => {
    for (const [tag, nodes] of childEntries(node)) {
      if (tag.startsWith("?")) continue;
      for (const child of nodes) pending.push({ node: child, tag, depth });
    }
  };
  append(document, 1);
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (++state.xmlNodes > MAX_XML_NODES || current.depth > MAX_XML_DEPTH)
      throw new ConfigError("CONFIG_LIMIT", `${file}: XML element count/depth budget exceeded`, {
        path: file,
        budget: current.depth > MAX_XML_DEPTH ? "xmlDepth" : "xmlNodes",
      });
    if (SCRIPT_TAGS.has(current.tag)) {
      const bytes = Buffer.byteLength(textOf(current.node), "utf8");
      state.scriptBytes += bytes;
      if (bytes > MAX_SCRIPT_BYTES || state.scriptBytes > MAX_TOTAL_SCRIPT_BYTES)
        throw new ConfigError("CONFIG_LIMIT", `${file}: script text budget exceeded`, {
          path: file,
          budget: "scriptBytes",
        });
    }
    append(current.node, current.depth + 1);
  }
}

function parseTimeout(
  raw: string | undefined,
  file: string,
  diagnostics: ConfigDiagnostic[],
): number {
  if (!raw) return DEFAULT_HOOK_TIMEOUT_MS;
  const parsed = Number(raw);
  if (
    !/^\s*\d+\s*$/.test(raw) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 2147481647
  ) {
    // ： NaN 会原样流入 vm 选项；回退默认值并记录诊断。
    diagnostics.push({
      file,
      message: `timeout 属性 "${raw}" 无法解析为整数，回退默认值 ${DEFAULT_HOOK_TIMEOUT_MS}`,
    });
    return DEFAULT_HOOK_TIMEOUT_MS;
  }
  return parsed;
}

function buildHook(node: RawNode, file: string, diagnostics: ConfigDiagnostic[]): Hook {
  const name = attrOf(node, "name") ?? "";
  const checkedAttr = attrOf(node, "checked");
  const mutableAttr = attrOf(node, "mutable");
  const checked = checkedAttr ? convertToBoolean(checkedAttr) : true;
  const hook: Hook = {
    source: textOf(node),
    timeoutMs: parseTimeout(attrOf(node, "timeout"), file, diagnostics),
    filename: file,
    // 无 name → 布尔开关值；有 name → 初始等于 toggle.checked。
    enabled: checked,
  };
  if (name.length > 0) {
    hook.toggle = {
      name,
      checked,
      mutable: mutableAttr ? convertToBoolean(mutableAttr) : true,
    };
  }
  return hook;
}

/** 解析期 work_dir 相对化(以声明文件目录为基准）。 */
function resolveWorkDirValue(
  workDir: string | undefined,
  sourceDir: string | undefined,
  fallbackDir: string,
): string | undefined {
  if (!workDir) return undefined;
  if (path.isAbsolute(workDir)) return path.normalize(workDir);
  return path.resolve(sourceDir ?? fallbackDir, workDir);
}

function applyGlobalTag(
  tag: string,
  node: RawNode,
  file: string,
  state: MergeState,
  perFile: {
    protoFile: string[];
    dataSrcPresent: boolean;
    dataSrcValues: string[];
    matrix: OutputMatrixRule[];
  },
): void {
  //  HTML 解析标签名大小写不敏感并统一 toLowerCase；
  // 严格 XML 仅认小写标签，其余进 diagnostics。
  const val = textOf(node).trim();
  switch (tag) {
    case "work_dir":
      state.workDir = val;
      state.workDirSourceDir = path.dirname(file);
      break;
    case "xresloader_path":
      state.xresloaderPath = val;
      break;
    case "proto_file": // 无条件 push（含空串）
      perFile.protoFile.push(val);
      break;
    case "output_dir":
      state.outputDir = val;
      break;
    case "data_version":
      state.dataVersion = val;
      break;
    case "data_src_dir":
    case "data_source_dir": // 完全等价别名；标签出现即重置，仅非空值入列
      perFile.dataSrcPresent = true;
      if (val) perFile.dataSrcValues.push(val);
      break;
    case "rename":
      state.rename = val;
      break;
    case "proto": // （未知协议的 UI 提示属表现层）
      state.proto = val;
      break;
    case "output_type":
      perFile.matrix.push({
        type: val || undefined,
        rename: (attrOf(node, "rename") ?? "").trim() || undefined,
        outputDir: attrOf(node, "output_dir") || undefined, // 不 trim
        tags: splitWords(attrOf(node, "tag")),
        classes: splitWords(attrOf(node, "class")),
      });
      break;
    case "option": // 空 value 忽略；name/desc 回退 value
      if (val) {
        state.globalOptions.push({
          name: attrOf(node, "name") || val,
          desc: attrOf(node, "desc") || val,
          value: val,
        });
      }
      break;
    case "java_option": // 空 value 忽略，跨文件累积
      if (val) state.javaOptions.push(val);
      break;
    case "default_scheme": {
      // 空 value 忽略；name trim 后为空忽略
      if (!val) break;
      const key = (attrOf(node, "name") ?? "").trim();
      if (!key) break;
      const entry: DefaultSchemeEntry = { name: key, value: val };
      const desc = attrOf(node, "desc");
      if (desc !== undefined) entry.desc = desc;
      state.defaultScheme.push(entry);
      const bucket = state.defaultSchemeByKey.get(key);
      if (bucket) bucket.push(val);
      else state.defaultSchemeByKey.set(key, [val]);
      break;
    }
    default:
      // 静默忽略未识别标签；收集诊断，含大小写不匹配场景。
      state.diagnostics.push({ file, tag, message: `<global> 未识别的标签 <${tag}> 已忽略` });
  }
}

function applyCategory(root: RawNode, state: MergeState): void {
  const build = (node: RawNode): TreeCategoryNode => {
    const id = attrOf(node, "id");
    const name = attrOf(node, "name") || id || "";
    const category: TreeCategoryNode = { kind: "category", name, children: [] };
    if (id !== undefined) category.id = id;
    // 有 id 登记 cat_map（后写覆盖）
    if (id) state.catMap.set(id, category);
    for (const child of asArray(objOf(node).tree)) {
      category.children.push(build(child));
    }
    return category;
  };
  for (const categoryRoot of asArray(objOf(root).category)) {
    for (const treeNode of asArray(objOf(categoryRoot).tree)) {
      state.tree.push(build(treeNode));
    }
  }
}

function applyGui(root: RawNode, file: string, state: MergeState): void {
  // 每文件清空重建 gui(1484-1486、1580）；include 先应用，
  // 故最终生效的是最后应用文件（入口文件）的 gui 块（BD)。
  const gui: GuiConfig = {
    onBeforeConvert: [],
    onAfterConvert: [],
    onAppendLog: [],
    scripts: Object.create(null),
  };
  // gui script 的 work_dir 在该文件 global 应用后快照（ → 1598）
  const workDirSnapshot =
    resolveWorkDirValue(state.workDir, state.workDirSourceDir, path.dirname(file)) ?? "";

  for (const guiRoot of asArray(objOf(root).gui)) {
    const guiObj = objOf(guiRoot);

    for (const node of asArray(guiObj.set_name)) {
      // 后写覆盖（非数组）
      if (gui.setName) {
        state.diagnostics.push({
          file,
          tag: "set_name",
          message: "set_name 多次定义，后写覆盖",
        });
      }
      gui.setName = { source: textOf(node), filename: file };
    }
    for (const node of asArray(guiObj.on_before_convert)) {
      gui.onBeforeConvert.push(buildHook(node, file, state.diagnostics));
    }
    for (const node of asArray(guiObj.on_after_convert)) {
      gui.onAfterConvert.push(buildHook(node, file, state.diagnostics));
    }
    for (const node of asArray(guiObj.on_append_log)) {
      gui.onAppendLog.push(buildHook(node, file, state.diagnostics));
    }
    for (const node of asArray(guiObj.script)) {
      // 按 name 存 Record，缺省 ""
      const name = attrOf(node, "name") || "";
      gui.scripts[name] = {
        name,
        source: textOf(node),
        timeoutMs: parseTimeout(attrOf(node, "timeout"), file, state.diagnostics),
        workDir: workDirSnapshot,
        filename: file,
      };
    }
  }
  state.gui = gui;
}

function applyItems(root: RawNode, file: string, state: MergeState): void {
  for (const listRoot of asArray(objOf(root).list)) {
    for (const node of asArray(objOf(listRoot).item)) {
      const name = (attrOf(node, "name") ?? "").trim(); // ：缺 name 属性安全缺省 ""
      const item: TreeItem = {
        file: attrOf(node, "file"),
        scheme: attrOf(node, "scheme"),
        name,
        cat: attrOf(node, "cat"),
        options: [],
        // name || desc || ""
        desc: name || (attrOf(node, "desc") ?? "").trim() || "",
        schemeData: Object.create(null),
        tags: splitWords(attrOf(node, "tag")),
        classes: splitWords(attrOf(node, "class")),
      };

      for (const optionNode of asArray(objOf(node).option)) {
        // name/desc 原样（可 undefined），value trim
        const option: { name?: string; desc?: string; value: string } = {
          value: textOf(optionNode).trim(),
        };
        const optionName = attrOf(optionNode, "name");
        const optionDesc = attrOf(optionNode, "desc");
        if (optionName !== undefined) option.name = optionName;
        if (optionDesc !== undefined) option.desc = optionDesc;
        item.options.push(option);
      }

      for (const schemeNode of asArray(objOf(node).scheme)) {
        const key = (attrOf(schemeNode, "name") ?? "").trim();
        if (!key) {
          // ：此处会抛 TypeError 中断加载；跳过并记录。
          state.diagnostics.push({
            file,
            tag: "scheme",
            message: `<scheme> 缺少 name 属性，已忽略（item "${name}"）`,
          });
          continue;
        }
        const value = textOf(schemeNode); // 值不 trim
        let bucket = item.schemeData[key];
        if (bucket === undefined) {
          bucket = [];
          item.schemeData[key] = bucket;
        }
        bucket.push(value);

        // DataSource 特例：name 大小写不敏感等于 datasource
        if (key.toLowerCase() === "datasource") {
          const parts = value.split("|");
          if (parts.length > 1) {
            item.file = parts[0]; // 第 2 段为表名（展示用途，不进模型，BD)
          } else {
            item.file = parts[0];
          }
          // 注意：不设置 item.scheme
        }
      }

      // default_scheme 补缺：仅 item 自身无该 key 时填入；
      // 补缺拷贝数组而非共享引用（BD)。
      for (const [key, values] of state.defaultSchemeByKey) {
        if (!item.schemeData[key]) {
          item.schemeData[key] = [...values];
        }
      }

      // cat 命中 cat_map 挂分类，否则挂根
      const leaf: TreeNode = { kind: "item", item };
      const parent = item.cat ? state.catMap.get(item.cat) : undefined;
      if (parent) parent.children.push(leaf);
      else state.tree.push(leaf);
    }
  }
}

async function loadFile(file: string, state: MergeState): Promise<void> {
  // ：判重键为 path.resolve 规范化路径（为字面字符串键，U4）
  const resolved = path.resolve(file);
  let identity: string;
  try {
    identity = await realpath(resolved);
  } catch (err) {
    throw new ConfigError("READ_FAILED", `读取配置文件失败: ${resolved}: ${String(err)}`, {
      path: resolved,
    });
  }

  const cycleAt = state.visiting.indexOf(identity);
  if (cycleAt >= 0) {
    const chain = [...state.visiting.slice(cycleAt), resolved];
    throw new ConfigError("INCLUDE_CYCLE", `include 循环: ${chain.join(" -> ")}`, {
      chain,
      path: resolved,
    });
  }
  if (state.loaded.has(identity)) {
    // ： alert 后跳过；确定性硬错误
    throw new ConfigError(
      "INCLUDE_DUPLICATE",
      `文件 ${resolved} 已被加载过，不能重复 include（已加载链: ${[...state.visiting, resolved].join(" -> ")}）`,
      { path: resolved, chain: [...state.visiting, resolved], loadedFiles: [...state.loadedFiles] },
    );
  }

  if (state.visiting.length >= MAX_INCLUDE_DEPTH || state.filesRead >= MAX_FILES) {
    throw new ConfigError("CONFIG_LIMIT", `${resolved}: include depth/file budget exceeded`, {
      path: resolved,
    });
  }
  state.filesRead++;
  state.visiting.push(identity);
  try {
    let content: string;
    try {
      const handle = await open(resolved, "r");
      try {
        const size = (await handle.stat()).size;
        const budget = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - state.totalBytes);
        if (size > budget)
          throw new ConfigError("CONFIG_LIMIT", `${resolved}: XML byte budget exceeded`, {
            path: resolved,
          });
        const buffer = Buffer.alloc(Math.min(size, budget) + 1);
        let length = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
          if (bytesRead === 0) break;
          length += bytesRead;
          if (length === buffer.length)
            throw new ConfigError("CONFIG_LIMIT", `${resolved}: XML grew beyond its read budget`, {
              path: resolved,
            });
        }
        state.totalBytes += length;
        content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
      } finally {
        await handle.close();
      }
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ConfigError(
        "READ_FAILED",
        `读取配置文件失败: ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
        { path: resolved },
      );
    }

    const location = checkWellFormed(content);
    if (location) {
      throw new ConfigError(
        "INVALID_XML",
        `${resolved}: XML 格式错误 (line ${location.line}, column ${location.column})`,
        { path: resolved, line: location.line, column: location.column },
      );
    }

    let document: Record<string, unknown>;
    try {
      document = PARSER.parse(content) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof Error && err.message === "Maximum nested tags exceeded")
        throw new ConfigError("CONFIG_LIMIT", `${resolved}: XML depth budget exceeded`, {
          path: resolved,
          budget: "xmlDepth",
        });
      // 含 DOCTYPE 外部实体等解析期拒绝（fxp："External entities are not supported"，
      // 外部实体不触发文件或网络读取。
      throw new ConfigError(
        "INVALID_XML",
        `${resolved}: XML 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        { path: resolved },
      );
    }

    const rootKeys = Object.keys(document).filter((key) => !key.startsWith("?") && key !== "#text");
    if (rootKeys.length !== 1 || rootKeys[0] !== "root" || Array.isArray(document.root)) {
      throw new ConfigError("INVALID_XML", `${resolved}: expected exactly one <root> element`, {
        path: resolved,
      });
    }
    checkDocumentBudget(document, resolved, state);
    const root = objOf(document.root as RawNode);

    // 先按 DFS 文档顺序应用全部 include，再应用本文件，保持确定性覆盖顺序。
    for (const includeNode of asArray(root.include)) {
      // 包含路径去除首尾空白后解析。
      const includePath = textOf(includeNode).trim();
      if (!includePath) continue; // 空 include 跳过
      // 相对路径以**声明文件所在目录**为基准(path.resolve 兼做规范化）
      await loadFile(path.resolve(path.dirname(resolved), includePath), state);
    }

    state.visiting.pop();
    state.loaded.add(identity);
    state.loadedFiles.push(resolved);

    // 应用本文件（父覆盖子的 DOM 级全局配置；数组类累积）----
    const perFile = {
      protoFile: [] as string[],
      dataSrcPresent: false,
      dataSrcValues: [] as string[],
      matrix: [] as OutputMatrixRule[],
    };
    for (const globalRoot of asArray(root.global)) {
      for (const [tag, nodes] of childEntries(globalRoot)) {
        for (const node of nodes) {
          applyGlobalTag(tag, node, resolved, state, perFile);
        }
      }
    }
    // proto_file：文件内含标签（含空值）即整体替换
    if (perFile.protoFile.length > 0) state.protoFile = perFile.protoFile;
    // data_src_dir/data_source_dir：标签出现即重置（含空标签 → 空数组，B7 语义)
    if (perFile.dataSrcPresent) state.dataSrcDir = perFile.dataSrcValues;
    // output_type 矩阵：每个文件都重写
    state.outputMatrix = perFile.matrix;

    applyCategory(root, state);
    applyGui(root, resolved, state);
    applyItems(root, resolved, state);
  } finally {
    // visiting 弹出需与 push 配对；正常路径已 pop，异常路径在此兜底
    const index = state.visiting.lastIndexOf(identity);
    if (index >= 0) state.visiting.splice(index, 1);
  }
}

/**
 * 解析 XML 配置文件（含 include 图展开合并）。
 * @param absPath 入口文件路径（内部会 path.resolve 规范化）。
 * @throws ConfigError code ∈ READ_FAILED | INVALID_XML | INCLUDE_CYCLE | INCLUDE_DUPLICATE
 */
export async function parseXmlConfig(absPath: string): Promise<ParsedConfig> {
  const entry = path.resolve(absPath);
  const state: MergeState = {
    totalBytes: 0,
    xmlNodes: 0,
    scriptBytes: 0,
    filesRead: 0,
    diagnostics: [],
    loaded: new Set(),
    visiting: [],
    loadedFiles: [],
    protoFile: [],
    dataSrcDir: [],
    outputMatrix: [],
    globalOptions: [],
    // 初始隐含值（ reset_conv_data）：模型内含，调用方不再另行补
    javaOptions: ["-Dfile.encoding=UTF-8"],
    defaultScheme: [],
    defaultSchemeByKey: new Map(),
    gui: { onBeforeConvert: [], onAfterConvert: [], onAppendLog: [], scripts: {} },
    tree: [],
    catMap: new Map(),
  };

  await loadFile(entry, state);

  const config: ParsedConfig = {
    path: entry,
    dir: path.dirname(entry),
    protoFile: state.protoFile,
    dataSrcDir: state.dataSrcDir,
    outputMatrix: state.outputMatrix,
    globalOptions: state.globalOptions,
    javaOptions: state.javaOptions,
    defaultScheme: state.defaultScheme,
    gui: state.gui,
    tree: state.tree,
    diagnostics: state.diagnostics,
    loadedFiles: state.loadedFiles,
  };
  if (state.workDir !== undefined) config.workDir = state.workDir;
  if (state.workDirSourceDir !== undefined) config.workDirSourceDir = state.workDirSourceDir;
  if (state.xresloaderPath !== undefined) config.xresloaderPath = state.xresloaderPath;
  if (state.outputDir !== undefined) config.outputDir = state.outputDir;
  if (state.dataVersion !== undefined) config.dataVersion = state.dataVersion;
  if (state.rename !== undefined) config.rename = state.rename;
  if (state.proto !== undefined) config.proto = state.proto;
  return config;
}

/**
 * 取有效工作目录（绝对路径）：相对值以 workDir 声明文件目录为基准
 * （解析期相对化)；未配置返回 undefined。
 */
export function resolveWorkDir(config: ParsedConfig): string | undefined {
  return resolveWorkDirValue(config.workDir, config.workDirSourceDir, config.dir);
}
