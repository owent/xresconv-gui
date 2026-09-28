//! Windows WebView2 运行时原生预检（P5-03，PK02：先检查后 GUI）。
//!
//! Windows 发行形态是解压即用的 zip（2026-09-28 用户决策，无安装器）：
//! bootstrap = 系统 Evergreen 运行时（包内附官方 bootstrapper 作为修复
//! 通道）；offline = 内嵌 Fixed Version 运行时（`webview2-runtime/` 目录），
//! 完全离线。预检在任何 WebView 创建之前完成两件事（fail-closed）：
//! - offline 布局：把 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指向包内固定
//!   runtime（相邻目录不被 loader 自动发现；该环境变量优先级最高、提权
//!   宿主下也生效——wry#1782），并补 Win10 Fixed≥120 要求的 AppContainer
//!   读执行 ACL；固定 runtime 由打包合同保证版本 ≥ minimumWebview。
//! - bootstrap：注册表探测 Evergreen（EdgeUpdate Client 官方固定 GUID），
//!   缺失或过旧时弹原生消息框并带可行动诊断退出。
//!
//! 本模块只依赖 windows-registry/windows-sys（无 tauri/wry 类型），
//! `#[cfg(test)]` 引用安全（测试 exe 无 SxS manifest 的 0xc0000139 约束）。

use std::path::Path;

/// exe 旁固定 runtime 目录名（zip offline 布局，package-cli 组装时固定命名）。
pub const FIXED_RUNTIME_DIR: &str = "webview2-runtime";

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

#[cfg_attr(not(windows), allow(dead_code))]
fn installed_version(machine: Option<String>, user: Option<String>) -> Option<String> {
    [machine, user]
        .into_iter()
        .flatten()
        .max_by_key(|version| webview2_major(version).unwrap_or_default())
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
    installed_version(machine.ok(), user.ok())
}

/// 预检决策（纯函数，注入探测）：包内固定 runtime 优先——offline zip 解压
/// 即用、无需任何系统状态；否则按 Evergreen 注册表预检。
#[cfg_attr(not(windows), allow(dead_code))]
enum WebView2Plan {
    /// exe 旁存在 webview2-runtime/msedgewebview2.exe：指向它运行。
    UseFixedRuntime,
    /// 常规 bootstrap 语义：检查系统 Evergreen。
    UseEvergreen,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn webview2_plan(exe_dir: &Path, probe: &dyn Fn(&Path) -> bool) -> WebView2Plan {
    let runtime_entry = exe_dir.join(FIXED_RUNTIME_DIR).join("msedgewebview2.exe");
    if probe(&runtime_entry) {
        WebView2Plan::UseFixedRuntime
    } else {
        WebView2Plan::UseEvergreen
    }
}

/// 原生错误消息框（无 WebView 依赖的 win32 MessageBox）。
#[cfg(windows)]
fn show_missing_dialog() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let text = windows_sys::core::w!(
        "未检测到可用的 Microsoft Edge WebView2 运行时（或版本过旧）。\n\
         \n\
         请先运行解压目录下附带的 MicrosoftEdgeWebview2Setup.exe 安装运行时，\
         再重新启动本应用；或从微软官网安装 Evergreen 运行时：\n\
         https://developer.microsoft.com/microsoft-edge/webview2/\n\
         \n\
         详见解压目录下 runtime-manifest.json 与应用日志。"
    );
    let caption = windows_sys::core::w!("xresconv-gui：缺少 WebView2 运行时");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text, caption, MB_OK | MB_ICONERROR);
    };
}

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

