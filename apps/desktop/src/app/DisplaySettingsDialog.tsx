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
import { allowLocalFonts } from "../adapters/tauri";
import {
  LANGUAGE_NAMES,
  type LanguagePreference,
  type Locale,
  translate as t,
  useI18n,
} from "../i18n";
import {
  type FontArea,
  type FontPrefs,
  type ThemeMode,
  useDisplaySettings,
} from "./display-settings";
import { useSessionStore } from "./session-store";

function themeOptions(): { value: ThemeMode; label: string }[] {
  return [
    { value: "system", label: t("settings.systemTheme") },
    { value: "light", label: t("settings.light") },
    { value: "dark", label: t("settings.dark") },
  ];
}

/** 字体分区。 */
function fontAreas(): { key: FontArea; label: string }[] {
  return [
    { key: "global", label: t("settings.global") },
    { key: "ui", label: t("settings.ui") },
    { key: "tree", label: t("settings.tree") },
    { key: "log", label: t("settings.log") },
  ];
}

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

async function enumerateFonts(locale: Locale): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts;
  if (typeof query === "function") {
    try {
      if (!(await allowLocalFonts())) return FALLBACK_FONTS;
      const fonts = await query.call(window);
      const families = [...new Set(fonts.map((font) => font.family))];
      if (families.length > 0) return families.sort((a, b) => a.localeCompare(b, locale));
    } catch {
      /* 权限拒绝/不支持 → 回退词表 */
    }
  }
  return FALLBACK_FONTS;
}

/** 主题即时生效；字体在完成编辑后统一校验并持久化。 */
export function DisplaySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, systemLocale } = useI18n();
  const { theme, language, lastConfigFile, fonts, setLanguage, setTheme, setFontPrefs } =
    useDisplaySettings();
  const [fontNames, setFontNames] = useState<string[]>(FALLBACK_FONTS);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void enumerateFonts(locale).then((names) => {
      if (active) setFontNames(names);
    });
    return () => {
      active = false;
    };
  }, [open, locale]);

  return (
    <ModalOverlay
      className="confirm-overlay"
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal className="confirm-modal settings-modal">
        <Dialog aria-label={t("settings.title")} className="confirm-dialog">
          <Heading slot="title" className="settings-title">
            {t("settings.title")}
          </Heading>
          <section className="settings-section" aria-label={t("language.label")}>
            <label className="select-field">
              <span>{t("language.label")}</span>
              <select
                data-testid="language-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguagePreference)}
              >
                <option value="system">
                  {t("language.system", { language: LANGUAGE_NAMES[systemLocale] })}
                </option>
                {Object.entries(LANGUAGE_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-hint">{t("language.hint")}</p>
          </section>
          <section className="settings-section" aria-label={t("settings.theme")}>
            <h3 className="settings-section-title">{t("settings.theme")}</h3>
            <RadioGroup
              aria-label={t("settings.theme")}
              className="theme-choice"
              value={theme}
              onChange={(value) => setTheme(value as ThemeMode)}
            >
              {themeOptions().map((option) => (
                <Radio key={option.value} value={option.value} className="theme-option">
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
            <p className="settings-hint">{t("settings.themeHint")}</p>
          </section>
          <section className="settings-section" aria-label={t("settings.fonts")}>
            <h3 className="settings-section-title">{t("settings.fonts")}</h3>
            <div className="font-grid-head" aria-hidden="true">
              <span>{t("settings.area")}</span>
              <span>{t("settings.family")}</span>
              <span>{t("settings.size")}</span>
            </div>
            <div className="font-settings">
              {fontAreas().map(({ key, label }) => (
                <FontRow
                  key={key}
                  area={key}
                  label={label}
                  fontNames={fontNames}
                  prefs={fonts[key]}
                  onChange={(prefs) => setFontPrefs(key, prefs)}
                />
              ))}
            </div>
          </section>
          <section className="settings-section" aria-label={t("settings.lastConfig")}>
            <h3 className="settings-section-title">{t("settings.lastConfig")}</h3>
            <p className="settings-last-file" data-testid="last-config-file">
              {lastConfigFile ?? t("common.none")}
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
              {t("settings.loadLast")}
            </Button>
            <Button className="btn-ghost" onPress={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 单区字体行；保留未完成的输入，避免逐字符提交非法字号或改变输入区布局。 */
function FontRow({
  area,
  label,
  fontNames,
  prefs,
  onChange,
}: {
  area: FontArea;
  label: string;
  fontNames: string[];
  prefs: FontPrefs;
  onChange: (prefs: FontPrefs) => void;
}) {
  useI18n();
  const listId = `font-candidates-${area}`;
  const [family, setFamily] = useState(prefs.family);
  const [size, setSize] = useState(String(prefs.size ?? ""));
  useEffect(() => {
    setFamily(prefs.family);
    setSize(String(prefs.size ?? ""));
  }, [prefs]);
  const commit = () => {
    const next = {
      family: family.trim(),
      size: size === "" ? null : Math.min(48, Math.max(6, Number(size))),
    };
    setFamily(next.family);
    setSize(String(next.size ?? ""));
    if (next.family !== prefs.family || next.size !== prefs.size) onChange(next);
  };
  return (
    <div className="font-row">
      <span className="font-row-label">{label}</span>
      <input
        className="font-family-input"
        aria-label={t("settings.fontLabel", { area: label })}
        list={listId}
        value={family}
        placeholder={t("common.default")}
        onChange={(event) => setFamily(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <datalist id={listId}>
        {fontNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <input
        className="font-size-input"
        aria-label={t("settings.sizeLabel", { area: label })}
        type="number"
        min={6}
        max={48}
        step={0.5}
        value={size}
        placeholder={t("common.defaultInput")}
        onChange={(event) => setSize(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}
