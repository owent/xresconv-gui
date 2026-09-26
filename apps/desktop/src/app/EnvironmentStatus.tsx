import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from "react-aria-components";
import { backendRpc, onBackendEvent } from "../adapters/backend";
import {
  type AppInfo,
  type GuardianHealth,
  getAppInfo,
  getBackendHealth,
  getCliMatches,
} from "../adapters/tauri";
import {
  type FontArea,
  type FontPrefs,
  type ThemeMode,
  useDisplaySettings,
} from "./display-settings";

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
      if (families.length > 0) return families.sort((a, b) => a.localeCompare(b));
    } catch {
      /* 权限拒绝/不支持 → 回退词表 */
    }
  }
  return FALLBACK_FONTS;
}

/** checkJava 结果（镜像 backend java-env.ts JavaCheckResult + downloadHints）。 */
interface JavaStatus {
  ok: boolean;
  versionText: string;
  bit64: boolean;
  executable: { command: string; source: string };
  problem: string | null;
  downloadHints: { name: string; url: string }[];
}

/** Java 状态一行摘要：来源标记 + 版本首行（多行版本取首行）。 */
function javaSummary(java: JavaStatus): string {
  if (java.problem !== null && java.versionText === "") {
    return `Java：${java.problem}`;
  }
  const firstLine = java.versionText.split("\n")[0] ?? "";
  const source =
    java.executable.source === "explicit"
      ? "（XRESCONV_JAVA）"
      : java.executable.source === "java-home"
        ? "（JAVA_HOME）"
        : "";
  return `Java：${firstLine}${source}`;
}

/**
 * 顶部环境状态细条（F11/F12 + Java 运行时检查，2026-09-26 恢复旧版
 * conv_env_check 语义）+ 显示设置入口（独立分组面板）。Java 检查经 backend
 * checkJava RPC（实际转换用同一解析，显示与执行一致）；不满足时展示
 * 旧版推荐下载列表。
 */
export function EnvironmentStatus() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cliArgs, setCliArgs] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<GuardianHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [java, setJava] = useState<JavaStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontNames, setFontNames] = useState<string[]>(FALLBACK_FONTS);
  const { theme, lastConfigFile, fonts, setTheme, setFontPrefs } = useDisplaySettings();

  useEffect(() => {
    void enumerateFonts().then(setFontNames);
  }, []);

  const refreshHealth = useCallback(() => {
    getBackendHealth()
      .then((snapshot) => {
        setHealth(snapshot);
        setHealthError(null);
      })
      .catch((error: unknown) => {
        setHealth(null);
        setHealthError(String(error));
      });
  }, []);

  const refreshJava = useCallback(() => {
    backendRpc<JavaStatus>("checkJava")
      .then((result) => setJava(result))
      .catch(() => {
        /* backend 未就绪时静默；就绪事件后再查 */
      });
  }, []);

  useEffect(
    () =>
      onBackendEvent((event) => {
        const payload = event.payload as { source?: string; type?: string } | null;
        if (
          event.kind === "event" &&
          payload?.source === "backend-supervisor" &&
          (payload.type === "ready" || payload.type === "died")
        ) {
          refreshHealth();
          if (payload.type === "ready") refreshJava();
        }
      }),
    [refreshHealth, refreshJava],
  );

  useEffect(() => {
    let cancelled = false;
    getAppInfo()
      .then((snapshot) => {
        if (!cancelled) setInfo(snapshot);
      })
      .catch(console.error);
    getCliMatches()
      .then((matches) => {
        if (!cancelled) setCliArgs(matches);
      })
      .catch(console.error);
    getBackendHealth()
      .then((snapshot) => {
        if (cancelled) return;
        setHealth(snapshot);
        setHealthError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHealth(null);
        setHealthError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="environment-status panel">
      <p className="app-version">
        {info ? `${info.name} v${info.version} · protocol v${info.protocol_version}` : "loading…"}
      </p>
      {health ? (
        <p role="status" aria-label="后端状态" data-testid="backend-health">
          {`guardian ${health.ok ? "ok" : "failed"} · node ${health.node} · pid ${health.pid}`}
          {health.backend
            ? ` · backend ${health.backend.state} · pid ${health.backend.pid ?? "—"} · generation ${health.backend.generation}`
            : ""}
        </p>
      ) : healthError !== null ? (
        <p role="alert" className="health-error" data-testid="backend-health-error">
          {healthError}
        </p>
      ) : (
        <p role="status" aria-label="后端状态">
          checking…
        </p>
      )}
      {java !== null && (
        <p
          role="status"
          aria-label="Java 运行时"
          data-testid="java-status"
          className={java.ok ? "java-status java-status--ok" : "java-status java-status--bad"}
          title={java.versionText !== "" ? java.versionText : (java.problem ?? "")}
        >
          {javaSummary(java)}
        </p>
      )}
      <details className="cli-args" data-testid="cli-args">
        <summary>启动参数</summary>
        <ListBox aria-label="cli args" items={Object.entries(cliArgs)}>
          {([key, value]) => (
            <ListBoxItem id={key} textValue={key}>
              <Label>{`${key}: ${JSON.stringify(value)}`}</Label>
            </ListBoxItem>
          )}
        </ListBox>
      </details>
      <fieldset className="status-actions">
        <Button className="btn-primary" onPress={() => setSettingsOpen(true)}>
          ⚙ 显示设置
        </Button>
      </fieldset>

      {java !== null && !java.ok && (
        <div className="java-warning" role="alert" aria-label="Java 环境不满足">
          <p>{java.problem ?? "Java 运行时不满足要求"}</p>
          <p className="empty-state">
            请安装 64 位的 JRE 或 JDK 8 或以上（可用环境变量 XRESCONV_JAVA 指定 java 路径、JAVA_HOME
            指定 JDK 目录），推荐发行版：
            {java.downloadHints.map((hint) => hint.name).join("、")}
          </p>
        </div>
      )}

      <ModalOverlay
        className="confirm-overlay"
        isOpen={settingsOpen}
        onOpenChange={(open) => {
          if (!open) setSettingsOpen(false);
        }}
      >
        <Modal className="confirm-modal settings-modal">
          <Dialog aria-label="显示设置" className="confirm-dialog">
            <Heading slot="title">显示设置</Heading>
            <RadioGroup
              aria-label="主题"
              value={theme}
              onChange={(value) => setTheme(value as ThemeMode)}
            >
              <Label>主题</Label>
              {THEME_OPTIONS.map((option) => (
                <Radio key={option.value} value={option.value}>
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
            <fieldset className="font-settings">
              {FONT_AREAS.map(({ key, label }) => (
                <FontRow
                  key={key}
                  label={label}
                  fontNames={fontNames}
                  prefs={fonts[key]}
                  onChange={(prefs) => setFontPrefs(key, prefs)}
                />
              ))}
            </fieldset>
            <p className="empty-state" data-testid="last-config-file">
              上次转换列表：{lastConfigFile ?? "（无）"}
            </p>
            <div className="confirm-actions">
              <Button
                className="btn-primary"
                onPress={() => {
                  if (lastConfigFile !== null) {
                    void import("./session-store").then(({ useSessionStore }) => {
                      void useSessionStore.getState().loadConfig(lastConfigFile);
                    });
                  }
                  setSettingsOpen(false);
                }}
                isDisabled={lastConfigFile === null}
              >
                立即加载上次文件
              </Button>
              <Button onPress={() => setSettingsOpen(false)}>关闭</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </header>
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
