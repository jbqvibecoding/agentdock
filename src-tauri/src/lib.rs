//! AgentDock core: wires the pure state machine, seats, drivers, mic and hotkeys into Tauri.

pub mod drivers;
pub mod hotkeys;
pub mod mic;
pub mod seats;
pub mod settings;
pub mod state;

use drivers::{app::AppDriver, web, DriverError, ProbeResult, Registry};
use hotkeys::HotkeyAction;
use seats::{DriverKind, Seat, SeatIcon, SeatStatus, SeatsConfig};
use serde::{Deserialize, Serialize};
use settings::AppSettings;
use state::{DockState, Effect, Event, Machine, Phase};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub struct AppState {
    pub machine: Mutex<Machine>,
    pub seats: Mutex<SeatsConfig>,
    pub settings: Mutex<AppSettings>,
    pub registry: Registry,
    pub mic: mic::Mic,
    pub config_dir: PathBuf,
    pub probes: Mutex<HashMap<String, ProbeResult>>,
    pub hotkey_map: Mutex<Vec<(Shortcut, HotkeyAction)>>,
    /// Seats whose login window is currently shown; auto-hidden once a probe says logged in.
    pub logging_in: Mutex<std::collections::HashSet<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeatView {
    #[serde(flatten)]
    pub seat: Seat,
    pub probe: Option<ProbeResult>,
    pub driver_verified: bool,
    pub silent: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DriverInfo {
    pub id: String,
    pub display_name: String,
    pub version: u32,
    pub verified: bool,
    pub kind: String,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ───────────────────────── state & events ─────────────────────────

fn emit_state<R: Runtime>(app: &AppHandle<R>, st: &AppState) {
    let snapshot = st.machine.lock().unwrap().state.clone();
    let _ = app.emit("dock:state", &snapshot);
}

fn emit_seats<R: Runtime>(app: &AppHandle<R>, st: &AppState) {
    let _ = app.emit("seats:changed", &seat_views(st));
}

fn seat_views(st: &AppState) -> Vec<SeatView> {
    let seats = st.seats.lock().unwrap();
    let probes = st.probes.lock().unwrap();
    seats
        .seats
        .iter()
        .map(|s| {
            let driver_id = match &s.driver {
                DriverKind::Web { driver, .. } | DriverKind::App { driver, .. } => driver.as_str(),
            };
            SeatView {
                seat: s.clone(),
                probe: probes.get(&s.id).cloned(),
                driver_verified: st.registry.get(driver_id).map(|d| d.verified).unwrap_or(false),
                silent: matches!(s.driver, DriverKind::Web { .. }),
            }
        })
        .collect()
}

fn dispatch<R: Runtime>(app: &AppHandle<R>, ev: Event) {
    let st = app.state::<AppState>();
    let effects = st.machine.lock().unwrap().handle(ev);
    emit_state(app, &st);
    for fx in effects {
        apply_effect(app, fx);
    }
}

fn apply_effect<R: Runtime>(app: &AppHandle<R>, fx: Effect) {
    let app = app.clone();
    match fx {
        Effect::SystemMute(m) => {
            let st = app.state::<AppState>();
            if st.settings.lock().unwrap().mute_mode == settings::MuteMode::System {
                if let Err(e) = st.mic.set_muted(m) {
                    tracing::warn!("system mute failed: {e}");
                }
            }
            let current = st.machine.lock().unwrap().current_seat().map(str::to_string);
            drop(st);
            if let Some(seat) = current {
                let _ = run_driver(&app, &seat, if m { DriverOp::Mute } else { DriverOp::Unmute });
            }
        }
        Effect::DriverCall(seat) => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_driver(&app, &seat, DriverOp::Call) {
                    tracing::warn!("call {seat} failed: {e}");
                    let reason = match e {
                        DriverError::NeedsAuth => "需要先登录或授权，去设置里连接账号".to_string(),
                        other => format!("呼叫失败：{other}"),
                    };
                    dispatch(&app, Event::ProbeNeedsHuman { seat, reason });
                }
            });
        }
        Effect::DriverHangup(seat) => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_driver(&app, &seat, DriverOp::Hangup) {
                    tracing::warn!("hangup {seat} failed: {e}");
                }
            });
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum DriverOp {
    Call,
    Hangup,
    Mute,
    Unmute,
    Probe,
}

