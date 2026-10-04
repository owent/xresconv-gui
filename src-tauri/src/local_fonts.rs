//! Windows font permission belongs to the desktop shell, not the web page.
//! Keep native WebView types out of modules referenced by shell unit tests.

use tauri::Manager;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    ICoreWebView2_13, ICoreWebView2Profile4,
};
use webview2_com::SetPermissionStateCompletedHandler;
use windows::core::{Interface, PCWSTR};

pub async fn allow(window: &tauri::WebviewWindow) -> Result<bool, String> {
    let url = window.url().map_err(|error| error.to_string())?;
    let app_origin = matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none();
    let dev_origin = cfg!(debug_assertions)
        && window
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| dev.origin() == url.origin());
    if window.label() != "main" || !(app_origin || dev_origin) {
        return Err("local font permission is restricted to the main app origin".into());
    }

    let origin: Vec<u16> = url
        .origin()
        .ascii_serialization()
        .encode_utf16()
        .chain([0])
        .collect();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| {
            let completed = tx.clone();
            let handler = SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                let _ = completed.send(result.map(|()| true).map_err(|error| error.to_string()));
                Ok(())
            }));
            // Tauri executes this closure on the UI thread. The UTF-16 origin
            // remains alive for the call; WebView2 retains the completion handler.
            let result = unsafe {
                (|| -> windows::core::Result<()> {
                    let core: ICoreWebView2_13 = webview.controller().CoreWebView2()?.cast()?;
                    let profile: ICoreWebView2Profile4 = core.Profile()?.cast()?;
                    // Updates a previous denial too, and persists for this origin.
                    profile.SetPermissionState(
                        COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS,
                        PCWSTR(origin.as_ptr()),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &handler,
                    )
                })()
            };
            if let Err(error) = result {
                let _ = tx.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    // Never block the UI/COM thread while waiting for its asynchronous callback.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("local font authorization did not complete: {error}"))?
    })
    .await
    .map_err(|error| error.to_string())?
}
