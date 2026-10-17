//! Web seats: one hidden, persistent `WebviewWindow` per seat with its own data directory.
//! Nothing is ever shown unless the user must log in or solve a challenge.

use super::{steps_script, DriverError, DriverSpec, Step};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub fn window_label(seat_id: &str) -> String {
    format!("seat-{seat_id}")
}

/// Per-seat data directory → cookies/sessions persist and seats never share logins.
pub fn data_dir<R: Runtime>(app: &AppHandle<R>, seat_id: &str) -> std::path::PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("agentdock"));
    base.join("profiles").join(seat_id)
}

/// Get or create the hidden webview for a seat.
pub fn ensure_webview<R: Runtime>(app: &AppHandle<R>, seat_id: &str, spec: &DriverSpec) -> Result<WebviewWindow<R>, DriverError> {
    let label = window_label(seat_id);
    if let Some(w) = app.get_webview_window(&label) {
        return Ok(w);
    }
    let url_str = spec.url.as_deref().ok_or(DriverError::Unsupported)?;
    let url = Url::parse(url_str).map_err(|e| DriverError::Step(e.to_string()))?;
    let dir = data_dir(app, seat_id);
    let _ = std::fs::create_dir_all(&dir);

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(format!("AgentDock · {}", spec.display_name))
        .inner_size(1100.0, 760.0)
        .visible(false)
        .skip_taskbar(true)
        .data_directory(dir)
        .initialization_script(BRIDGE_SCRIPT);
    if let Some(ua) = &spec.user_agent {
        builder = builder.user_agent(ua);
    }
    builder.build().map_err(|e| DriverError::Step(e.to_string()))
}

/// Injected into every seat page before it loads. Keeps the page from pausing media when hidden
/// and tags the document so driver scripts can tell they run inside AgentDock.
const BRIDGE_SCRIPT: &str = r#"
(() => {
  try { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); } catch (_) {}
  document.documentElement.setAttribute('data-agentdock', '1');
})();
"#;

pub fn run_steps<R: Runtime>(win: &WebviewWindow<R>, steps: &[Step]) -> Result<(), DriverError> {
    if steps.is_empty() {
        return Ok(());
    }
    win.eval(&steps_script(steps)).map_err(|e| DriverError::Step(e.to_string()))
}

pub fn probe<R: Runtime>(win: &WebviewWindow<R>, spec: &DriverSpec, seat_id: &str) -> Result<(), DriverError> {
    win.eval(&super::probe_script(&spec.probe, seat_id)).map_err(|e| DriverError::Step(e.to_string()))
}

/// Surface the hidden webview as a normal window (login, captcha). Hidden again by `hide`.
pub fn show<R: Runtime>(win: &WebviewWindow<R>) -> Result<(), DriverError> {
    win.center().ok();
    win.show().and_then(|_| win.set_focus()).map_err(|e| DriverError::Step(e.to_string()))
}

pub fn hide<R: Runtime>(win: &WebviewWindow<R>) -> Result<(), DriverError> {
    win.hide().map_err(|e| DriverError::Step(e.to_string()))
}

/// "Disconnect": close the webview and wipe its data directory (cookies, storage).
pub fn disconnect<R: Runtime>(app: &AppHandle<R>, seat_id: &str) -> Result<(), DriverError> {
    if let Some(w) = app.get_webview_window(&window_label(seat_id)) {
        w.close().map_err(|e| DriverError::Step(e.to_string()))?;
    }
    let dir = data_dir(app, seat_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| DriverError::Step(e.to_string()))?;
    }
    Ok(())
}
