/** XML 配置领域模型。字段、顺序和缺省语义由 loader 与测试共同维护。 */

/** `<global><option>` 条目。 name/desc 缺省时回退为 value 本身。 */
export interface GlobalOption {
  /** name 属性；缺省或空串时回退为 value（ `attr("name") || val`）。 */
  name: string;
  /** desc 属性；缺省或空串时回退为 value（ `attr("desc") || val`）。 */
  desc: string;
  /** 标签文本（trim 后）。空 value 的 option 不进入此数组（ `&& val`）。 */
  value: string;
}

/** `<item><option>` 条目。与 GlobalOption 不同：name/desc 原样保留、可为 undefined。 */
export interface ItemOption {
  name?: string;
  desc?: string;
  /** 标签文本 trim 后（ `.html.trim`）。 */
  value: string;
}

/** 一条 `<output_type>` 矩阵规则。 */
export interface OutputMatrixRule {
  /** 标签文本（trim 后）；空串存 undefined，由消费方回退全局输出类型。 */
  type?: string;
  /** rename 属性（trim 后）；空串存 undefined。 */
  rename?: string;
  /** output_dir 属性（**不 trim**)；空串存 undefined。 */
  outputDir?: string;
  /** tag 属性按空白切分。 */
  tags: string[];
  /** class 属性按空白切分。注意 XML 属性名是 class。 */
  classes: string[];
}

/**
 * 事件 Hook 的 UI 开关初始状态（append_conv_list_event_group)。
 * 仅当事件标签带 name 属性时存在：生成复选框，初始勾选/可改状态来自属性。
 */
export interface EventToggle {
  /** name 属性原文。 */
  name: string;
  /** checked 属性经 convert_to_boolean转换；无属性默认 true。 */
  checked: boolean;
  /** mutable 属性经 convert_to_boolean 转换；无属性默认 true。 */
  mutable: boolean;
}

/** on_before_convert / on_after_convert / on_append_log 事件条目。 */
export interface Hook {
  /** 脚本原文（实体已解码、CDATA 原样，**不 trim**，对齐 `$(dom).html`）。 */
  source: string;
  /** timeout 属性 parseInt，缺省 30000（ 等）；非法值回退 30000。 */
  timeoutMs: number;
  /** 声明脚本的 XML 文件绝对路径（ vm.Script filename， 等）。 */
  filename: string;
  /**
   * 初始生效状态：无 name 属性 → checked 属性布尔值（无属性默认 true）；
   * 有 name 属性 → 初始等于 toggle.checked（默认 true），此后开关状态归 UI 层。
   */
  enabled: boolean;
  /** 有 name 属性时的 UI 开关初始状态；无 name 时 undefined。 */
  toggle?: EventToggle;
}

/** `<gui><script>` 自定义按钮脚本。 */
export interface GuiButtonScript {
  /** name 属性，缺省 ""。 */
  name: string;
  /** 脚本原文（不 trim）。 */
  source: string;
  /** timeout 属性 parseInt，缺省 30000。 */
  timeoutMs: number;
  /** 未配置工作目录时回退到入口文件目录。 */
  workDir: string;
  /** 声明脚本的 XML 文件绝对路径。 */
  filename: string;
}

/**
 * gui 块。
 * 每个文件解析时清空重建(1484-1486、1580），且 include 先于本文件应用，
 * 因此最终生效的永远是**最后应用文件（入口文件）**的 gui 块；加载器忠实保留该语义（BD)。
 */
export interface GuiConfig {
  /** set_name：后写覆盖（非数组)；多次定义会进 diagnostics。 */
  setName?: { source: string; filename: string };
  onBeforeConvert: Hook[];
  onAfterConvert: Hook[];
  onAppendLog: Hook[];
  /** 按 name 存 Record，缺省 name 为 ""。 */
  scripts: Record<string, GuiButtonScript>;
}

/** `<default_scheme name>值</default_scheme>` 条目。跨文件累积。 */
export interface DefaultSchemeEntry {
  /** name 属性 trim 后；空 name 的条目被忽略（不进数组）。 */
  name: string;
  /** desc 属性原文（忽略，此处仅保留不丢失文本）。 */
  desc?: string;
  /** 标签文本（trim 后）；空 value 的条目被忽略（ `&& val`）。 */
  value: string;
}

