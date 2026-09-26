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
import { onBackendEvent } from "../adapters/backend";
import {
  type AppInfo,
  type GuardianHealth,
  getAppInfo,
  getBackendHealth,
  getCliMatches,
} from "../adapters/tauri";
import { type ThemeMode, useDisplaySettings } from "./display-settings";
import { useSessionStore } from "./session-store";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
];

/**
 * 顶部环境状态细条（F11/F12）+ 显示设置入口（2026-09-26 用户需求）：
 * 主题三态（跟随系统/亮/暗，持久化到可执行程序目录）与上次转换列表文件
 * 展示；配置文件行在“转换参数”区，本区只保留最小状态与设置。
 */
export function EnvironmentStatus() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cliArgs, setCliArgs] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<GuardianHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, lastConfigFile, setTheme } = useDisplaySettings();

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

  useEffect(
    () =>
      onBackendEvent((event) => {
        const payload = event.payload as { source?: string; type?: string } | null;
        if (
          event.kind === "event" &&
          payload?.source === "backend-supervisor" &&
          (payload.type === "ready" || payload.type === "died")
        )
          refreshHealth();
      }),
    [refreshHealth],
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
      <Button className="btn-ghost" aria-label="显示设置" onPress={() => setSettingsOpen(true)}>
        ⚙
      </Button>

      <ModalOverlay
        className="confirm-overlay"
        isOpen={settingsOpen}
        onOpenChange={(open) => {
          if (!open) setSettingsOpen(false);
        }}
      >
        <Modal className="confirm-modal">
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
            <p className="empty-state" data-testid="last-config-file">
              上次转换列表：{lastConfigFile ?? "（无）"}
              <br />
              （下次启动时自动加载；设置保存在可执行程序目录）
            </p>
            <div className="confirm-actions">
              <Button
                className="btn-primary"
                onPress={() => {
                  if (lastConfigFile !== null) {
                    void useSessionStore.getState().loadConfig(lastConfigFile);
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
