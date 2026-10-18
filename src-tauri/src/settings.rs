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
    pub show_names: ShowNames,
    pub reduce_motion: bool,
    /// 0.0–1.0, how strong the glass tint is on top of the system material.
    pub material_strength: f32,
    pub hotkeys: Hotkeys,
    pub mute_mode: MuteMode,
    pub pause_media_in_call: bool,
    pub input_device: Option<String>,
    pub confirm_switch: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            default_form: DefaultForm::Dot,
            theme: Theme::System,
            snap: Snap::TopCenter,
            orientation: Orientation::Horizontal,
            dock_anchor: None,
            show_names: ShowNames::Hover,
            reduce_motion: false,
            material_strength: 0.5,
            hotkeys: Hotkeys {
                toggle: "Alt+Space".into(),
                mute: "Alt+M".into(),
                hangup: "Alt+Escape".into(),
                seat_modifier: "Alt".into(),
                push_to_talk: false,
            },
            mute_mode: MuteMode::System,
            pause_media_in_call: true,
            input_device: None,
            confirm_switch: false,
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
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).expect("settings serialize"))?;
        std::fs::rename(tmp, path)
    }

    pub fn seat_hotkey(&self, index_1_based: usize) -> Option<String> {
        (1..=9).contains(&index_1_based).then(|| format!("{}+{}", self.hotkeys.seat_modifier, index_1_based))
    }
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn files_written_before_orientation_and_anchor_still_load() {
        let mut v = serde_json::to_value(AppSettings::default()).unwrap();
        let o = v.as_object_mut().unwrap();
        o.remove("orientation");
        o.remove("dock_anchor");
        let s: AppSettings = serde_json::from_value(v).unwrap();
        assert_eq!(s, AppSettings::default());
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