/** list/item 叶子。 */
export interface TreeItem {
  /**
   * 运行时身份（ `generate_id`，每次加载从 1 自增、reload 归零，
   * ）：由 service/load-config.ts 在解析后统一赋值；脚本可见
   * （item_data.id、ft_node.key 同源)。纯解析路径（parseXmlConfig）
   * 不赋值，调用方不得依赖其存在。
   */
  id?: number;
  /** file 属性原文；DataSource 特例可回填。 */
  file?: string;
  /** scheme 属性原文；DataSource **不**设置该字段。 */
  scheme?: string;
  /** name 属性 trim，缺省 ""（缺属性会抛 TypeError，U6；安全缺省)。 */
  name: string;
  /** cat 属性原文（分类 id）。 */
  cat?: string;
  options: ItemOption[];
  /**
   * 基础描述：`name || desc || ""`。
   * 追加的"数据源/Tags/Classes"展示文本属表现层拼接，不进模型（BD)。
   */
  desc: string;
  /**
   * `<scheme name>值</scheme>` 按 name 累积的字符串数组；值**不 trim**。
   * item 缺失的 key 由 default_scheme 补缺（仅当 item 自身无该 key)；
   * 补缺时拷贝数组（共享引用，BD)。
   */
  schemeData: Record<string, string[]>;
  /** tag 属性按空白切分。 */
  tags: string[];
  /** class 属性按空白切分。 */
  classes: string[];
}

/** category/tree 分类节点。 */
export interface TreeCategoryNode {
  kind: "category";
  /** id 属性（item 的 cat 引用它）；缺省 undefined。 */
  id?: string;
  /** name 属性，缺省回退 id，再缺省 ""（ `attr(name)||attr(id)`）。 */
  name: string;
  children: TreeNode[];
}

/** item 叶子节点。 */
export interface TreeItemNode {
  kind: "item";
  item: TreeItem;
}

export type TreeNode = TreeCategoryNode | TreeItemNode;

/** 非致命诊断（未识别标签、大小写不匹配、重复 set_name 等）。 */
export interface ConfigDiagnostic {
  /** 产生诊断的 XML 文件绝对路径。 */
  file: string;
  /** 相关标签名（如适用）。 */
  tag?: string;
  message: string;
}

/**
 * 一份加载完成的配置（include 图已展开合并）。
 * 合并语义：先按 DFS 文档顺序应用全部 include，再应用本文件；
 * DOM 级标量父覆盖子，option/java_option/default_scheme/item/tree 累积。
 */
export interface ParsedConfig {
  /** 入口文件绝对路径（规范化）。 */
  path: string;
  /** 入口文件所在目录。 */
  dir: string;
  /**
   * work_dir **原值**（可能是相对路径）。在解析期与 conv_start 各相对化一次
   * (1900-1906）；模型层存原值，消费方用 resolveWorkDir 取值。
   */
  workDir?: string;
  /** workDir 声明文件所在目录（resolveWorkDir 的相对化基准）；workDir 未设置时无意义。 */
  workDirSourceDir?: string;
  xresloaderPath?: string;
  /** 全部 proto_file 值；按文件替换（含 proto_file 标签的文件整体覆盖先前值)。 */
  protoFile: string[];
  outputDir?: string;
  dataVersion?: string;
  /**
   * data_src_dir / data_source_dir（完全等价别名)非空值列表；
   * 按文件替换：文件出现任一名称的标签即重置（空标签 → 重置为空数组，B7 语义）。
   */
  dataSrcDir: string[];
  rename?: string;
  proto?: string;
  /**
   * output_type 矩阵；按文件替换（每个文件的 active_run 都重写矩阵)。
   * 空数组时的单类型默认 {type:"bin"} 由消费方补齐。
   */
  outputMatrix: OutputMatrixRule[];
  /** 跨文件累积。 */
  globalOptions: GlobalOption[];
  /**
   * JVM 参数。**含初始隐含值 "-Dfile.encoding=UTF-8"**（ reset_conv_data
   * 初始化；模型内含该值，调用方不再另行补）。`<java_option>` 跨文件累积。
   */
  javaOptions: string[];
  /** 跨文件累积，文档顺序。补缺逻辑见 TreeItem.schemeData。 */
  defaultScheme: DefaultSchemeEntry[];
  gui: GuiConfig;
  /** 树：category 嵌套 + item 叶子；跨文件累积，include 的节点在前。 */
  tree: TreeNode[];
  /** 非致命诊断列表。 */
  diagnostics: ConfigDiagnostic[];
  /** 参与合并的全部文件（DFS 完成顺序，即应用顺序），入口文件在最后。 */
  loadedFiles: string[];
}
