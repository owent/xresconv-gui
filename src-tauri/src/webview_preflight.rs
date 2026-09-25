//! Windows WebView2 运行时原生预检（P5-03，PK02：先检查后 GUI）。
//!
//! NSIS 的 bootstrap/offline 变体在安装期负责准备 WebView2；本预检覆盖
//! “安装后运行时被移除/损坏”与直接裸跑 exe 的情形——在任何 WebView 创建
//! 之前用注册表探测（EdgeUpdate Client 官方固定 GUID），缺失或过旧时弹
//! 原生消息框并带可行动诊断退出，不白屏、不依赖创建 WebView 后再报错。
//!
//! 本模块只依赖 windows-registry/windows-sys（无 tauri/wry 类型），
//! `#[cfg(test)]` 引用安全（测试 exe 无 SxS manifest 的 0xc0000139 约束）。

/// WebView2 Evergreen 的 EdgeUpdate Client GUID（微软官方固定值）。
#[cfg(windows)]
const WEBVIEW2_CLIENT_KEY: &str =
    r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
/// per-user 安装位置（无 WOW6432Node 视图）。
#[cfg(windows)]
const WEBVIEW2_CLIENT_KEY_USER: &str =
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
/// 最低 WebView2 大版本（packaging/targets.json 的 minimumWebview=120）。
#[cfg_attr(not(windows), allow(dead_code))]
const MINIMUM_WEBVIEW2_MAJOR: u32 = 120;

/// 解析版本串的主版本号（"153.0.4234.48" → 153）。非法输入返回 None。
// 非 Windows 构建里仅测试引用（预检主体走 windows cfg）。
#[cfg_attr(not(windows), allow(dead_code))]
fn webview2_major(version: &str) -> Option<u32> {
    version.split('.').next()?.parse().ok()
}

/// 预检判定（纯函数，可测）：缺失/无法解析/低于最低大版本均不接受。
#[cfg_attr(not(windows), allow(dead_code))]
fn webview2_acceptable(version: Option<&str>) -> bool {
    match version {
        Some(v) => webview2_major(v).is_some_and(|major| major >= MINIMUM_WEBVIEW2_MAJOR),
        None => false,
    }
}

/// 读取已安装 WebView2 运行时版本（per-machine 或 per-user 任一）。
#[cfg(windows)]
fn webview2_runtime_version() -> Option<String> {
    let machine = windows_registry::LOCAL_MACHINE
        .open(WEBVIEW2_CLIENT_KEY)
        .and_then(|key| key.get_string("pv"));
    let user = windows_registry::CURRENT_USER
        .open(WEBVIEW2_CLIENT_KEY_USER)
        .and_then(|key| key.get_string("pv"));
    machine.ok().or(user.ok())
}

/// 原生错误消息框（无 WebView 依赖的 win32 MessageBox）。
#[cfg(windows)]
fn show_missing_dialog() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let text = windows_sys::core::w!(
        "未检测到可用的 Microsoft Edge WebView2 运行时（或版本过旧）。\n\
         \n\
         请重新运行本应用的安装程序（安装器会自动准备运行时），\
         或从微软官网安装 Evergreen 运行时：\n\
         https://developer.microsoft.com/microsoft-edge/webview2/\n\
         \n\
         详见安装目录下 runtime-manifest.json 与应用日志。"
    );
    let caption = windows_sys::core::w!("xresconv-gui：缺少 WebView2 运行时");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text, caption, MB_OK | MB_ICONERROR);
    };
}

/// 在创建任何窗口前执行；不满足时弹诊断并以退出码 2 终止（可区分于正常退出）。
pub fn ensure_webview2_or_exit() {
    #[cfg(windows)]
    {
        let version = webview2_runtime_version();
        if !webview2_acceptable(version.as_deref()) {
            eprintln!(
                "webview2 preflight failed: {:?} (minimum major {MINIMUM_WEBVIEW2_MAJOR})",
                version.as_deref().unwrap_or("<not installed>")
            );
            show_missing_dialog();
            std::process::exit(2);
        }
    }
    #[cfg(not(windows))]
    {
        // macOS/Linux 使用系统 WebView（WKWebView/WebKitGTK），策略见 05 册。
    }
}

#[cfg(test)]
mod tests {
    use super::{MINIMUM_WEBVIEW2_MAJOR, webview2_acceptable, webview2_major};

    #[test]
    fn major_parses_first_component() {
        assert_eq!(webview2_major("153.0.4234.48"), Some(153));
        assert_eq!(webview2_major("120.0.0.0"), Some(120));
        assert_eq!(webview2_major(""), None);
        assert_eq!(webview2_major("x.1.2"), None);
    }

    #[test]
    fn acceptable_requires_present_and_recent_enough() {
        assert!(webview2_acceptable(Some("153.0.4234.48")));
        assert!(webview2_acceptable(Some(&format!(
            "{MINIMUM_WEBVIEW2_MAJOR}.0.2210.0"
        ))));
        assert!(!webview2_acceptable(Some("119.0.2151.44")));
        assert!(!webview2_acceptable(Some("garbage")));
        assert!(!webview2_acceptable(None));
    }
}