fn run_driver<R: Runtime>(app: &AppHandle<R>, seat_id: &str, op: DriverOp) -> Result<(), DriverError> {
    let st = app.state::<AppState>();
    let seat = st.seats.lock().unwrap().get(seat_id).cloned().ok_or_else(|| DriverError::Unknown(seat_id.into()))?;
    match &seat.driver {
        DriverKind::Web { driver, .. } => {
            let spec = st.registry.get(driver)?;
            let win = web::ensure_webview(app, seat_id, spec)?;
            match op {
                DriverOp::Call => web::run_steps(&win, &spec.call),
                DriverOp::Hangup => web::run_steps(&win, &spec.hangup),
                DriverOp::Mute => web::run_steps(&win, &spec.mute),
                DriverOp::Unmute => web::run_steps(&win, &spec.unmute),
                DriverOp::Probe => web::probe(&win, spec, seat_id),
            }
        }
        DriverKind::App { driver, bundle_id } => {
            let spec = st.registry.get(driver)?;
            if !AppDriver::is_installed(bundle_id) {
                set_seat_status(app, seat_id, SeatStatus::Unavailable);
                return Err(DriverError::Unsupported);
            }
            let res = match op {
                DriverOp::Call => AppDriver::activate(bundle_id).and_then(|_| AppDriver::run_steps(spec, &spec.call)),
                DriverOp::Hangup => AppDriver::run_steps(spec, &spec.hangup),
                DriverOp::Mute => AppDriver::run_steps(spec, &spec.mute),
                DriverOp::Unmute => AppDriver::run_steps(spec, &spec.unmute),
                DriverOp::Probe => AppDriver::probe(spec).map(|r| {
                    ingest_probe(app, seat_id, r);
                }),
            };
            if matches!(res, Err(DriverError::NeedsAuth)) {
                set_seat_status(app, seat_id, SeatStatus::NeedsAuth);
            }
            res
        }
    }
}

fn set_seat_status<R: Runtime>(app: &AppHandle<R>, seat_id: &str, status: SeatStatus) {
    let st = app.state::<AppState>();
    let changed = {
        let mut seats = st.seats.lock().unwrap();
        match seats.get_mut(seat_id) {
            Some(s) if s.status != status => {
                s.status = status;
                true
            }
            _ => false,
        }
    };
    if changed {
        persist_seats(&st);
        emit_seats(app, &st);
    }
}

fn persist_seats(st: &AppState) {
    let seats = st.seats.lock().unwrap();
    if let Err(e) = seats.save(&seats::seats_path(&st.config_dir)) {
        tracing::warn!("saving seats failed: {e}");
    }
}

/// A probe result arrived (from a hidden webview via IPC, or from an app driver).
fn ingest_probe<R: Runtime>(app: &AppHandle<R>, seat_id: &str, result: ProbeResult) {
    let st = app.state::<AppState>();
    st.probes.lock().unwrap().insert(seat_id.to_string(), result.clone());

    let was_pending = st.seats.lock().unwrap().get(seat_id).map(|s| s.status == SeatStatus::Pending).unwrap_or(false);
    let new_status = if result.logged_in {
        SeatStatus::Connected
    } else if was_pending {
        SeatStatus::Pending
    } else {
        SeatStatus::NeedsAuth
    };
    let changed = {
        let mut seats = st.seats.lock().unwrap();
        match seats.get_mut(seat_id) {
            Some(s) => {
                let mut changed = false;
                if s.status != new_status && !(was_pending && !result.logged_in) {
                    s.status = new_status;
                    changed = true;
                }
                if result.account.is_some() && s.account != result.account {
                    s.account = result.account.clone();
                    changed = true;
                }
                changed
            }
            None => false,
        }
    };
    if changed {
        persist_seats(&st);
    }

    // Login window auto-hides once the page reports a session.
    if result.logged_in && st.logging_in.lock().unwrap().remove(seat_id) {
        if let Some(w) = app.get_webview_window(&web::window_label(seat_id)) {
            let _ = web::hide(&w);
        }
    }

    let _ = app.emit("seat:probe", serde_json::json!({ "seatId": seat_id, "result": result }));
    emit_seats(app, &st);

    if result.needs_human {
        dispatch(app, Event::ProbeNeedsHuman { seat: seat_id.to_string(), reason: "页面需要你看一眼（验证或未知弹窗）".into() });
    } else {
        dispatch(app, Event::ProbeInCall { seat: seat_id.to_string(), in_call: result.in_call });
    }
}