/// Win10 + Fixed Version ≥120 的 unpackaged Win32 要求：runtime 目录须授予
/// ALL APPLICATION PACKAGES（S-1-15-2-2）与 ALL RESTRICTED APPLICATION
/// PACKAGES（S-1-15-2-1）读+执行并随子对象继承——官方 distribution 文档的
/// `icacls <dir> /grant *S-1-15-2-2:(OI)(CI)RX` 等价实现（zip 解压出的目录
/// 不带该 DACL，由壳首次运行时幂等补齐）。返回是否成功；失败不阻塞启动
/// （Win11 无此要求；只读介质上固定 runtime 本就不可用，后续 WebView 创建
/// 自会给出错误）。仅 windows 宿主可达。
#[cfg(windows)]
fn grant_appcontainer_rx(dir: &Path) -> bool {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSidToSidW, GetNamedSecurityInfoW, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE,
        SE_FILE_OBJECT, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
        TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP,
    };
    use windows_sys::Win32::Security::{
        ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
        SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    };
    use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_EXECUTE, FILE_GENERIC_READ};

    let path_w = to_wide(dir);
    let mut old_dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    let get_rc = unsafe {
        GetNamedSecurityInfoW(
            path_w.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut old_dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if get_rc != 0 {
        eprintln!("webview2 fixed-runtime acl: GetNamedSecurityInfoW failed ({get_rc})");
        return false;
    }
    let sid_texts: [windows_sys::core::PCWSTR; 2] = [
        windows_sys::core::w!("S-1-15-2-2"),
        windows_sys::core::w!("S-1-15-2-1"),
    ];
    let mut sids: [PSID; 2] = [std::ptr::null_mut(), std::ptr::null_mut()];
    let mut entries: [EXPLICIT_ACCESS_W; 2] = unsafe { std::mem::zeroed() };
    for (index, (slot, entry)) in sids.iter_mut().zip(entries.iter_mut()).enumerate() {
        // BOOL：0 = 失败。
        if unsafe { ConvertStringSidToSidW(sid_texts[index], slot) } == 0 {
            eprintln!(
                "webview2 fixed-runtime acl: ConvertStringSidToSidW failed for slot {index}"
            );
            unsafe {
                LocalFree(descriptor as _);
            }
            return false;
        }
        entry.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
        entry.grfAccessMode = GRANT_ACCESS;
        entry.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        entry.Trustee.pMultipleTrustee = std::ptr::null_mut();
        entry.Trustee.MultipleTrusteeOperation = NO_MULTIPLE_TRUSTEE;
        entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        entry.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
        entry.Trustee.ptstrName = *slot as _;
    }
    let mut new_dacl: *mut ACL = std::ptr::null_mut();
    let set_rc =
        unsafe { SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), old_dacl, &mut new_dacl) };
    let applied = if set_rc == 0 && !new_dacl.is_null() {
        let rc = unsafe {
            SetNamedSecurityInfoW(
                path_w.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                new_dacl,
                std::ptr::null_mut(),
            )
        };
        if rc != 0 {
            eprintln!("webview2 fixed-runtime acl: SetNamedSecurityInfoW failed ({rc})");
            false
        } else {
            true
        }
    } else {
        eprintln!("webview2 fixed-runtime acl: SetEntriesInAclW failed ({set_rc})");
        false
    };
    unsafe {
        if !new_dacl.is_null() {
            LocalFree(new_dacl as _);
        }
        LocalFree(descriptor as _);
    }
    applied
}

/// 在创建任何窗口前执行；不满足时弹诊断并以退出码 2 终止（可区分于正常退出）。
pub fn ensure_webview2_or_exit() {
    #[cfg(windows)]
    {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf));
        match exe_dir {
            Some(dir) if matches!(webview2_plan(&dir, &|p| p.is_file()), WebView2Plan::UseFixedRuntime) => {
                let runtime = dir.join(FIXED_RUNTIME_DIR);
                // loader 按 env var 定位固定 runtime（相对 exe 的路径需绝对化；
                // env var 优先级高于注册表与 API 参数，提权宿主下也生效）。
                // 启动单线程阶段设置，无并发读环境变量的竞态。
                unsafe {
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &runtime);
                }
                grant_appcontainer_rx(&runtime);
            }
            _ => {
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
        }
    }
    #[cfg(not(windows))]
    {
        // macOS/Linux 使用系统 WebView（WKWebView/WebKitGTK），策略见 05 册。
    }
}

#[cfg(test)]
mod tests {
    use super::{
        installed_version, webview2_acceptable, webview2_major, webview2_plan, WebView2Plan,
        FIXED_RUNTIME_DIR,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn stale_machine_registration_does_not_hide_supported_user_runtime() {
        for machine in ["", "0.0.0.0", "119.0.0.0"] {
            let version = installed_version(Some(machine.into()), Some("153.0.0.0".into()));
            assert!(webview2_acceptable(version.as_deref()));
        }
    }

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
            "{MINIMUM_WEBVIEW2_MAJOR}.0.2210.0",
            MINIMUM_WEBVIEW2_MAJOR = super::MINIMUM_WEBVIEW2_MAJOR
        ))));
        assert!(!webview2_acceptable(Some("119.0.2151.44")));
        assert!(!webview2_acceptable(Some("garbage")));
        assert!(!webview2_acceptable(None));
    }

    #[test]
    fn plan_prefers_bundled_fixed_runtime_when_present() {
        let with_runtime = PathBuf::from("somewhere");
        let probe_hit = |p: &Path| {
            p.ends_with(format!("{FIXED_RUNTIME_DIR}/msedgewebview2.exe").as_str())
        };
        assert!(matches!(
            webview2_plan(&with_runtime, &probe_hit),
            WebView2Plan::UseFixedRuntime
        ));
        let probe_miss = |_: &Path| false;
        assert!(matches!(
            webview2_plan(&with_runtime, &probe_miss),
            WebView2Plan::UseEvergreen
        ));
    }
}
