/**
 * F01–F12 功能 → UI 区域映射，P4-01 验收 UI01（“所有 F 功能能映射到明确区域”）的数据载体。
 *
 * - 功能清单来源：Plan.md §5「功能保留与 UI 重构」表（“必须保留的行为”列）。
 * - 区域清单来源：docs/plan/04-ui.md §「页面和组件边界」表。
 * - 旧实现依据：README.md 对应小节与 src/index.html 旧控件 id（旧 UI 仅供对照，见 P4-09）。
 */
export const APP_REGIONS = [
  "EnvironmentStatus",
  "ConversionTree",
  "TreeToolbar",
  "ItemDetails",
  "ConversionSettings",
  "OutputMatrixEditor",
  "HookControls",
  "CustomActionBar",
  "RunControls",
  "LogPanel",
  "DialogHost",
] as const;

export type AppRegion = (typeof APP_REGIONS)[number];

export interface FeatureMapping {
  /** Plan.md §5 的功能 ID */
  readonly id: string;
  /** 必须保留的行为摘要（Plan.md §5） */
  readonly summary: string;
  /** 承载该功能入口的 UI 区域 */
  readonly regions: readonly AppRegion[];
  /** 旧实现依据（README.md 小节 / src/index.html 控件） */
  readonly legacySource: string;
  /** 接线状态：skeleton = 骨架占位；wired = 已接后端（P4-03 起逐项翻 wired）。 */
  readonly status: "skeleton" | "wired";
}

export const FEATURE_MAP: readonly FeatureMapping[] = [
  {
    id: "F01",
    summary: "XML 加载、相对路径、include、循环/重复 include 检测",
    regions: ["EnvironmentStatus"],
    legacySource: "src/index.html #conv_list_file_btn；README「启动参数」--input",
    status: "skeleton",
  },
  {
    id: "F02",
    summary: "tree/category、条目名称/描述、scheme/default_scheme、options、tag/class",
    regions: ["ConversionTree", "ItemDetails"],
    legacySource: "README「set_name 事件」item_data 字段；src/index.html #conv_list",
    status: "wired",
  },
  {
    id: "F03",
    summary: "勾选、父子级联、全选/全不选、展开/折叠、键盘空格/双击",
    regions: ["ConversionTree", "TreeToolbar"],
    legacySource:
      "src/index.html #conv_list_btn_select_all/#conv_list_btn_select_none/#conv_list_btn_expand/#conv_list_btn_collapse",
    status: "wired",
  },
  {
    id: "F04",
    summary: "scheme/sheet 自定义选择器，精确/glob/regex 匹配，默认选中",
    regions: ["CustomActionBar"],
    legacySource: "README「自定义选择器规则」",
    status: "skeleton",
  },
  {
    id: "F05",
    summary: "reload/select_all/unselect_all/script 自定义按钮动作链",
    regions: ["CustomActionBar"],
    legacySource:
      "README「自定义选择器规则」action 字段；src/index.html #conv_list_custom_btn_group",
    status: "skeleton",
  },
  {
    id: "F06",
    summary: "Java 参数、工作目录、JAR、协议文件/数据目录多值、数据版本",
    regions: ["ConversionSettings"],
    legacySource:
      "src/index.html #conv_list_work_dir/#conv_list_xresloader/#conv_list_proto_file/#conv_list_data_source_dir/#conv_list_data_version/#conv_config_parallelism",
    status: "skeleton",
  },
  {
    id: "F07",
    summary: "bin/lua/msgpack/json/xml/javascript/ue-csv/ue-json、自定义输出矩阵",
    regions: ["OutputMatrixEditor"],
    legacySource:
      "src/index.html #conv_list_output_type/#conv_list_rename/#conv_list_output_dir/#conv_list_output_custom_multi",
    status: "skeleton",
  },
  {
    id: "F08",
    summary: "并发转换、日志输出、运行结果、重置",
    regions: ["RunControls", "LogPanel"],
    legacySource:
      "src/index.html #conv_list_btn_start_conv/#conv_list_btn_reload/#conv_list_run_log_panel",
    status: "skeleton",
  },
  {
    id: "F09",
    summary: "五类脚本入口及事件 name/checked/mutable/timeout",
    regions: ["HookControls", "CustomActionBar", "DialogHost"],
    legacySource:
      "README「事件支持」（set_name/on_before_convert/on_after_convert/script/on_append_log）；src/index.html #conv_list_event_group_wrapper/#dlg_alert_error_modal",
    status: "skeleton",
  },
  {
    id: "F10",
    summary: "日志颜色、级别、模块名、日志事件改写、外部 log4js 配置",
    regions: ["LogPanel"],
    legacySource: "README「on_append_log 事件」；src/index.html #conv_list_run_log_panel",
    status: "skeleton",
  },
  {
    id: "F11",
    summary: "启动参数和调试",
    regions: ["EnvironmentStatus"],
    legacySource: "README「启动参数」--input/--debug-mode/--custom-selector/--log-configure",
    status: "skeleton",
  },
  {
    id: "F12",
    summary: "Windows/Linux/macOS、多分辨率、版本与 Java 环境检查",
    regions: ["EnvironmentStatus"],
    legacySource: "README「下载和使用」；旧 setup.js 版本/Java 环境对话框",
    status: "skeleton",
  },
];