// ───────────────────────── commands: dock ─────────────────────────

#[tauri::command]
fn get_state(st: tauri::State<AppState>) -> DockState {
    st.machine.lock().unwrap().state.clone()
}

#[tauri::command]
fn call_seat(app: AppHandle, seat_id: String) {
    dispatch(&app, Event::Call(seat_id));
}

#[tauri::command]
fn hangup(app: AppHandle) {
    dispatch(&app, Event::Hangup);
}

#[tauri::command]
fn toggle_mute(app: AppHandle) {
    dispatch(&app, Event::ToggleMute);
}

#[tauri::command]
fn set_muted(app: AppHandle, muted: bool) {
    dispatch(&app, Event::SetMuted(muted));
}

#[tauri::command]
fn toggle_expanded(app: AppHandle) {
    dispatch(&app, Event::ToggleExpanded);
}

#[tauri::command]
fn set_expanded(app: AppHandle, expanded: bool) {
    dispatch(&app, Event::SetExpanded(expanded));
}

#[tauri::command]
fn undo_switch(app: AppHandle) {
    dispatch(&app, Event::Undo);
}

/// The dock window resizes itself to the exact glass shape so the rest of the screen stays
/// click-through; it stays anchored to the configured snap edge.
#[tauri::command]
fn resize_dock(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let win = app.get_webview_window("dock").ok_or("no dock window")?;
    let snap = app.state::<AppState>().settings.lock().unwrap().snap;
    position_dock(&win, width, height, snap).map_err(err)
}

fn position_dock<R: Runtime>(win: &WebviewWindow<R>, width: f64, height: f64, snap: settings::Snap) -> tauri::Result<()> {
    use settings::Snap::*;
    let monitor = win.current_monitor()?.or(win.primary_monitor()?);
    let (mw, mh, mx, my, scale) = match monitor {
        Some(m) => {
            let s = m.size();
            let p = m.position();
            let sc = m.scale_factor();
            (s.width as f64 / sc, s.height as f64 / sc, p.x as f64 / sc, p.y as f64 / sc, sc)
        }
        None => (1440.0, 900.0, 0.0, 0.0, 1.0),
    };
    let _ = scale;
    let margin = 8.0;
    let x = match snap {
        TopLeft | BottomLeft => mx + margin,
        TopRight | BottomRight => mx + mw - width - margin,
        TopCenter | BottomCenter => mx + (mw - width) / 2.0,
    };
    let y = match snap {
        TopCenter | TopLeft | TopRight => my + margin,
        BottomCenter | BottomLeft | BottomRight => my + mh - height - margin - 70.0,
    };
    win.set_size(tauri::LogicalSize::new(width, height))?;
    win.set_position(tauri::LogicalPosition::new(x, y))
}

// ───────────────────────── commands: seats ─────────────────────────

#[tauri::command]
fn get_seats(st: tauri::State<AppState>) -> Vec<SeatView> {
    seat_views(&st)
}

#[tauri::command]
fn save_seats(app: AppHandle, seats: Vec<Seat>) -> CmdResult<()> {
    let st = app.state::<AppState>();
    {
        let mut cfg = st.seats.lock().unwrap();
        cfg.seats = seats;
    }
    persist_seats(&st);
    emit_seats(&app, &st);
    register_hotkeys(&app).map_err(err)?;
    Ok(())
}

#[tauri::command]
fn reorder_seats(app: AppHandle, ids: Vec<String>) -> CmdResult<()> {
    let st = app.state::<AppState>();
    st.seats.lock().unwrap().reorder(&ids);
    persist_seats(&st);
    emit_seats(&app, &st);
    register_hotkeys(&app).map_err(err)
}

#[tauri::command]
fn list_drivers(st: tauri::State<AppState>) -> Vec<DriverInfo> {
    st.registry
        .ids()
        .into_iter()
        .filter_map(|id| st.registry.get(id).ok())
        .map(|d| DriverInfo {
            id: d.id.clone(),
            display_name: d.display_name.clone(),
            version: d.version,
            verified: d.verified,
            kind: if d.url.is_some() { "web".into() } else { "app".into() },
        })
        .collect()
}

