import { Button } from "react-aria-components";
import type { EffectiveSettingsLike, OutputMatrixRuleLike } from "../adapters/backend";
import { translate as t, useI18n } from "../i18n";
import { DraftField } from "./DraftField";
import { useSessionStore } from "./session-store";

/** 八种内置输出格式。 */
const OUTPUT_FORMATS = [
  "bin",
  "lua",
  "msgpack",
  "json",
  "xml",
  "javascript",
  "ue-json",
  "ue-csv",
] as const;

/** 与 ConversionSettings 相同的禁用集合（加载中/运行中）。 */
const BUSY_STATES = new Set(["loading", "before_hooks", "converting", "after_hooks"]);

/**
 * 重命名预设目标后缀；源后缀由配置输出矩阵推导（缺省 .bin）。
 * 输出矩阵内通过 datalist 选择或输入后缀，输入时过滤候选。
 */
const RENAME_PRESET_TARGETS = ["lua", "json", "msgpack.bin", "xml", "js"] as const;

/** 预设 datalist 的共享 id（单类型/矩阵各字段同候选）。 */
const RENAME_DATALIST_ID = "rename-presets";

function renamePresetsOf(
  matrix: readonly OutputMatrixRuleLike[],
): { value: string; label: string }[] {
  const sources =
    matrix.length > 0
      ? matrix
          .map((rule) => rule.type)
          .filter((type): type is string => typeof type === "string" && type !== "")
      : ["bin"];
  const seen = new Set<string>();
  const presets: { value: string; label: string }[] = [];
  for (const source of sources.length > 0 ? sources : ["bin"]) {
    if (seen.has(source)) continue;
    seen.add(source);
    for (const target of RENAME_PRESET_TARGETS) {
      presets.push({
        value: `/\\.${source}$/.${target}/`,
        label: t("matrix.suffix", { source, target }),
      });
    }
  }
  return presets;
}

/**
 * 矩阵模式判定：与 backend domain/selection.ts isMatrixMode 同规则——
 * 规则多于一条，或唯一规则带 tags/classes 限定。
 * 前端只按此决定展示形态，矩阵语义（资格/计划）由后端判定。
 */
function isMatrixModeLocal(matrix: readonly OutputMatrixRuleLike[]): boolean {
  const first = matrix[0];
  return (
    matrix.length > 1 ||
    (matrix.length === 1 &&
      first !== undefined &&
      (first.tags.length > 0 || first.classes.length > 0))
  );
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/** 格式下拉：内置八种；当前值不在列表时追加“未知格式: X”选项，不静默丢弃。 */
function FormatSelect({
  label,
  value,
  disabled,
  allowUnset,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  /** 矩阵规则允许空值（回退全局/默认）；单类型模式仅在值本身为空时给出空选项。 */
  allowUnset: boolean;
  onCommit: (value: string) => void;
}) {
  useI18n();
  const known = (OUTPUT_FORMATS as readonly string[]).includes(value);
  return (
    <label className="select-field select-field--inline">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(event) => onCommit(event.target.value)}>
        {(allowUnset || value === "") && <option value="">{t("common.default")}</option>}
        {OUTPUT_FORMATS.map((format) => (
          <option key={format} value={format}>
            {format}
          </option>
        ))}
        {value !== "" && !known && <option value={value}>{t("matrix.unknown", { value })}</option>}
      </select>
    </label>
  );
}

/** 单类型 → 矩阵的切换：首条规则携带当前有效值（行为不变），新规则复制为模板。 */
function initialMatrix(effective: EffectiveSettingsLike): OutputMatrixRuleLike[] {
  const current: OutputMatrixRuleLike = {
    type: effective.type,
    tags: [],
    classes: [],
  };
  if (effective.rename !== "") current.rename = effective.rename;
  if (effective.outputDir !== "") current.outputDir = effective.outputDir;
  return [current, { ...current, tags: [], classes: [] }];
}

/**
 * 输出矩阵编辑器：单类型模式编辑全局 type/rename/outputDir；
 * 矩阵模式逐规则编辑 type/rename/outputDir/tags/classes，任何变更整体提交
 * updateSettings({matrix})。删除到 ≤1 条且无 tag/class 时自然回单类型模式
 * （矩阵语义由后端判定，前端如实提交）。重命名是全 GUI 唯一入口
 * 。
 */
