import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { SettingsFields } from "../adapters/backend";
import { DraftField } from "./DraftField";
import { useSessionStore } from "./session-store";

/** 内置协议（旧版 index.html 下拉仅 protobuf；配置值无匹配时追加“未知协议: X”选项）。 */
const PROTOCOL_OPTIONS = ["protobuf"] as const;
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
 * 转换参数表单（F06，P4-04b）：work_dir/JAR/协议文件/数据目录/数据版本/协议/并发数。
 * 数据源为 snapshot.settings.effective（配置默认 ⊕ 覆盖）；提交走 updateSettings
 * 合并语义，显示值以后端返回为准。parallelism 为会话级设置（不进 overrides），
 * >6 弹本地确认对话框（React Aria Modal；对应旧版 alert_warning，不走脚本弹框通道）。
 */
export function ConversionSettings() {
  const settings = useSessionStore((state) => state.snapshot?.settings);
  const runState = useSessionStore((state) => state.snapshot?.state ?? "idle");
  const updateSettings = useSessionStore((state) => state.updateSettings);
  const [pendingParallelism, setPendingParallelism] = useState<number | null>(null);

  const effective = settings?.effective ?? null;
  const disabled = effective === null || BUSY_STATES.has(runState);
  const parallelism = settings?.parallelism ?? 2;

  const submit = (fields: SettingsFields) => {
    void updateSettings(fields);
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

  return (
    <form
      className="panel conversion-settings"
      aria-label="转换参数"
      onSubmit={(event) => event.preventDefault()}
    >
      <h2 className="panel-title">转换参数</h2>
      <div className="form-grid">
        <DraftField
          label="执行目录（work_dir）"
          value={effective?.workDir ?? ""}
          disabled={disabled}
          onCommit={(value) => submit({ workDir: value })}
        />
        <DraftField
          label="转表工具（xresloader.jar）"
          value={effective?.xresloaderPath ?? ""}
          disabled={disabled}
          onCommit={(value) => submit({ xresloaderPath: value })}
        />
        <DraftField
          label="协议描述文件（一行一个）"
          value={(effective?.protoFile ?? []).join("\n")}
          disabled={disabled}
          multiline
          onCommit={(value) => submit({ protoFile: linesToList(value) })}
        />
        <DraftField
          label="数据目录（一行一个）"
          value={(effective?.dataSrcDir ?? []).join("\n")}
          disabled={disabled}
          multiline
          onCommit={(value) => submit({ dataSrcDir: linesToList(value) })}
        />
        <DraftField
          label="数据版本"
          value={effective?.dataVersion ?? ""}
          disabled={disabled}
          onCommit={(value) => submit({ dataVersion: value })}
        />
        <label className="select-field">
          协议类型
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
        <label className="select-field">
          并发数
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
      </div>
      {effective === null && <p className="empty-state">加载配置后可编辑转换参数。</p>}
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
