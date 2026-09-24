import { Input, Label, TextField } from "react-aria-components";

const SETTINGS_FIELDS = [
  { id: "work_dir", label: "执行目录（work_dir）" },
  { id: "xresloader", label: "转表工具（xresloader.jar）" },
  { id: "proto_file", label: "协议描述文件" },
  { id: "data_src_dir", label: "数据目录" },
  { id: "data_version", label: "数据版本" },
  { id: "extra_options", label: "额外参数" },
] as const;

const PARALLELISM_OPTIONS = [1, 2, 4, 8, 16] as const;

/**
 * 转换参数表单（F06）：work_dir、JAR、协议文件、数据目录、数据版本、额外参数与并发数。
 * 骨架为禁用态；多值、空值、路径校验与受控 override 在 P4-04 接入，
 * 提交必须确认后端配置版本（docs/plan/04-ui.md §状态分层）。
 */
export function ConversionSettings() {
  return (
    <form
      className="panel conversion-settings"
      aria-label="转换参数"
      onSubmit={(event) => event.preventDefault()}
    >
      <h2 className="panel-title">转换参数</h2>
      <div className="form-grid">
        {SETTINGS_FIELDS.map((field) => (
          <TextField key={field.id} isDisabled>
            <Label>{field.label}</Label>
            <Input />
          </TextField>
        ))}
        <label className="select-field">
          协议类型
          <select disabled defaultValue="protobuf">
            <option value="protobuf">protobuf</option>
          </select>
        </label>
        <label className="select-field">
          并发数
          <select disabled defaultValue={4}>
            {PARALLELISM_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="empty-state">加载配置后可编辑；字段校验与版本冲突处理在 P4-04 接入。</p>
    </form>
  );
}
