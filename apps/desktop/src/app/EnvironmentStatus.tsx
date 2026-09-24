import type { NodeHealth } from "@xresconv/contracts";
import { useCallback, useEffect, useState } from "react";
import { Button, Label, ListBox, ListBoxItem } from "react-aria-components";
import {
  type AppInfo,
  getAppInfo,
  getBackendHealth,
  getCliMatches,
  pickXmlConfig,
} from "../adapters/tauri";
import { useSessionStore } from "./session-store";

/**
 * 顶部环境状态区（docs/plan/04-ui.md §页面和组件边界）。
 * 承载 F01（配置打开/重载入口）、F11（启动参数展示）、F12（版本与后端/Java 环境状态）。
 * 真实的配置加载与 Java 诊断在 P4-02+ 接后端快照；本区只保留 P1 已验证的握手能力。
 */
export function EnvironmentStatus() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cliArgs, setCliArgs] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<NodeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const configPath = useSessionStore((state) => state.configPath);
  const loadConfig = useSessionStore((state) => state.loadConfig);
  const reloadConfig = useSessionStore((state) => state.reload);

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

  const pickConfig = async () => {
    const selected = await pickXmlConfig();
    if (selected !== null) {
      // 选择即加载：快照入 session store（P4-03）；失败经 store.lastError 可见。
      await loadConfig(selected);
    }
  };

  const reloadAll = () => {
    refreshHealth();
    void reloadConfig();
  };

  return (
    <header className="environment-status panel">
      <div className="app-identity">
        {info ? (
          <p className="app-version">
            {info.name} v{info.version} · protocol v{info.protocol_version}
          </p>
        ) : (
          <p className="app-version">loading…</p>
        )}
      </div>
      <div className="config-row">
        {configPath ? (
          <p className="config-path" data-testid="picked-path">
            {configPath}
          </p>
        ) : (
          <p className="config-path empty-state">尚未加载配置文件</p>
        )}
        <Button onPress={pickConfig}>选择 XML 配置…</Button>
        <Button onPress={reloadAll} isDisabled={configPath === null}>
          重载配置
        </Button>
      </div>
      <div className="backend-health">
        {health ? (
          <p role="status" aria-label="后端状态" data-testid="backend-health">
            {`guardian ok · node ${health.node} · pid ${health.pid}`}
            {health.backend
              ? ` · backend ok · pid ${health.backend.pid} · protocol v${health.backend.protocol_version}`
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
        <p className="empty-state">Java 环境：尚未检查（P4-02 接入诊断）</p>
      </div>
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
    </header>
  );
}
