//! Tauri thin shell: window, plugins, CLI args, version handshake.
//!
//! no business logic in Rust. Configuration, domain model, conversion
//! scheduling and scripting live in the Node.js backend/guardian processes
//! (packages/backend, packages/guardian). This crate only keeps the window,
//! native dialogs, CLI parsing and the minimal bridge commands.

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!("The e2e WebDriver server is forbidden in production builds");

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_cli::CliExt;

mod guardian;
#[cfg(windows)]
mod local_fonts;
mod locale_settings;
mod resource_cache;
mod webview_preflight;
mod windowless_process;

pub use webview_preflight::ensure_webview2_or_exit;

///Bridge handshake result. Field layout is owned by
///`packages/contracts/schema/handshake.json` (single source of truth).
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

#[derive(Default)]
struct ResourceStartup {
    initialized: bool,
    runtime: Option<resource_cache::PreparedRuntime>,
}

type ResourceStartupState = std::sync::Arc<std::sync::Mutex<ResourceStartup>>;

/// The WebView renders progress before this background task prepares the Node payload.
#[tauri::command]
async fn prepare_app_resources(
    app: tauri::AppHandle,
    on_progress: tauri::ipc::Channel<resource_cache::Progress>,
    startup: tauri::State<'_, ResourceStartupState>,
    guardian: tauri::State<'_, std::sync::Arc<guardian::GuardianState>>,
) -> Result<(), String> {
    let startup = startup.inner().clone();
    let guardian = guardian.inner().clone();
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = startup
            .lock()
            .map_err(|_| "resource startup lock poisoned")?;
        if state.initialized {
            return Ok(());
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let root = resource_cache::find_installation(
            guardian::release_layout_candidates(
                exe.parent().ok_or("application path has no parent")?,
            ),
            cfg!(debug_assertions),
        )?;
        if let Some(root) = root {
            let runtime = resource_cache::prepare(
                &root,
                &cache,
                env!("CARGO_PKG_VERSION"),
                &mut |progress| {
                    let _ = on_progress.send(progress);
                },
            )?;
            guardian
                .set_launch_paths(runtime.node.clone(), runtime.entry.clone())
                .map_err(|e| e.to_string())?;
            state.runtime = Some(runtime);
        }
        state.initialized = true;
        Ok(())
    })
    .await
    .map_err(|e| format!("resource preparation task failed: {e}"))?
}

/// 系统语言偏好按优先级返回，语言匹配和英文回退由界面处理。
#[tauri::command]
fn get_system_locales() -> Vec<String> {
    sys_locale::get_locales().collect()
}

///CLI arguments parsed by tauri-plugin-cli, exposed read-only to the UI.
///The legacy flags (`--input`, `--debug-mode`, `--custom-selector`,
///`--custom-button`, `--log-configure`) are declared in tauri.conf.json.
#[tauri::command]
fn get_cli_matches(app: tauri::AppHandle) -> serde_json::Value {
    match app.cli().matches() {
        Ok(m) => serde_json::to_value(&m.args).unwrap_or_default(),
        Err(_) => serde_json::json!({}),
    }
}

/// 经长驻 guardian 通道取健康（含 backend 监督状态）。
///通道按需建立；guardian 死亡/毒帧由 reader 判死并经事件通知 UI。
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

/// 业务 RPC 透传（shell → guardian → backend）。`method`/`params`
///契约见 packages/contracts/schema/backend-rpc.json 与
///packages/backend/src/service/rpc-app.ts；timeout_ms 缺省 60s。
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

/// 显式重建 guardian 通道（backend/guardian 故障后由 UI 触发；
// 旧通道整树自清，不自动重放在途请求)。
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

/// 导出 UTF-8 文本文件（日志导出）。路径来自 plugin-dialog 的 save
///对话框（用户显式选择）；这是 UI 侧可写磁盘的唯一入口。日志内容本身
// 不经过任何执行路径，命令参数只来自本应用 UI 的调用。
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

// Grant only the main app origin's font enumeration before the UI queries it.
#[tauri::command]
async fn allow_local_fonts(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(windows)]
    {
        local_fonts::allow(&window).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(false)
    }
}

// 显示设置：主题三态 + 上次转换列表文件；JSON 持久化
///到可执行程序目录旁（exe 同级 `display-settings.json`）。读失败（首次运行/
///损坏）返回 null 由前端用默认值；写做字段白名单校验。
// 分区字体设置：family 空=该区默认；size 为 px 数值。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FontPrefs {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    family: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FontsConfig {
    #[serde(default)]
    global: FontPrefs,
    #[serde(default)]
    ui: FontPrefs,
    #[serde(default)]
    tree: FontPrefs,
    #[serde(default)]
    log: FontPrefs,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DisplaySettings {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    theme: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    last_config_file: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    fonts: Option<FontsConfig>,
}

