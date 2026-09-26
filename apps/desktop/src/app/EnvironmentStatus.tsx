import { useCallback, useEffect, useState } from "react";
import { Label, ListBox, ListBoxItem } from "react-aria-components";
import { onBackendEvent } from "../adapters/backend";
import {
  type AppInfo,
  type GuardianHealth,
  getAppInfo,
  getBackendHealth,
  getCliMatches,
} from "../adapters/tauri";

/**
 * 顶部环境状态细条（F11/F12；布局对照旧版：配置文件行已移入“转换参数”区，
 * 本区只保留版本/后端健康/启动参数的最小状态条）。
 */
export function EnvironmentStatus() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cliArgs, setCliArgs] = useState<Record<string, unknown>>({});
  const [health, setHealth] = useState<GuardianHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

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
    </header>
  );
}
