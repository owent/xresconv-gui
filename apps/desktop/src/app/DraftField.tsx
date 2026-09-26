import { useState } from "react";
import { Input, Label, TextArea, TextField } from "react-aria-components";

/**
 * 受控文本字段（P4-04b）：聚焦时进入草稿，blur（单行含 Enter）提交变更；
 * 未聚焦时直接显示后端 effective 值——reload/加载新配置/后端拒绝后自动回写，
 * 不残留旧表单值（docs/plan/04-ui.md §状态分层：显示值以后端返回为准）。
 * - mono：路径/协议文件等机器值用等宽日志字体（2026-09-26 详情弹窗改版）。
 * - spanFull：通栏占满网格行（长路径/多值列表）。
 * - inline：标签与输入同行（短字段的紧凑布局，2026-09-26 四轮）。
 * - datalistId：原生 datalist 下拉候选（可输入过滤预设，如输出重命名正则）。
 */
export function DraftField({
  label,
  value,
  disabled,
  onCommit,
  multiline = false,
  placeholder,
  mono = false,
  spanFull = false,
  inline = false,
  datalistId,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  mono?: boolean;
  spanFull?: boolean;
  inline?: boolean;
  datalistId?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value;
  const commit = () => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  };
  return (
    <TextField
      isDisabled={disabled}
      className={[
        "settings-field",
        mono ? "settings-field--mono" : "",
        spanFull ? "settings-field--wide" : "",
        inline ? "settings-field--inline" : "",
      ]
        .filter((name) => name !== "")
        .join(" ")}
    >
      <Label>{label}</Label>
      {multiline ? (
        <TextArea
          value={shown}
          placeholder={placeholder}
          rows={3}
          onFocus={() => {
            setDraft(value);
            setEditing(true);
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      ) : (
        <Input
          value={shown}
          placeholder={placeholder}
          list={datalistId}
          onFocus={() => {
            setDraft(value);
            setEditing(true);
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </TextField>
  );
}
