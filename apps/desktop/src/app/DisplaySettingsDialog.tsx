import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from "react-aria-components";
import {
  type FontArea,
  type FontPrefs,
  type ThemeMode,
  useDisplaySettings,
} from "./display-settings";
import { useSessionStore } from "./session-store";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
];

/** 字体分区（2026-09-26 用户需求：全局/UI/树/日志各自字体+字号）。 */
const FONT_AREAS: { key: FontArea; label: string }[] = [
  { key: "global", label: "全局" },
  { key: "ui", label: "界面控件" },
  { key: "tree", label: "左侧转换列表" },
  { key: "log", label: "日志输出" },
];

/** 字体名候选：queryLocalFonts（WebView2/Chromium）→ 常见回退词表。 */
const FALLBACK_FONTS = [
  "system-ui",
  "Segoe UI",
  "Microsoft YaHei",
  "SimSun",
  "SimHei",
  "KaiTi",
  "FangSong",
  "DengXian",
  "Consolas",
  "Courier New",
  "Arial",
  "Times New Roman",
];

async function enumerateFonts(): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts;
  if (typeof query === "function") {
    try {
      const fonts = await query();
      const families = [...new Set(fonts.map((font) => font.family))];
      if (families.length > 0) return families.sort((a, b) => a.localeCompare(b, "zh-Hans"));
    } catch {
      /* 权限拒绝/不支持 → 回退词表 */
    }
  }
  return FALLBACK_FONTS;
}

/**
 * 显示设置弹窗（2026-09-26 三轮改版）：从状态条迁入“⚙ 显示设置”按钮旁的
 * 独立弹窗；主题三态为分段单选（RAC Radio 的原生 input 视觉隐藏，圆点指示
 * 器由 CSS 绘制——此前无样式导致“看不到任何控件”）。
 */
export function DisplaySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, lastConfigFile, fonts, setTheme, setFontPrefs } = useDisplaySettings();
  const [fontNames, setFontNames] = useState<string[]>(FALLBACK_FONTS);

  useEffect(() => {
    if (!open) return;
    void enumerateFonts().then(setFontNames);
  }, [open]);

  return (
    <ModalOverlay
      className="confirm-overlay"
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal className="confirm-modal settings-modal">
        <Dialog aria-label="显示设置" className="confirm-dialog">
          <Heading slot="title" className="settings-title">
            显示设置
          </Heading>
          <section className="settings-section" aria-label="主题">
            <h3 className="settings-section-title">主题</h3>
            <RadioGroup
              aria-label="主题"
              className="theme-choice"
              value={theme}
              onChange={(value) => setTheme(value as ThemeMode)}
            >
              {THEME_OPTIONS.map((option) => (
                <Radio key={option.value} value={option.value} className="theme-option">
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
            <p className="settings-hint">亮色/暗色立即生效并记住；跟随系统随系统切换。</p>
          </section>
          <section className="settings-section" aria-label="分区字体">
            <h3 className="settings-section-title">分区字体</h3>
            <div className="font-grid-head" aria-hidden="true">
              <span>区域</span>
              <span>字体（留空跟随全局/默认）</span>
              <span>字号(px)</span>
            </div>
            <div className="font-settings">
              {FONT_AREAS.map(({ key, label }) => (
                <FontRow
                  key={key}
                  label={label}
                  fontNames={fontNames}
                  prefs={fonts[key]}
                  onChange={(prefs) => setFontPrefs(key, prefs)}
                />
              ))}
            </div>
          </section>
          <section className="settings-section" aria-label="上次转换列表">
            <h3 className="settings-section-title">上次转换列表</h3>
            <p className="settings-last-file" data-testid="last-config-file">
              {lastConfigFile ?? "（无）"}
            </p>
          </section>
          <div className="confirm-actions">
            <Button
              className="btn-primary"
              isDisabled={lastConfigFile === null}
              onPress={() => {
                if (lastConfigFile !== null) {
                  void useSessionStore.getState().loadConfig(lastConfigFile);
                }
                onClose();
              }}
            >
              立即加载上次文件
            </Button>
            <Button className="btn-ghost" onPress={onClose}>
              关闭
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 单区字体行：family 输入 + datalist 候选（输入即时过滤）+ 字号。 */
function FontRow({
  label,
  fontNames,
  prefs,
  onChange,
}: {
  label: string;
  fontNames: string[];
  prefs: FontPrefs;
  onChange: (prefs: FontPrefs) => void;
}) {
  const listId = `font-candidates-${label}`;
  const commitFamily = (value: string) => {
    onChange({ ...prefs, family: value.trim() });
  };
  return (
    <div className="font-row">
      <span className="font-row-label">{label}</span>
      <input
        className="font-family-input"
        aria-label={`${label}字体`}
        list={listId}
        value={prefs.family}
        placeholder="（默认）"
        onChange={(event) => onChange({ ...prefs, family: event.target.value })}
        onBlur={(event) => commitFamily(event.currentTarget.value)}
      />
      <datalist id={listId}>
        {fontNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <input
        className="font-size-input"
        aria-label={`${label}字号(px)`}
        type="number"
        min={6}
        max={48}
        step={0.5}
        value={prefs.size ?? ""}
        placeholder="默认"
        onChange={(event) => {
          const raw = event.target.value;
          onChange({ ...prefs, size: raw === "" ? null : Number(raw) });
        }}
        onBlur={(event) => {
          const raw = event.currentTarget.value;
          if (raw !== "") {
            const size = Math.min(48, Math.max(6, Number(raw)));
            if (String(size) !== raw) onChange({ ...prefs, size });
          }
        }}
      />
    </div>
  );
}
