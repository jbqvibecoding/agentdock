//! User-facing settings (appearance, hotkeys, microphone). Persisted as JSON next to seats.json.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DefaultForm {
    Dot,
    Capsule,
    Expanded,
    Pet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Snap {
    /// Not snapped: the pill stays wherever the user dragged it (see `AppSettings::dock_anchor`).
    Free,
    TopCenter,
    BottomCenter,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Horizontal = Spotlight-style bar; Vertical = the same pill stood on end (a side dock).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CollapseMode {
    #[default]
    Auto,
    PinnedExpanded,
    PinnedCollapsed,
}

/// Interface language. `System` follows the first preferred language of the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Language {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-TW")]
    ZhTw,
    #[serde(rename = "ja")]
    Ja,
}

/// Where AgentDock itself shows up on macOS. Clicking the Dock icon opens the settings window;
/// the menu bar icon holds the same menu. At least one of the two is always there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppIcon {
    #[default]
    Both,
    Dock,
    MenuBar,
}

/// Centre of the pill in logical screen px; written when the user drags the dock.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DockAnchor {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShowNames {
    Hover,
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MuteMode {
    /// Mute the OS input device: identical for every seat, zero latency.
    System,
    /// Only press the seat's own mute control.
    Seat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotkeys {
    pub toggle: String,
    pub mute: String,
    pub hangup: String,
    /// Flip the pill between horizontal and vertical.
    #[serde(default = "default_orientation_key")]
    pub orientation: String,
    /// Flip the collapsed form between the small dot and the pet avatar.
    #[serde(default = "default_form_key")]
    pub form: String,
    /// Pause / resume a free discussion in a round-table.
    #[serde(default = "default_discussion_key")]
    pub discussion: String,
    /// Modifier prefix for seat 1–9, e.g. "Alt" → Alt+1 … Alt+9.
    pub seat_modifier: String,
    pub push_to_talk: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub default_form: DefaultForm,
    pub theme: Theme,
    pub snap: Snap,
    #[serde(default)]
    pub orientation: Orientation,
    #[serde(default)]
    pub dock_anchor: Option<DockAnchor>,
    /// Idle seconds before an expanded, un-hovered pill folds back into the dot/pet (0 = never).
    #[serde(default = "default_auto_collapse")]
    pub auto_collapse_secs: u32,
    /// Auto = fold after `auto_collapse_secs`; PinnedExpanded = never fold by itself;
    /// PinnedCollapsed = hover only previews, folds right back when the pointer leaves.
    #[serde(default)]
    pub collapse_mode: CollapseMode,
    pub show_names: ShowNames,
    pub reduce_motion: bool,
    /// 0.0–1.0, how strong the glass tint is on top of the system material.
    pub material_strength: f32,
    /// Proportional scale factor for the entire Dock pill (0.70–1.60, default 1.0).
    #[serde(default = "default_dock_scale")]
    pub dock_scale: f32,
    /// Theme colour as `#rrggbb`: tints the native glass, the glyphs and the lens. `None` = untinted.
    #[serde(default)]
    pub accent: Option<String>,
    pub hotkeys: Hotkeys,
    pub mute_mode: MuteMode,
    pub pause_media_in_call: bool,
    pub input_device: Option<String>,
    pub confirm_switch: bool,
    /// Switching seats mid-call pastes the last turns of the outgoing call into the next web
    /// seat's composer (never sent). The Dock can turn it off for one switch.
    #[serde(default = "default_warm_transfer")]
    pub warm_transfer: bool,
    /// Run web seats in the user's own Chrome (its logins and cookies) when Chrome's remote
    /// debugging is on; otherwise, or when off, use AgentDock's built-in webview.
    #[serde(default = "default_web_via_chrome")]
    pub web_via_chrome: bool,
    #[serde(default)]
    pub app_icon: AppIcon,
    #[serde(default)]
    pub language: Language,
    /// EverOS long-term memory. Off until the user opts in; still a no-op without `EVEROS_API_KEY`.
    #[serde(default)]
    pub memory: MemorySettings,
}

/// Opt-in EverOS memory. The API key is never stored here — only `EVEROS_API_KEY`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorySettings {
    /// Nothing is sent until this is true (or `EVEROS_ENABLED=1`) and a key is present.
    #[serde(default)]
    pub enabled: bool,
    /// Stable EverOS `user_id`. Empty until the first time memory is actually turned on.
    #[serde(default)]
    pub user_id: String,
    /// Paste recalled episodes into a web seat's composer when a call starts.
    #[serde(default = "default_inject_context")]
    pub inject_context: bool,
    /// `search` top_k. `1..=100` is honored; anything else falls back to 5 at request time.
    #[serde(default = "default_top_k")]
    pub top_k: u32,
}

fn default_inject_context() -> bool {
    true
}
fn default_top_k() -> u32 {
    5
}

impl Default for MemorySettings {
    fn default() -> Self {
        MemorySettings {
            enabled: false,
            user_id: String::new(),
            inject_context: true,
            top_k: 5,
        }
    }
}

fn default_auto_collapse() -> u32 {
    8
}
fn default_web_via_chrome() -> bool {
    true
}
fn default_warm_transfer() -> bool {
    true
}
fn default_dock_scale() -> f32 {
    1.0
}
fn default_orientation_key() -> String {
    "Alt+O".into()
}
fn default_form_key() -> String {
    "Alt+P".into()
}
fn default_discussion_key() -> String {
    "Alt+D".into()
}

