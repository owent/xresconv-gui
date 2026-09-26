//! Tauri thin shell: window, plugins, CLI args, version handshake.
//!
//! D6: no business logic in Rust. Configuration, domain model, conversion
//! scheduling and scripting live in the Node.js backend/guardian processes
//! (packages/backend, packages/guardian). This crate only keeps the window,
//! native dialogs, CLI parsing and the minimal bridge commands.

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_cli::CliExt;

mod guardian;
mod webview_preflight;

pub use webview_preflight::ensure_webview2_or_exit;

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

/// P4-02：经长驻 guardian 通道取健康（含 backend 监督状态）。
/// 通道按需建立；guardian 死亡/毒帧由 reader 判死并经事件通知 UI。
#[tauri::command]
async fn get_backend_health(
    state: tauri::State<'_, std::sync::Arc<guardian::GuardianState>>,
) -> Result<serde_json::Value, String> {
    let state = state.inner().clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || state.with_client(|client| client.health()))
            .await
            .map_err(|e| format!("health task failed: {e}"))?;
    result.map_err(|e| e.to_string())
}

/// P4-02：业务 RPC 透传（shell → guardian → backend）。`method`/`params`
/// 契约见 packages/contracts/schema/backend-rpc.json 与
/// packages/backend/src/service/rpc-app.ts；timeout_ms 缺省 60s。
#[tauri::command]
async fn backend_rpc(
    method: String,
    params: serde_json::Value,
    timeout_ms: Option<u64>,
    state: tauri::State<'_, std::sync::Arc<guardian::GuardianState>>,
) -> Result<serde_json::Value, String> {
    let state = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        state.with_client(|client| {
            client.backend_rpc(
                &method,
                params,
                timeout_ms.map(std::time::Duration::from_millis),
            )
        })
    })
    .await
    .map_err(|e| format!("rpc task failed: {e}"))?;
    result.map_err(|e| e.to_string())
}

/// P4-02：显式重建 guardian 通道（backend/guardian 故障后由 UI 触发；
/// 旧通道整树自清，不自动重放在途请求——SC10）。
#[tauri::command]
async fn restart_guardian(
    state: tauri::State<'_, std::sync::Arc<guardian::GuardianState>>,
) -> Result<serde_json::Value, String> {
    let state = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        state.restart()?;
        state.with_client(|client| client.health())
    })
    .await
    .map_err(|e| format!("restart task failed: {e}"))?;
    result.map_err(|e| e.to_string())
}

/// P4-07：导出 UTF-8 文本文件（日志导出）。路径来自 plugin-dialog 的 save
/// 对话框（用户显式选择）；这是 UI 侧可写磁盘的唯一入口。日志内容本身
/// 不经过任何执行路径（BD-04/R12），命令参数只来自本应用 UI 的调用。
fn write_text_file_impl(path: &str, content: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("export path must not be empty".to_string());
    }
    std::fs::write(path, content.as_bytes()).map_err(|e| format!("write {path} failed: {e}"))
}

#[tauri::command]
async fn export_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_text_file_impl(&path, &content))
        .await
        .map_err(|e| format!("export task failed: {e}"))?
}

pub fn run() {
    // P5-03：任何 WebView 创建前的原生运行时预检（PK02：先检查后 GUI）。
    ensure_webview2_or_exit();
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // F10/F11：解析 --log-configure 并接力给 guardian 进程（env 注入点
            // 在 guardian.rs spawn；未提供时不设 env，backend 用内置默认配置）。
            if let Ok(matches) = app.cli().matches()
                && let Some(value) = matches.args.get("log-configure")
                && let Some(path) = value.value.as_str().filter(|p| !p.is_empty())
            {
                guardian::set_guardian_log_configure(Some(path.to_string()));
            }
            // P4-02：长驻 guardian 通道托管状态。事件出口经注入的 EventSink
            // 转发前端（xresconv-event / xresconv-guardian-dead）；guardian
            // 模块不依赖 tauri 类型，保持 unit test 无 GUI 导入可加载。
            let handle = app.handle().clone();
            let sink: guardian::EventSink = std::sync::Arc::new(move |event, payload| {
                use tauri::Emitter;
                let _ = handle.emit(event, payload);
            });
            app.manage(std::sync::Arc::new(guardian::GuardianState::new(Some(
                sink,
            ))));
            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口关闭 → 显式关闭 guardian 通道（子树自清，P2-09）。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && let Some(state) = window.try_state::<std::sync::Arc<guardian::GuardianState>>()
            {
                api.prevent_close();
                let state = state.inner().clone();
                let window = window.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = state.shutdown() {
                        eprintln!("guardian shutdown failed: {error}");
                    }
                    let _ = window.destroy();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_cli_matches,
            get_backend_health,
            backend_rpc,
            restart_guardian,
            export_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running xresconv-gui");
}

#[cfg(test)]
mod tests {
    use super::write_text_file_impl;

    /// P4-07：导出写 UTF-8（含中文/空格路径）；空/空白路径拒绝。
    /// 只依赖 std，不触碰 tauri/wry 运行时类型（0xc0000139 约束）。
    #[test]
    fn write_text_file_writes_utf8_and_rejects_empty_path() {
        let dir = std::env::temp_dir().join("xresconv-export-test");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("日志 export.txt");
        let path_str = path.to_str().expect("utf-8 path");
        write_text_file_impl(path_str, "[CONV]: 中文 line\n").expect("write ok");
        let content = std::fs::read_to_string(&path).expect("read back");
        assert_eq!(content, "[CONV]: 中文 line\n");
        assert!(write_text_file_impl("", "x").is_err());
        assert!(write_text_file_impl("   ", "x").is_err());
        let _ = std::fs::remove_file(&path);
    }
}
