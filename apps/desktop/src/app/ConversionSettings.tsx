import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { SettingsFields } from "../adapters/backend";
import { pickXmlConfig } from "../adapters/tauri";
import { translate as t, useI18n } from "../i18n";
import { DisplaySettingsDialog } from "./DisplaySettingsDialog";
import { DraftField } from "./DraftField";
import { Icon } from "./Icon";
import { ItemDetails } from "./ItemDetails";
import { OutputMatrixEditor } from "./OutputMatrixEditor";
import { useSessionStore } from "./session-store";

/** 内置协议；配置值无匹配时追加保留原值的未知协议选项。 */
const PROTOCOL_OPTIONS = ["protobuf"] as const;
/** 内置输出类型及其本地化文案。 */
function outputTypeOptions(): { value: string; label: string }[] {
  return [
    { value: "bin", label: t("format.bin") },
    { value: "lua", label: t("format.lua") },
    { value: "msgpack", label: t("format.msgpack") },
    { value: "json", label: t("format.json") },
    { value: "xml", label: t("format.xml") },
    { value: "javascript", label: t("format.javascript") },
    { value: "ue-json", label: t("format.ueJson") },
    { value: "ue-csv", label: t("format.ueCsv") },
  ];
}
/** 并发数范围 1..16；超过 6 需用户确认。 */
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

/** 转换参数表单：提交草稿后以后端确认值更新。输出格式由输出矩阵管理。 */
export function ConversionSettings() {
  useI18n();
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
    // 配置/覆盖值不在内置列表：追加“未知协议”选项并选中，不静默丢弃。
    protoOptions.push({ value: proto, label: t("conversion.unknownProtocol", { value: proto }) });
  }
  const outputType = effective?.type ?? "";
  const typeOptions = [...outputTypeOptions()];
  if (outputType !== "" && !outputTypeOptions().some((option) => option.value === outputType)) {
    typeOptions.push({
      value: outputType,
      label: t("conversion.unknownType", { value: outputType }),
    });
  }

  return (
    <form
      className="panel conversion-settings"
      aria-label={t("conversion.form")}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="config-file-bar">
        <Button
          className="btn-primary"
          onPress={() => void pickConfig()}
          isDisabled={BUSY_STATES.has(runState)}
        >
          <Icon name="file" />
          {t("conversion.open")}
        </Button>
        <input
          className="config-file-display"
          aria-label={t("conversion.path")}
          data-testid="picked-path"
          placeholder={t("conversion.placeholder")}
          title={configPath ?? t("conversion.pick")}
          value={configPath ?? ""}
          readOnly
        />
        <Button
          onPress={() => void reloadConfig()}
          isDisabled={configPath === null || BUSY_STATES.has(runState)}
        >
          {t("conversion.reload")}
        </Button>
        <label className="select-field select-field--inline compact">
          <span>{t("conversion.parallelism")}</span>
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
          {t("conversion.details")}
        </Button>
        <Button className="btn-accent" onPress={() => setSettingsOpen(true)}>
          <Icon name="settings" />
          {t("settings.title")}
        </Button>
      </div>

      <ModalOverlay
        className="confirm-overlay detail-overlay"
        isOpen={detailOpen}
        onOpenChange={(open) => {
          if (!open) setDetailOpen(false);
        }}
      >
        <Modal className="confirm-modal detail-modal">
          <Dialog aria-label={t("conversion.detailTitle")} className="confirm-dialog">
            <Heading slot="title" className="detail-title">
              {t("conversion.detailTitle")}
            </Heading>
            <div className="detail-config">
              <section className="detail-section" aria-label={t("conversion.tools")}>
                <h3 className="detail-section-title">{t("conversion.tools")}</h3>
                <div className="detail-grid">
                  <DraftField
                    label={t("conversion.jar")}
                    value={effective?.xresloaderPath ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ xresloaderPath: value })}
                  />
                  <DraftField
                    label={t("conversion.workDir")}
                    value={effective?.workDir ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ workDir: value })}
                  />
                  <DraftField
                    label={t("conversion.outputDir")}
                    value={effective?.outputDir ?? ""}
                    disabled={disabled}
                    mono
                    spanFull
                    onCommit={(value) => submit({ outputDir: value })}
                  />
                </div>
              </section>
              <section className="detail-section" aria-label={t("conversion.dataProtocol")}>
                <h3 className="detail-section-title">{t("conversion.dataProtocol")}</h3>
                <div className="detail-grid detail-grid--row">
                  <DraftField
                    label={t("conversion.dataVersion")}
                    value={effective?.dataVersion ?? ""}
                    disabled={disabled}
                    inline
                    onCommit={(value) => submit({ dataVersion: value })}
                  />
                  <label className="select-field select-field--inline">
                    <span>{t("conversion.protocol")}</span>
                    <select
                      disabled={disabled}
                      value={proto}
                      onChange={(event) => submit({ proto: event.target.value })}
                    >
                      {proto === "" && <option value="">{t("common.unset")}</option>}
                      {protoOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="select-field select-field--inline">
                    <span>{t("conversion.outputType")}</span>
                    <select
                      disabled={disabled}
                      value={outputType}
                      onChange={(event) => submit({ type: event.target.value })}
                    >
                      {outputType === "" && <option value="">{t("common.unset")}</option>}
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
                    label={t("conversion.protoFiles")}
                    value={(effective?.protoFile ?? []).join("\n")}
                    disabled={disabled}
                    multiline
                    mono
                    spanFull
                    onCommit={(value) => submit({ protoFile: linesToList(value) })}
                  />
                  <DraftField
                    label={t("conversion.dataDirs")}
                    value={(effective?.dataSrcDir ?? []).join("\n")}
                    disabled={disabled}
                    multiline
                    mono
                    spanFull
                    onCommit={(value) => submit({ dataSrcDir: linesToList(value) })}
                  />
                </div>
              </section>
              <section className="detail-section detail-section--flat" aria-label={t("item.title")}>
                <ItemDetails />
              </section>
              <section
                className="detail-section detail-section--flat"
                aria-label={t("matrix.title")}
              >
                <OutputMatrixEditor />
              </section>
            </div>
            <div className="detail-footer">
              <span className="settings-hint">{t("conversion.commitHint")}</span>
              <Button className="btn-primary" onPress={() => setDetailOpen(false)}>
                {t("common.close")}
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
          <Dialog aria-label={t("conversion.highParallelism")} className="confirm-dialog">
            <Heading slot="title">{t("conversion.highParallelism")}</Heading>
            <p>
              {t("conversion.parallelWarning", {
                count: pendingParallelism ?? 0,
                limit: PARALLELISM_CONFIRM_THRESHOLD,
              })}
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
                {t("common.confirm")}
              </Button>
              <Button onPress={() => setPendingParallelism(null)}>{t("common.cancel")}</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </form>
  );
}
