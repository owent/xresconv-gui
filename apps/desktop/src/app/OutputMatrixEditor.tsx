import { Checkbox, Input, Label, TextField } from "react-aria-components";

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

/**
 * 输出矩阵编辑器（F07）：八类内置输出格式 + 自定义（custom-multi）、
 * rename、output_dir、tag/class 限定。
 * 骨架为禁用态；多输出组合、未知格式与禁用理由在 P4-04 接入领域矩阵快照。
 */
export function OutputMatrixEditor() {
  return (
    <section className="panel output-matrix" aria-label="输出矩阵">
      <h2 className="panel-title">输出矩阵</h2>
      <fieldset className="format-list">
        <legend>输出格式</legend>
        {OUTPUT_FORMATS.map((format) => (
          <Checkbox key={format} isDisabled>
            {format}
          </Checkbox>
        ))}
        <Checkbox isDisabled>自定义（custom-multi）</Checkbox>
      </fieldset>
      <div className="form-grid">
        <TextField isDisabled>
          <Label>重命名（正则）</Label>
          <Input placeholder="/\.bin$/.lua/" />
        </TextField>
        <TextField isDisabled>
          <Label>输出目录（output_dir）</Label>
          <Input />
        </TextField>
        <TextField isDisabled>
          <Label>tag 限定</Label>
          <Input />
        </TextField>
        <TextField isDisabled>
          <Label>class 限定</Label>
          <Input />
        </TextField>
      </div>
      <p className="empty-state">多输出组合与未知格式处理在 P4-04 接入。</p>
    </section>
  );
}