/// Web seat: show the hidden webview as a real login window; it hides itself once logged in.
/// App seat: open the OS accessibility settings so the user can grant permission.
#[tauri::command]
fn connect_account(app: AppHandle, seat_id: String) -> CmdResult<()> {
    let st = app.state::<AppState>();
    let seat = st.seats.lock().unwrap().get(&seat_id).cloned().ok_or("unknown seat")?;
    match &seat.driver {
        DriverKind::Web { driver, .. } => {
            let spec = st.registry.get(driver).map_err(err)?;
            let win = web::ensure_webview(&app, &seat_id, spec).map_err(err)?;
            st.logging_in.lock().unwrap().insert(seat_id.clone());
            web::show(&win).map_err(err)
        }
        DriverKind::App { bundle_id, .. } => {
            if !AppDriver::is_installed(bundle_id) {
                set_seat_status(&app, &seat_id, SeatStatus::Unavailable);
                return Err("该应用尚未安装".into());
            }
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_opener::OpenerExt;
                app.opener().open_url(drivers::app::MACOS_ACCESSIBILITY_SETTINGS, None::<&str>).map_err(err)?;
            }
            Ok(())
        }
    }
}

#[tauri::command]
fn disconnect_seat(app: AppHandle, seat_id: String) -> CmdResult<()> {
    let st = app.state::<AppState>();
    web::disconnect(&app, &seat_id).map_err(err)?;
    st.probes.lock().unwrap().remove(&seat_id);
    {
        let mut seats = st.seats.lock().unwrap();
        if let Some(s) = seats.get_mut(&seat_id) {
            s.status = SeatStatus::NeedsAuth;
            s.account = None;
        }
    }
    persist_seats(&st);
    emit_seats(&app, &st);
    Ok(())
}

/// Bring a seat's hidden page forward (captcha / "needs a human"), or hide it again.
#[tauri::command]
fn show_seat(app: AppHandle, seat_id: String, visible: bool) -> CmdResult<()> {
    let win = app.get_webview_window(&web::window_label(&seat_id)).ok_or("seat has no webview yet")?;
    if visible { web::show(&win) } else { web::hide(&win) }.map_err(err)
}

/// Connect-flow self-check: call, wait for the page to report a call, hang up.
#[tauri::command]
async fn test_call(app: AppHandle, seat_id: String) -> CmdResult<bool> {
    run_driver(&app, &seat_id, DriverOp::Call).map_err(err)?;
    let mut connected = false;
    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _ = run_driver(&app, &seat_id, DriverOp::Probe);
        if app.state::<AppState>().probes.lock().unwrap().get(&seat_id).map(|p| p.in_call).unwrap_or(false) {
            connected = true;
            break;
        }
    }
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let _ = run_driver(&app, &seat_id, DriverOp::Hangup);
    Ok(connected)
}

#[tauri::command]
fn probe_seat(app: AppHandle, seat_id: String) -> CmdResult<()> {
    run_driver(&app, &seat_id, DriverOp::Probe).map_err(err)
}

/// Called from inside a hidden seat webview by the injected probe script.
#[tauri::command]
fn driver_report(app: AppHandle, window: tauri::Window, seat_id: String, result: ProbeResult) {
    if window.label() != web::window_label(&seat_id) {
        tracing::warn!("probe report from unexpected window {}", window.label());
        return;
    }
    ingest_probe(&app, &seat_id, result);
}

#[tauri::command]
fn driver_error(window: tauri::Window, message: String) {
    tracing::warn!("driver error in {}: {message}", window.label());
}

// ───────────────────────── commands: icons ─────────────────────────

fn icons_dir(st: &AppState) -> PathBuf {
    st.config_dir.join("icons")
}