impl Orientation {
    pub fn toggled(self) -> Self {
        match self {
            Orientation::Horizontal => Orientation::Vertical,
            Orientation::Vertical => Orientation::Horizontal,
        }
    }
}

impl DefaultForm {
    /// Dot ↔ pet; the capsule/expanded forms also jump to the pet first so the key always does something visible.
    pub fn toggled_collapsed(self) -> Self {
        match self {
            DefaultForm::Pet => DefaultForm::Dot,
            _ => DefaultForm::Pet,
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            default_form: DefaultForm::Dot,
            theme: Theme::System,
            snap: Snap::TopCenter,
            orientation: Orientation::Horizontal,
            dock_anchor: None,
            auto_collapse_secs: default_auto_collapse(),
            collapse_mode: CollapseMode::Auto,
            show_names: ShowNames::Hover,
            reduce_motion: false,
            material_strength: 0.5,
            dock_scale: default_dock_scale(),
            accent: None,
            hotkeys: Hotkeys {
                toggle: "Alt+Space".into(),
                mute: "Alt+M".into(),
                hangup: "Alt+Escape".into(),
                orientation: default_orientation_key(),
                form: default_form_key(),
                discussion: default_discussion_key(),
                seat_modifier: "Alt".into(),
                push_to_talk: false,
            },
            mute_mode: MuteMode::System,
            pause_media_in_call: true,
            input_device: None,
            confirm_switch: false,
            warm_transfer: default_warm_transfer(),
            web_via_chrome: default_web_via_chrome(),
            app_icon: AppIcon::Both,
            language: Language::System,
            memory: MemorySettings::default(),
        }
    }
}

impl AppSettings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(self).expect("settings serialize"),
        )?;
        std::fs::rename(tmp, path)
    }

    pub fn seat_hotkey(&self, index_1_based: usize) -> Option<String> {
        (1..=9)
            .contains(&index_1_based)
            .then(|| format!("{}+{}", self.hotkeys.seat_modifier, index_1_based))
    }
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

/// `#rrggbb` (or `rrggbb`) → sRGB components in 0..=1. Anything else is rejected.
pub fn parse_hex_color(s: &str) -> Option<(f64, f64, f64)> {
    let h = s.trim().trim_start_matches('#');
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|v| v as f64 / 255.0);
    Some((c(0)?, c(2)?, c(4)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_hex_parses_and_rejects_garbage() {
        assert_eq!(parse_hex_color("#ff8000"), Some((1.0, 128.0 / 255.0, 0.0)));
        assert_eq!(parse_hex_color("0A84FF"), Some((10.0 / 255.0, 132.0 / 255.0, 1.0)));
        assert_eq!(parse_hex_color("#fff"), None);
        assert_eq!(parse_hex_color("#zzzzzz"), None);
        assert_eq!(AppSettings::default().accent, None);
    }

    #[test]
    fn defaults_match_design() {
        let s = AppSettings::default();
        assert_eq!(s.default_form, DefaultForm::Dot);
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.hotkeys.toggle, "Alt+Space");
        assert_eq!(s.seat_hotkey(3).as_deref(), Some("Alt+3"));
        assert_eq!(s.seat_hotkey(10), None);
    }

    #[test]
    fn toggles_flip_orientation_and_collapsed_form() {
        assert_eq!(Orientation::Horizontal.toggled(), Orientation::Vertical);
        assert_eq!(Orientation::Vertical.toggled(), Orientation::Horizontal);
        assert_eq!(DefaultForm::Dot.toggled_collapsed(), DefaultForm::Pet);
        assert_eq!(DefaultForm::Pet.toggled_collapsed(), DefaultForm::Dot);
        assert_eq!(DefaultForm::Capsule.toggled_collapsed(), DefaultForm::Pet);
    }

    #[test]
    fn files_written_before_orientation_and_anchor_still_load() {
        let mut v = serde_json::to_value(AppSettings::default()).unwrap();
        let o = v.as_object_mut().unwrap();
        o.remove("orientation");
        o.remove("dock_anchor");
        o.remove("auto_collapse_secs");
        o.remove("collapse_mode");
        let hk = o.get_mut("hotkeys").unwrap().as_object_mut().unwrap();
        hk.remove("orientation");
        hk.remove("form");
        v.as_object_mut().unwrap().remove("memory");
        v.as_object_mut().unwrap().remove("web_via_chrome");
        v.as_object_mut().unwrap().remove("app_icon");
        v.as_object_mut().unwrap().remove("language");
        v.as_object_mut().unwrap().remove("warm_transfer");
        let s: AppSettings = serde_json::from_value(v).unwrap();
        assert_eq!(s, AppSettings::default());
        assert!(!s.memory.enabled);
        assert!(s.memory.inject_context);
        assert_eq!(s.memory.top_k, 5);
        assert!(s.warm_transfer, "files from before warm transfer get it on");
    }

    #[test]
    fn partial_json_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = settings_path(dir.path());
        std::fs::create_dir_all(dir.path()).unwrap();
        std::fs::write(&p, r#"{"theme":"dark"}"#).unwrap();
        // Missing fields are an error for serde without defaults → whole file falls back.
        assert_eq!(AppSettings::load(&p), AppSettings::default());
        let mut s = AppSettings::default();
        s.theme = Theme::Dark;
        s.save(&p).unwrap();
        assert_eq!(AppSettings::load(&p), s);
    }
}
