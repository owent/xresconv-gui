import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { SettingsFields } from "../adapters/backend";
import { pickXmlConfig } from "../adapters/tauri";
import { DisplaySettingsDialog } from "./DisplaySettingsDialog";
import { DraftField } from "./DraftField";
import { ItemDetails } from "./ItemDetails";
import { OutputMatrixEditor } from "./OutputMatrixEditor";
import { useSessionStore } from "./session-store";

/** 内置协议（旧版 index.html 下拉仅 protobuf；配置值无匹配时追加“未知协议: X”选项）。 */
const PROTOCOL_OPTIONS = ["protobuf"] as const;
/** 输出类型词表与文案（旧版 index.html conv_list_output_type 逐项对应）。 */
const OUTPUT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "bin", label: "协议二进制" },
  { value: "lua", label: "Lua配置" },
  { value: "msgpack", label: "MsgPack二进制" },
  { value: "json", label: "Json格式" },
  { value: "xml", label: "Xml" },
  { value: "javascript", label: "Javascript配置" },
  { value: "ue-json", label: "UE资源Json格式" },
  { value: "ue-csv", label: "UE资源Csv格式" },
];
/** 并发数 1..16（main.js:6-9 上限；>6 需本地确认，main.js:2611-2639）。 */
const PARALLELISM_OPTIONS = Array.from({ length: 16 }, (_, index) => index + 1);
const PARALLELISM_CONFIRM_THRESHOLD = 6;

/** 表单整体禁用的会话状态（加载中/运行中；与 backend assertIdleLike 同集合）。 */
const BUSY_STATES = new Set(["loading", "before_hooks", "converting", "after_hooks"]);

function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * 转换参数区（F01/F06；2026-09-26 四轮改版）：
 * - 常显仅文件行：转换列表文件（选择/路径/重载）+ 并发数 + “详情”与
 *   “⚙ 显示设置”按钮（同排）。
 * - 详情弹窗重新分区排版（不拘泥旧版）：路径/多值字段通栏等宽、短字段
 *   （数据版本/协议类型/输出类型）标签与控件同行紧凑；重命名不再在此出现
 *   ——全 GUI 唯一入口在“输出矩阵与重命名”（datalist 可选可输，预设按
 *   配置矩阵推导，2026-09-26 四轮去重复）。
 */