/// Store a user-picked image (png/svg/webp/gif/apng) for a seat. `data_base64` is raw base64.
#[tauri::command]
fn set_seat_icon(app: AppHandle, seat_id: String, file_name: String, data_base64: String) -> CmdResult<String> {
    use base64::Engine;
    let st = app.state::<AppState>();
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "png".into());
    if !["png", "svg", "webp", "gif", "apng", "jpg", "jpeg"].contains(&ext.as_str()) {
        return Err("不支持的图片格式".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.trim()).map_err(err)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("图片不能超过 8 MB".into());
    }
    let dir = icons_dir(&st);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("{seat_id}.{ext}"));
    std::fs::write(&path, bytes).map_err(err)?;
    let rel = format!("icons/{seat_id}.{ext}");
    {
        let mut seats = st.seats.lock().unwrap();
        if let Some(s) = seats.get_mut(&seat_id) {
            s.icon = SeatIcon::Custom { path: rel.clone() };
        }
    }
    persist_seats(&st);
    emit_seats(&app, &st);
    Ok(rel)
}

#[tauri::command]
fn reset_seat_icon(app: AppHandle, seat_id: String) -> CmdResult<()> {
    let st = app.state::<AppState>();
    {
        let mut seats = st.seats.lock().unwrap();
        if let Some(s) = seats.get_mut(&seat_id) {
            s.icon = SeatIcon::Builtin { key: seat_id.clone() };
        }
    }
    persist_seats(&st);
    emit_seats(&app, &st);
    Ok(())
}

/// Custom icon as a data URL (so the UI needs no asset-protocol scope).
#[tauri::command]
fn seat_icon_data(st: tauri::State<AppState>, seat_id: String) -> CmdResult<Option<String>> {
    use base64::Engine;
    let seats = st.seats.lock().unwrap();
    let Some(seat) = seats.get(&seat_id) else { return Ok(None) };
    let SeatIcon::Custom { path } = &seat.icon else { return Ok(None) };
    let full = st.config_dir.join(path);
    let bytes = std::fs::read(&full).map_err(err)?;
    let mime = match full.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "apng" => "image/apng",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "image/png",
    };
    Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

// ───────────────────────── commands: settings ─────────────────────────

#[tauri::command]
fn get_settings(st: tauri::State<AppState>) -> AppSettings {
    st.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> CmdResult<()> {
    let st = app.state::<AppState>();
    *st.settings.lock().unwrap() = settings.clone();
    settings.save(&settings::settings_path(&st.config_dir)).map_err(err)?;
    let _ = app.emit("settings:changed", &settings);
    register_hotkeys(&app).map_err(err)?;
    if let Some(win) = app.get_webview_window("dock") {
        let size = win.inner_size().map_err(err)?;
        let sc = win.scale_factor().unwrap_or(1.0);
        let _ = position_dock(&win, size.width as f64 / sc, size.height as f64 / sc, settings.snap);
    }
    Ok(())
}

#[tauri::command]
fn hotkey_conflicts(st: tauri::State<AppState>, settings: AppSettings) -> Vec<String> {
    let n = st.seats.lock().unwrap().enabled().len();
    hotkeys::conflicts(&settings, n)
}

#[tauri::command]
fn open_settings(app: AppHandle) -> CmdResult<()> {
    let win = app.get_webview_window("settings").ok_or("no settings window")?;
    win.show().and_then(|_| win.set_focus()).map_err(err)
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn host_info() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "vibrancy": cfg!(any(target_os = "macos", target_os = "windows")),
        "version": env!("CARGO_PKG_VERSION"),
    })
}

// ───────────────────────── hotkeys ─────────────────────────

fn register_hotkeys<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let st = app.state::<AppState>();
    let settings = st.settings.lock().unwrap().clone();
    let enabled = st.seats.lock().unwrap().enabled().len();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = Vec::new();
    for (key, action) in hotkeys::bindings(&settings, enabled) {
        match key.parse::<Shortcut>() {
            Ok(sc) => {
                if let Err(e) = gs.register(sc) {
                    tracing::warn!("hotkey {key} unavailable: {e}");
                    continue;
                }
                map.push((sc, action));
            }
            Err(e) => tracing::warn!("bad hotkey {key}: {e}"),
        }
    }
    *st.hotkey_map.lock().unwrap() = map;
    Ok(())
}

