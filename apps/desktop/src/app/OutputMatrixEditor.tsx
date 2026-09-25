import { Button } from "react-aria-components";
import type { EffectiveSettingsLike, OutputMatrixRuleLike } from "../adapters/backend";
import { DraftField } from "./DraftField";
import { useSessionStore } from "./session-store";

/** 八种内置输出格式（旧版 output_type 下拉，index.html:146 附近）。 */
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
 * 矩阵模式判定：与 backend domain/selection.ts isMatrixMode 同规则——
 * 规则多于一条，或唯一规则带 tags/classes 限定（main.js:1333-1338）。
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

/** 格式下拉：内置八种；当前值不在列表时追加“未知格式: X”选项（main.js:1404-1418），不静默丢弃。 */
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
  const known = (OUTPUT_FORMATS as readonly string[]).includes(value);
  return (
    <label className="select-field">
      {label}
      <select disabled={disabled} value={value} onChange={(event) => onCommit(event.target.value)}>
        {(allowUnset || value === "") && <option value="">（默认）</option>}
        {OUTPUT_FORMATS.map((format) => (
          <option key={format} value={format}>
            {format}
          </option>
        ))}
        {value !== "" && !known && <option value={value}>未知格式: {value}</option>}
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
 * 输出矩阵编辑器（F07，P4-04b）：单类型模式编辑全局 type/rename/outputDir；
 * 矩阵模式逐规则编辑 type/rename/outputDir/tags/classes，任何变更整体提交
 * updateSettings({matrix})。删除到 ≤1 条且无 tag/class 时自然回单类型模式
 * （矩阵语义由后端判定，前端如实提交）。
 */
export function OutputMatrixEditor() {
  const settings = useSessionStore((state) => state.snapshot?.settings);
  const runState = useSessionStore((state) => state.snapshot?.state ?? "idle");
  const updateSettings = useSessionStore((state) => state.updateSettings);

  const effective = settings?.effective ?? null;
  const disabled = effective === null || BUSY_STATES.has(runState);
  const matrix = effective?.matrix ?? [];
  const matrixMode = isMatrixModeLocal(matrix);

  const submitMatrix = (next: OutputMatrixRuleLike[]) => {
    void updateSettings({ matrix: next });
  };

  return (
    <details className="panel output-matrix collapsible" aria-label="输出矩阵">
      <summary className="panel-title collapsible-summary">输出矩阵</summary>
      {!matrixMode && effective !== null && (
        <div className="form-grid">
          <FormatSelect
            label="输出格式"
            value={effective.type}
            disabled={disabled}
            allowUnset={false}
            onCommit={(value) => void updateSettings({ type: value })}
          />
          <DraftField
            label="重命名（正则）"
            value={effective.rename}
            disabled={disabled}
            placeholder="/\.bin$/.lua/"
            onCommit={(value) => void updateSettings({ rename: value })}
          />
          <DraftField
            label="输出目录（output_dir）"
            value={effective.outputDir}
            disabled={disabled}
            onCommit={(value) => void updateSettings({ outputDir: value })}
          />
        </div>
      )}
      {matrixMode && (
        <ol className="matrix-rules">
          {matrix.map((rule, index) => (
            // 规则无自然身份且按位置编辑（提交走后端往返）；内容 key 会在每次提交后重挂载整行丢失焦点，位置 key 是有意选择。
            // biome-ignore lint/suspicious/noArrayIndexKey: 矩阵规则为位置语义的有序列表，无稳定业务 id
            <li key={index} className="matrix-rule" aria-label={`输出规则 ${index + 1}`}>
              <div className="form-grid">
                <FormatSelect
                  label="输出格式"
                  value={rule.type ?? ""}
                  disabled={disabled}
                  allowUnset
                  onCommit={(value) =>
                    submitMatrix(
                      matrix.map((entry, i) => (i === index ? { ...entry, type: value } : entry)),
                    )
                  }
                />
                <DraftField
                  label="重命名（正则）"
                  value={rule.rename ?? ""}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix(
                      matrix.map((entry, i) => (i === index ? { ...entry, rename: value } : entry)),
                    )
                  }
                />
                <DraftField
                  label="输出目录（output_dir）"
                  value={rule.outputDir ?? ""}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix(
                      matrix.map((entry, i) =>
                        i === index ? { ...entry, outputDir: value } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label="tag 限定（空白分隔）"
                  value={rule.tags.join(" ")}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix(
                      matrix.map((entry, i) =>
                        i === index ? { ...entry, tags: splitWords(value) } : entry,
                      ),
                    )
                  }
                />
                <DraftField
                  label="class 限定（空白分隔）"
                  value={rule.classes.join(" ")}
                  disabled={disabled}
                  onCommit={(value) =>
                    submitMatrix(
                      matrix.map((entry, i) =>
                        i === index ? { ...entry, classes: splitWords(value) } : entry,
                      ),
                    )
                  }
                />
              </div>
              <Button
                className="matrix-rule-remove"
                isDisabled={disabled}
                onPress={() => submitMatrix(matrix.filter((_, i) => i !== index))}
              >
                删除规则 {index + 1}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="matrix-actions">
        <Button
          isDisabled={disabled || effective === null}
          onPress={() => {
            if (effective === null) return;
            submitMatrix(
              matrixMode ? [...matrix, { tags: [], classes: [] }] : initialMatrix(effective),
            );
          }}
        >
          添加输出规则
        </Button>
        {matrix.length > 0 && (
          <Button isDisabled={disabled} onPress={() => submitMatrix([])}>
            清空矩阵
          </Button>
        )}
      </div>
      {effective === null && <p className="empty-state">加载配置后可编辑输出矩阵。</p>}
    </details>
  );
}