export function OutputMatrixEditor() {
  useI18n();
  const settings = useSessionStore((state) => state.snapshot?.settings);
  const runState = useSessionStore((state) => state.snapshot?.state ?? "idle");
  const updateSettings = useSessionStore((state) => state.updateSettings);

  const effective = settings?.effective ?? null;
  const disabled = effective === null || BUSY_STATES.has(runState);
  const matrix = effective?.matrix ?? [];
  const pending = useSessionStore((state) => state.settingsPending > 0);
  const matrixMode = isMatrixModeLocal(matrix);
  const renamePresets = renamePresetsOf(matrix);

  const submitMatrix = (edit: (current: EffectiveSettingsLike) => OutputMatrixRuleLike[]) => {
    void updateSettings((current) => ({ matrix: edit(current) }));
  };

  return (
    <details className="panel output-matrix collapsible" aria-label={t("matrix.label")}>
      <summary className="panel-title collapsible-summary">{t("matrix.title")}</summary>
      <datalist id={RENAME_DATALIST_ID}>
        {renamePresets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </datalist>
      {!matrixMode && effective !== null && (
        <div className="detail-grid">
          <FormatSelect
            label={t("matrix.format")}
            value={effective.type}
            disabled={disabled}
            allowUnset={false}
            onCommit={(value) => void updateSettings({ type: value })}
          />
          <DraftField
            label={t("matrix.rename")}
            value={effective.rename}
            disabled={disabled}
            mono
            datalistId={RENAME_DATALIST_ID}
            placeholder="/\.bin$/.lua/"
            onCommit={(value) => void updateSettings({ rename: value })}
          />
          <DraftField
            label={t("conversion.outputDir")}
            value={effective.outputDir}
            disabled={disabled}
            mono
            spanFull
            onCommit={(value) => void updateSettings({ outputDir: value })}
          />
        </div>
      )}
      {matrixMode && (
        <ol className="matrix-rules">
          {matrix.map((rule, index) => (
            // 规则无自然身份且按位置编辑（提交走后端往返）；内容 key 会在每次提交后重挂载整行丢失焦点，位置 key 是有意选择。
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: 矩阵规则为位置语义的有序列表，无稳定业务 id
              key={index}
              className="matrix-rule"
              aria-label={t("matrix.rule", { count: index + 1 })}
            >
              <div className="detail-grid">
                <FormatSelect
                  label={t("matrix.format")}
                  value={rule.type ?? ""}
                  disabled={disabled}
                  allowUnset
                  onCommit={(value) =>
                    submitMatrix((current) =>
                      current.matrix.map((entry, i) =>
                        i === index ? { ...entry, type: value } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label={t("matrix.rename")}
                  value={rule.rename ?? ""}
                  disabled={disabled}
                  mono
                  datalistId={RENAME_DATALIST_ID}
                  placeholder="/\.bin$/.lua/"
                  onCommit={(value) =>
                    submitMatrix((current) =>
                      current.matrix.map((entry, i) =>
                        i === index ? { ...entry, rename: value } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label={t("conversion.outputDir")}
                  value={rule.outputDir ?? ""}
                  disabled={disabled}
                  mono
                  spanFull
                  onCommit={(value) =>
                    submitMatrix((current) =>
                      current.matrix.map((entry, i) =>
                        i === index ? { ...entry, outputDir: value } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label={t("matrix.tags")}
                  value={rule.tags.join(" ")}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix((current) =>
                      current.matrix.map((entry, i) =>
                        i === index ? { ...entry, tags: splitWords(value) } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label={t("matrix.classes")}
                  value={rule.classes.join(" ")}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix((current) =>
                      current.matrix.map((entry, i) =>
                        i === index ? { ...entry, classes: splitWords(value) } : entry,
                      ),
                    )
                  }
                />
              </div>
              <Button
                className="matrix-rule-remove"
                isDisabled={disabled || pending}
                onPress={() =>
                  submitMatrix((current) => current.matrix.filter((_, i) => i !== index))
                }
              >
                {t("matrix.remove", { count: index + 1 })}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="matrix-actions">
        <Button
          isDisabled={disabled || pending || effective === null}
          onPress={() => {
            if (effective === null) return;
            submitMatrix((current) =>
              isMatrixModeLocal(current.matrix)
                ? [...current.matrix, { tags: [], classes: [] }]
                : initialMatrix(current),
            );
          }}
        >
          {t("matrix.add")}
        </Button>
        {matrix.length > 0 && (
          <Button isDisabled={disabled || pending} onPress={() => submitMatrix(() => [])}>
            {t("matrix.clear")}
          </Button>
        )}
      </div>
      {effective === null && <p className="empty-state">{t("matrix.empty")}</p>}
    </details>
  );
}