fn on_hotkey<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, pressed: bool) {
    let st = app.state::<AppState>();
    let action = st.hotkey_map.lock().unwrap().iter().find(|(s, _)| s == shortcut).map(|(_, a)| a.clone());
    let push_to_talk = st.settings.lock().unwrap().hotkeys.push_to_talk;
    let Some(action) = action else { return };
    match (action, pressed) {
        (HotkeyAction::Toggle, true) if push_to_talk => dispatch(app, Event::SetMuted(false)),
        (HotkeyAction::Toggle, false) if push_to_talk => dispatch(app, Event::SetMuted(true)),
        (HotkeyAction::Toggle, true) => dispatch(app, Event::ToggleExpanded),
        (HotkeyAction::Mute, true) => dispatch(app, Event::ToggleMute),
        (HotkeyAction::Hangup, true) => dispatch(app, Event::Hangup),
        (HotkeyAction::Seat { index }, true) => {
            let id = st.seats.lock().unwrap().enabled().get(index - 1).map(|s| s.id.clone());
            if let Some(id) = id {
                dispatch(app, Event::Call(id));
            }
        }
        _ => {}
    }
}

// ───────────────────────── glass ─────────────────────────

fn apply_glass<R: Runtime>(dock: &WebviewWindow<R>, settings_win: Option<&WebviewWindow<R>>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        // macOS 26+: the real thing — NSGlassEffectView (Liquid Glass). Older systems: vibrancy.
        let glass_ok = liquid_glass::apply(dock, 28.0).unwrap_or_else(|e| {
            tracing::info!("NSGlassEffectView unavailable ({e}); falling back to NSVisualEffectView");
            false
        });
        if !glass_ok {
            if let Err(e) = apply_vibrancy(dock, NSVisualEffectMaterial::HudWindow, Some(NSVisualEffectState::Active), Some(28.0)) {
                tracing::warn!("dock vibrancy: {e}");
            }
        }
        if let Some(w) = settings_win {
            if let Err(e) = apply_vibrancy(w, NSVisualEffectMaterial::Sidebar, None, Some(12.0)) {
                tracing::warn!("settings vibrancy: {e}");
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_acrylic(dock, Some((18, 18, 18, 125))).is_err() {
            let _ = apply_mica(dock, None);
        }
        if let Some(w) = settings_win {
            let _ = apply_mica(w, None);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (dock, settings_win);
    }
}

/// Native Liquid Glass on macOS 26 (Tahoe) and later via `NSGlassEffectView`, looked up at runtime
/// so the binary still runs on older systems. The glass view is inserted *behind* the WKWebView,
/// sized to the window, with the same continuous corner radius the frontend uses.
#[cfg(target_os = "macos")]
mod liquid_glass {
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, ClassType};
    use objc2_foundation::NSObjectProtocol;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSColor, NSView, NSWindow, NSWindowOrderingMode};
    use tauri::{Runtime, WebviewWindow};

    pub fn apply<R: Runtime>(win: &WebviewWindow<R>, corner_radius: f64) -> Result<bool, String> {
        let Some(cls) = objc2::runtime::AnyClass::get(c"NSGlassEffectView") else { return Ok(false) };
        let ns_window = win.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
        if ns_window.is_null() {
            return Err("no NSWindow".into());
        }
        // SAFETY: Tauri hands us a live NSWindow pointer; we only call documented AppKit API on the
        // main thread (Tauri's setup hook runs there).
        unsafe {
            let window: &NSWindow = &*ns_window;
            window.setOpaque(false);
            window.setBackgroundColor(Some(&NSColor::clearColor()));
            let Some(content) = window.contentView() else { return Err("no contentView".into()) };
            let bounds = content.bounds();
            let alloc: Allocated<AnyObject> = msg_send![cls, alloc];
            let glass: Retained<AnyObject> = msg_send![alloc, initWithFrame: bounds];
            let glass_view: &NSView = &*(Retained::as_ptr(&glass) as *const NSView);
            glass_view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
            let _: () = msg_send![&*glass, setCornerRadius: corner_radius];
            let _: () = msg_send![&*glass, setTintColor: std::ptr::null::<AnyObject>()];
            content.addSubview_positioned_relativeTo(glass_view, NSWindowOrderingMode::Below, None);
            // Keep the webview itself transparent so the glass shows through.
            for sub in content.subviews().iter() {
                if !std::ptr::eq(&*sub as *const NSView, glass_view) {
                    let _: () = msg_send![&*sub, setValue: &*NSColor::clearColor(), forKey: &*objc2_foundation::NSString::from_str("backgroundColor")];
                    if sub.respondsToSelector(objc2::sel!(setDrawsBackground:)) {
                        let _: () = msg_send![&*sub, setDrawsBackground: false];
                    }
                }
            }
        }
        let _ = NSView::class();
        Ok(true)
    }
}

