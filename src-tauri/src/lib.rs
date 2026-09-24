//! Tauri thin shell: window, plugins, CLI args, version handshake.
//!
//! D6: no business logic in Rust. Configuration, domain model, conversion
//! scheduling and scripting live in the Node.js backend/guardian processes
//! (packages/backend, packages/guardian). This crate only keeps the window,
//! native dialogs, CLI parsing and the minimal bridge commands.

use serde::Serialize;
use tauri_plugin_cli::CliExt;

/// Bridge handshake result. Field layout is owned by
/// `packages/contracts/schema/handshake.json` (single source of truth).
#[derive(Debug, Clone, Serialize)]
struct Handshake {
    name: &'static str,
    version: &'static str,
    protocol_version: u32,
}

#[tauri::command]
fn get_app_info() -> Handshake {
    Handshake {
        name: "xresconv-gui",
        version: env!("CARGO_PKG_VERSION"),
        protocol_version: 1,
    }
}

/// CLI arguments parsed by tauri-plugin-cli, exposed read-only to the UI.
/// The legacy flags (`--input`, `--debug-mode`, `--custom-selector`,
/// `--custom-button`, `--log-configure`) are declared in tauri.conf.json.
#[tauri::command]
fn get_cli_matches(app: tauri::AppHandle) -> serde_json::Value {
    match app.cli().matches() {
        Ok(m) => serde_json::to_value(&m.args).unwrap_or_default(),
        Err(_) => serde_json::json!({}),
    }
}

/// P1 skeleton: spawn the Node guardian health entry and return its
/// handshake line. Proves shell -> Node spawn/stdio works before P2 builds
/// the real supervised IPC channel.
///
/// Resolution order: `XRESCONV_NODE` env, then `node` on PATH (dev only;
/// packaged builds will use the bundled sidecar path resolved by the
/// supervisor, never PATH). Entry defaults to the workspace
/// `packages/guardian/bin/health-check.mjs`, overridable via
/// `XRESCONV_GUARDIAN_ENTRY`.
#[tauri::command]
async fn get_backend_health() -> Result<serde_json::Value, String> {
    run_health_probe(probe_backend_health).await
}

async fn run_health_probe(
    probe: impl FnOnce() -> Result<serde_json::Value, String> + Send + 'static,
) -> Result<serde_json::Value, String> {
    // An async command must also move blocking process waits off its executor.
    tauri::async_runtime::spawn_blocking(probe)
        .await
        .map_err(|e| format!("health check task failed: {e}"))?
}

fn probe_backend_health() -> Result<serde_json::Value, String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let node = std::env::var("XRESCONV_NODE").unwrap_or_else(|_| "node".into());
    let entry = std::env::var("XRESCONV_GUARDIAN_ENTRY").unwrap_or_else(|_| {
        // Dev fallback: locate the workspace root by walking up from the exe
        // (cwd is unreliable when the app is spawned by tauri-driver).
        let rel = std::path::Path::new("packages")
            .join("guardian")
            .join("bin")
            .join("health-check.mjs");
        let mut dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));
        loop {
            match dir {
                Some(d) if d.join(&rel).is_file() => break d.join(&rel),
                Some(d) => dir = d.parent().map(|p| p.to_path_buf()),
                None => break rel.clone(),
            }
        }
        .to_string_lossy()
        .into_owned()
    });

    let started = Instant::now();
    let mut child = Command::new(&node)
        .arg(&entry)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {node} failed: {e}"))?;

    // Hard deadline: the shell must never hang on a stuck Node process.
    // Must exceed the guardian's own backend deadline (5s) plus process
    // startup overhead, so a guardian that already reported failure is
    // collected instead of killed mid-diagnostic.
    let deadline = Duration::from_secs(15);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "guardian health check timed out after {deadline:?}"
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("collect output failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "guardian exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let line = String::from_utf8_lossy(&output.stdout);
    let first = line.lines().next().unwrap_or_default();
    serde_json::from_str(first).map_err(|e| format!("invalid handshake JSON: {e}; got: {first}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_cli_matches,
            get_backend_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running xresconv-gui");
}

#[cfg(test)]
mod tests {
    use super::run_health_probe;
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    use std::time::Duration;

    #[test]
    fn health_probe_yields_while_waiting_for_child() {
        let (release, wait) = std::sync::mpsc::channel();
        let mut check = Box::pin(run_health_probe(move || {
            wait.recv_timeout(Duration::from_secs(1))
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "ok": true }))
        }));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(matches!(check.as_mut().poll(&mut cx), Poll::Pending));
        release.send(()).unwrap();
        assert_eq!(
            tauri::async_runtime::block_on(check).unwrap(),
            serde_json::json!({ "ok": true })
        );
    }
}