export function ConversionSettings() {
  const settings = useSessionStore((state) => state.snapshot?.settings);
  const runState = useSessionStore((state) => state.snapshot?.state ?? "idle");
  const configPath = useSessionStore((state) => state.configPath);
  const loadConfig = useSessionStore((state) => state.loadConfig);
  const reloadConfig = useSessionStore((state) => state.reload);
  const updateSettings = useSessionStore((state) => state.updateSettings);
  const [pendingParallelism, setPendingParallelism] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const effective = settings?.effective ?? null;
  const disabled = effective === null || BUSY_STATES.has(runState);
  const parallelism = settings?.parallelism ?? 2;

  const submit = (fields: SettingsFields) => {
    void updateSettings(fields);
  };

  const pickConfig = async () => {
    try {
      const selected = await pickXmlConfig();
      if (selected !== null) {
        await loadConfig(selected);
      }
    } catch (error) {
      useSessionStore.setState({ lastError: String(error) });
    }
  };

  const proto = effective?.proto ?? "";
  const protoOptions: { value: string; label: string }[] = PROTOCOL_OPTIONS.map((value) => ({
    value,
    label: value,
  }));
  if (proto !== "" && !(PROTOCOL_OPTIONS as readonly string[]).includes(proto)) {
    // 配置/覆盖值不在内置列表：追加“未知协议”选项并选中（main.js:1247-1261），不静默丢弃。
    protoOptions.push({ value: proto, label: `未知协议: ${proto}` });
  }
  const outputType = effective?.type ?? "";
  const typeOptions = [...OUTPUT_TYPE_OPTIONS];
  if (outputType !== "" && !OUTPUT_TYPE_OPTIONS.some((option) => option.value === outputType)) {
    typeOptions.push({ value: outputType, label: `未知类型: ${outputType}` });
  }

  return (
    <form
      className="panel conversion-settings"
      aria-label="转换参数"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="config-file-bar">
        <Button className="btn-primary" onPress={() => void pickConfig()}>
          转换列表文件
        </Button>
        <input
          className="config-file-display"
          aria-label="配置文件路径"
          data-testid="picked-path"
          disabled
          placeholder="尚未载入任何文件，需要载入清单列表的xml文件(比如: convert_list.xml)"
          value={configPath ?? ""}
          readOnly
        />
        <Button onPress={() => void reloadConfig()} isDisabled={configPath === null}>
          重载配置
        </Button>
        <label className="select-field select-field--inline compact">
          <span>并发数</span>
          <select
            disabled={disabled}
            value={parallelism}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (next === parallelism) return;
              if (next > PARALLELISM_CONFIRM_THRESHOLD) {
                setPendingParallelism(next);
              } else {
                submit({ parallelism: next });
              }
            }}
          >
            {PARALLELISM_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="btn-accent"
          onPress={() => setDetailOpen(true)}
          isDisabled={effective === null}
        >
          详情…
        </Button>
        <Button className="btn-accent" onPress={() => setSettingsOpen(true)}>
          ⚙ 显示设置
        </Button>
      </div>
      {effective === null && <p className="empty-state">加载配置后可编辑转换参数。</p>}

      <ModalOverlay
        className="confirm-overlay detail-overlay"
        isOpen={detailOpen}
        onOpenChange={(open) => {
          if (!open) setDetailOpen(false);
        }}
      >
        <Modal className="confirm-modal detail-modal">
          <Dialog aria-label="详细配置" className="confirm-dialog">
            <Heading slot="title" className="detail-title">
              详细配置
            </Heading>
            <div className="detail-config">
              <section className="detail-section" aria-label="转表工具与目录">
                <h3 className="detail-section-title">转表工具与目录</h3>
                <div className="detail-grid">
                  <DraftField
                    label="转表工具（xresloader.jar）"
                    value={effective?.xresloaderPath ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ xresloaderPath: value })}
                  />
                  <DraftField
                    label="执行目录（work_dir）"
                    value={effective?.workDir ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ workDir: value })}
                  />
                  <DraftField
                    label="输出目录（output_dir）"
                    value={effective?.outputDir ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ outputDir: value })}
                  />
                </div>
              </section>
              <section className="detail-section" aria-label="数据与协议">
                <h3 className="detail-section-title">数据与协议</h3>
                <div className="detail-grid detail-grid--row">
                  <DraftField
                    label="数据版本"
                    value={effective?.dataVersion ?? ""}
                    disabled={disabled}
                    inline
                    onCommit={(value) => submit({ dataVersion: value })}
                  />
                  <label className="select-field select-field--inline">
                    <span>协议类型</span>
                    <select
                      disabled={disabled}
                      value={proto}
                      onChange={(event) => submit({ proto: event.target.value })}
                    >
                      {proto === "" && <option value="">（未设置）</option>}
                      {protoOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="select-field select-field--inline">
                    <span>输出类型</span>
                    <select
                      disabled={disabled}
                      value={outputType}
                      onChange={(event) => submit({ type: event.target.value })}
                    >
                      {outputType === "" && <option value="">（未设置）</option>}
                      {typeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="detail-grid">
                  <DraftField
                    label="协议描述文件（一行一个）"
                    value={(effective?.protoFile ?? []).join("\n")}
                    disabled={disabled}
                    multiline
                    mono
                    spanFull
                    onCommit={(value) => submit({ protoFile: linesToList(value) })}
                  />
                  <DraftField
                    label="数据目录（一行一个）"
                    value={(effective?.dataSrcDir ?? []).join("\n")}
                    disabled={disabled}
                    multiline
                    mono
                    spanFull
                    onCommit={(value) => submit({ dataSrcDir: linesToList(value) })}
                  />
                </div>
              </section>
              <section className="detail-section detail-section--flat" aria-label="条目详情">
                <ItemDetails />
              </section>
              <section
                className="detail-section detail-section--flat"
                aria-label="输出矩阵与重命名"
              >
                <OutputMatrixEditor />
              </section>
            </div>
            <div className="detail-footer">
              <span className="settings-hint">字段修改在失焦/回车时生效（直写后端覆盖值）。</span>
              <Button className="btn-primary" onPress={() => setDetailOpen(false)}>
                关闭
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <DisplaySettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <ModalOverlay
        className="confirm-overlay"
        isOpen={pendingParallelism !== null}
        onOpenChange={(open) => {
          if (!open) setPendingParallelism(null);
        }}
      >
        <Modal className="confirm-modal">
          <Dialog aria-label="确认高并发数" className="confirm-dialog">
            <Heading slot="title">确认高并发数</Heading>
            <p>
              并发数 {pendingParallelism ?? 0} 超过 {PARALLELISM_CONFIRM_THRESHOLD}
              ：高并发会显著增加内存与 IO 压力，输出互相覆盖的风险也随之上升。确定要继续吗？
            </p>
            <div className="confirm-actions">
              <Button
                className="btn-primary"
                onPress={() => {
                  if (pendingParallelism !== null) {
                    submit({ parallelism: pendingParallelism });
                  }
                  setPendingParallelism(null);
                }}
              >
                确认
              </Button>
              <Button onPress={() => setPendingParallelism(null)}>取消</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </form>
  );
}