// ───────────────────────── tray ─────────────────────────

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏 Dock", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, "quit", "退出 AgentDock", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main").menu(&menu).tooltip("AgentDock").show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).icon_as_template(true);
    }
    builder
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("dock") {
                    if w.is_visible().unwrap_or(true) { let _ = w.hide(); } else { let _ = w.show(); }
                }
            }
            "settings" => {
                let _ = open_settings(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ───────────────────────── run ─────────────────────────

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("agentdock=info".parse().unwrap()))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_hotkey(app, shortcut, event.state() == ShortcutState::Pressed))
                .build(),
        )
        .setup(|app| {
            let config_dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("agentdock"));
            std::fs::create_dir_all(&config_dir).ok();
            let seats = SeatsConfig::load(&seats::seats_path(&config_dir));
            let settings = AppSettings::load(&settings::settings_path(&config_dir));
            let registry = Registry::bundled().with_overrides(&config_dir.join("drivers"));
            let mut machine = Machine::new();
            machine.state.expanded = !matches!(settings.default_form, settings::DefaultForm::Dot | settings::DefaultForm::Pet);
            app.manage(AppState {
                machine: Mutex::new(machine),
                seats: Mutex::new(seats),
                settings: Mutex::new(settings),
                registry,
                mic: mic::Mic::new(),
                config_dir,
                probes: Mutex::new(HashMap::new()),
                hotkey_map: Mutex::new(Vec::new()),
                logging_in: Mutex::new(Default::default()),
            });

            let dock = app.get_webview_window("dock").expect("dock window");
            let settings_win = app.get_webview_window("settings");
            apply_glass(&dock, settings_win.as_ref());
            {
                let snap = app.state::<AppState>().settings.lock().unwrap().snap;
                let _ = position_dock(&dock, 640.0, 140.0, snap);
            }
            if let Some(w) = &settings_win {
                let app2 = app.handle().clone();
                w.on_window_event(move |ev| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                        api.prevent_close();
                        if let Some(w) = app2.get_webview_window("settings") { let _ = w.hide(); }
                    }
                });
            }
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app.handle())?;
            register_hotkeys(app.handle())?;

            // Tick: 1 Hz state ticks; probe the active seat at 2 Hz and idle seats every 10 s.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut n: u64 = 0;
                loop {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    n += 1;
                    if n % 2 == 0 {
                        dispatch(&handle, Event::Tick);
                    }
                    let st = handle.state::<AppState>();
                    let active = st.machine.lock().unwrap().current_seat().map(str::to_string);
                    let phase_idle = matches!(st.machine.lock().unwrap().state.phase, Phase::Idle);
                    let seats: Vec<Seat> = st.seats.lock().unwrap().seats.clone();
                    let logging_in: Vec<String> = st.logging_in.lock().unwrap().iter().cloned().collect();
                    for seat in seats.iter().filter(|s| s.enabled || logging_in.contains(&s.id)) {
                        let is_active = active.as_deref() == Some(seat.id.as_str());
                        let is_login = logging_in.contains(&seat.id);
                        let has_view = handle.get_webview_window(&web::window_label(&seat.id)).is_some();
                        let due = is_active || is_login || (n % 20 == 0 && (has_view || matches!(seat.driver, DriverKind::App { .. })));
                        if due && (!phase_idle || has_view || is_login || matches!(seat.driver, DriverKind::App { .. })) {
                            let _ = run_driver(&handle, &seat.id, DriverOp::Probe);
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state, call_seat, hangup, toggle_mute, set_muted, toggle_expanded, set_expanded, undo_switch, resize_dock,
            get_seats, save_seats, reorder_seats, list_drivers, connect_account, disconnect_seat, show_seat, test_call, probe_seat,
            driver_report, driver_error, set_seat_icon, reset_seat_icon, seat_icon_data,
            get_settings, save_settings, hotkey_conflicts, open_settings, quit, host_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentDock");
}
