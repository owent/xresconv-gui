import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { NodeHealth } from "@xresconv/contracts";
import { useEffect, useState } from "react";
import { Button, Label, ListBox, ListBoxItem } from "react-aria-components";

interface AppInfo {
  name: string;
  version: string;
  protocol_version: number;
}

/**
 * P1 skeleton: proves the Tauri command round-trip, the native file dialog
 * and the CLI-arg bridge. Real screens arrive in P4 against frozen contracts.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cliArgs, setCliArgs] = useState<Record<string, unknown>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [health, setHealth] = useState<NodeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AppInfo>("get_app_info").then(setInfo).catch(console.error);
    invoke<Record<string, unknown>>("get_cli_matches").then(setCliArgs).catch(console.error);
    invoke<NodeHealth>("get_backend_health")
      .then(setHealth)
      .catch((e: unknown) => setHealthError(String(e)));
  }, []);

  const pickXml = async () => {
    const selected = await open({
      title: "选择转换配置",
      filters: [{ name: "xresconv XML", extensions: ["xml"] }],
    });
    if (typeof selected === "string") setPicked(selected);
  };

  return (
    <main className="shell">
      <h1>xresconv-gui 骨架</h1>
      <section aria-label="应用信息">
        {info ? (
          <p>
            {info.name} v{info.version} · protocol v{info.protocol_version}
          </p>
        ) : (
          <p>loading…</p>
        )}
      </section>
      <section aria-label="启动参数">
        <div data-testid="cli-args">
          <ListBox aria-label="cli args" items={Object.entries(cliArgs)}>
            {([k, v]) => (
              <ListBoxItem id={k} textValue={k}>
                <Label>{`${k}: ${JSON.stringify(v)}`}</Label>
              </ListBoxItem>
            )}
          </ListBox>
        </div>
      </section>
      <section aria-label="Node 服务握手">
        {health ? (
          <p data-testid="backend-health">
            {`guardian ok · node ${health.node} · pid ${health.pid}`}
            {health.backend
              ? ` · backend ok · pid ${health.backend.pid} · protocol v${health.backend.protocol_version}`
              : ""}
          </p>
        ) : (
          <p data-testid="backend-health-error">{healthError ?? "checking…"}</p>
        )}
      </section>
      <section aria-label="配置选择">
        <Button onPress={pickXml}>选择 XML 配置…</Button>
        {picked && <p data-testid="picked-path">{picked}</p>}
      </section>
    </main>
  );
}