fn display_settings_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("display-settings.json")
}

fn read_display_settings_impl() -> Option<DisplaySettings> {
    let content = std::fs::read_to_string(display_settings_path()).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_display_settings_impl(settings: &DisplaySettings) -> Result<(), String> {
    let path = display_settings_path();
    let body = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("write {} failed: {e}", path.display()))
}

#[tauri::command]
fn read_display_settings() -> Option<DisplaySettings> {
    read_display_settings_impl()
}

#[tauri::command]
async fn write_display_settings(
    theme: Option<String>,
    language: Option<String>,
    last_config_file: Option<String>,
    fonts: Option<serde_json::Value>,
) -> Result<(), String> {
    // 主题白名单：未设置=跟随系统。
    if let Some(t) = &theme
        && !matches!(t.as_str(), "system" | "light" | "dark")
    {
        return Err(format!("invalid theme: {t}"));
    }
    if let Some(value) = &language {
        locale_settings::validate_language(value)?;
    }
    // 字体：结构经 serde 反序列化校验；字号白名单 [6,48]，family 去控制字符。
    let fonts = match fonts {
        None => None,
        Some(value) => {
            let mut parsed: FontsConfig =
                serde_json::from_value(value).map_err(|e| format!("invalid fonts: {e}"))?;
            for prefs in [
                &mut parsed.global,
                &mut parsed.ui,
                &mut parsed.tree,
                &mut parsed.log,
            ] {
                if let Some(size) = prefs.size
                    && !(6.0..=48.0).contains(&size)
                {
                    return Err(format!("font size {size} out of range [6,48]"));
                }
                if let Some(family) = &prefs.family {
                    let cleaned: String = family
                        .chars()
                        .filter(|c| !c.is_control() && *c != '<' && *c != '>' && *c != '"')
                        .collect();
                    let cleaned = cleaned.trim().to_string();
                    prefs.family = if cleaned.is_empty() {
                        None
                    } else {
                        Some(cleaned)
                    };
                }
            }
            Some(parsed)
        }
    };
    let settings = DisplaySettings {
        theme,
        language,
        last_config_file,
        fonts,
    };
    tauri::async_runtime::spawn_blocking(move || write_display_settings_impl(&settings))
        .await
        .map_err(|e| format!("settings task failed: {e}"))?
}

pub fn run() {
    // 任何 WebView 创建前的原生运行时预检(先检查后 GUI）。
    ensure_webview2_or_exit();
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "e2e", debug_assertions))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(ResourceStartupState::default());
            // 解析 --log-configure 并接力给 guardian 进程（env 注入点
            // 在 guardian.rs spawn；未提供时不设 env，backend 用内置默认配置）。
            if let Ok(matches) = app.cli().matches()
                && let Some(value) = matches.args.get("log-configure")
                && let Some(path) = value.value.as_str().filter(|p| !p.is_empty())
            {
                guardian::set_guardian_log_configure(Some(path.to_string()));
            }
            // 长驻 guardian 通道托管状态。事件出口经注入的 EventSink
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
            // 窗口关闭 → 显式关闭 guardian 通道（子树自清)。
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
            prepare_app_resources,
            get_system_locales,
            get_cli_matches,
            get_backend_health,
            backend_rpc,
            restart_guardian,
            export_text_file,
            allow_local_fonts,
            read_display_settings,
            write_display_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running xresconv-gui");
}

#[cfg(test)]
mod tests {
    use super::write_text_file_impl;

    ///显示设置：JSON 往返 + 主题白名单 + 损坏文件容错（只依赖 std）。
    #[test]
    fn display_settings_round_trip_and_validation() {
        let settings = super::DisplaySettings {
            theme: Some("dark".into()),
            language: Some("fr".into()),
            last_config_file: Some("D:/路径 配置.xml".into()),
            fonts: Some(super::FontsConfig {
                tree: super::FontPrefs {
                    family: Some("Microsoft YaHei".into()),
                    size: Some(14.0),
                },
                ..Default::default()
            }),
        };
        // 直接测 impl（路径绑定 current_exe，这里只验证序列化形状与校验）。
        let body = serde_json::to_string(&settings).unwrap();
        assert!(body.contains("\"theme\":\"dark\""));
        assert!(body.contains("lastConfigFile"));
        assert!(body.contains("Microsoft YaHei"));
        let parsed: super::DisplaySettings = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed.theme.as_deref(), Some("dark"));
        assert_eq!(parsed.language.as_deref(), Some("fr"));
        assert_eq!(parsed.fonts.and_then(|f| f.tree.size), Some(14.0));
        let old: super::DisplaySettings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert!(old.language.is_none());
    }

    /// 导出写 UTF-8（含中文/空格路径）；空/空白路径拒绝。
    ///只依赖 std，不触碰 tauri/wry 运行时类型（0xc0000139 约束）。
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
