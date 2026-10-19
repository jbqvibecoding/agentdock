//! Seat model and persistence. A seat = one voice-capable agent + the driver that reaches it.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DriverKind {
    /// Hidden, persistent webview pointed at the agent's web app. Fully silent.
    Web { url: String, driver: String },
    /// Native desktop app driven through Accessibility / UI Automation.
    App { bundle_id: String, driver: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SeatIcon {
    /// One of the bundled brand marks, by key (e.g. "dot", "grok-bot").
    Builtin { key: String },
    /// A user-supplied image stored under the app data dir (png/svg/webp/gif/apng).
    Custom { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeatStatus {
    /// Driver ready and session present.
    Connected,
    /// Needs the user to log in (web) or grant permission (app).
    NeedsAuth,
    /// Service available but voice not rolled out to this account yet.
    Pending,
    /// App not installed / probe failed.
    Unavailable,
    /// Never probed.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Seat {
    pub id: String,
    pub name: String,
    pub service: String,
    pub driver: DriverKind,
    pub icon: SeatIcon,
    pub enabled: bool,
    #[serde(default)]
    pub status: SeatStatus,
    #[serde(default)]
    pub account: Option<String>,
}

impl Default for SeatStatus {
    fn default() -> Self {
        SeatStatus::Unknown
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeatsConfig {
    pub seats: Vec<Seat>,
}

impl SeatsConfig {
    /// The default roster: two silent web seats, one app seat, one web seat for Devin
    /// and a reserved Muse seat that stays pending until voice reaches the account.
    pub fn defaults() -> Self {
        let seat = |id: &str, name: &str, service: &str, driver: DriverKind, enabled: bool, status: SeatStatus| Seat {
            id: id.into(),
            name: name.into(),
            service: service.into(),
            driver,
            icon: SeatIcon::Builtin { key: id.into() },
            enabled,
            status,
            account: None,
        };
        SeatsConfig {
            seats: vec![
                seat(
                    "dot",
                    "dot",
                    "ChatGPT dot",
                    DriverKind::Web { url: "https://chatgpt.com/".into(), driver: "chatgpt-dot".into() },
                    true,
                    SeatStatus::Unknown,
                ),
                seat(
                    "grok-bot",
                    "Grok Bot",
                    "Grok Bot",
                    DriverKind::App { bundle_id: "com.anysphere.sand".into(), driver: "grok-bot".into() },
                    true,
                    SeatStatus::Unknown,
                ),
                seat(
                    "copilot",
                    "Copilot",
                    "Copilot Voice",
                    DriverKind::Web { url: "https://copilot.microsoft.com/".into(), driver: "copilot-voice".into() },
                    true,
                    SeatStatus::Unknown,
                ),
                seat(
                    "devin",
                    "Devin",
                    "Devin",
                    DriverKind::Web { url: "https://app.devin.ai/".into(), driver: "devin-voice".into() },
                    false,
                    SeatStatus::Unknown,
                ),
                seat(
                    "muse",
                    "Muse",
                    "Meta Muse",
                    DriverKind::Web { url: "https://muse.ai/".into(), driver: "muse-voice".into() },
                    false,
                    SeatStatus::Pending,
                ),
            ],
        }
    }

    pub fn load(path: &Path) -> Self {
        let mut cfg = match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!("seats.json unreadable ({e}); using defaults");
                Self::defaults()
            }),
            Err(_) => Self::defaults(),
        };
        // Migrate legacy placeholder bundle ID (`com.cursor.grokbot`) to Grok Bot's real macOS bundle ID (`com.anysphere.sand`).
        for s in &mut cfg.seats {
            if let DriverKind::App { bundle_id, driver } = &mut s.driver {
                if driver == "grok-bot" && bundle_id == "com.cursor.grokbot" {
                    *bundle_id = "com.anysphere.sand".into();
                    if s.status == SeatStatus::Unavailable {
                        s.status = SeatStatus::Unknown;
                    }
                }
            }
        }
        cfg
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).expect("seats serialize"))?;
        std::fs::rename(tmp, path)
    }

    pub fn get(&self, id: &str) -> Option<&Seat> {
        self.seats.iter().find(|s| s.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Seat> {
        self.seats.iter_mut().find(|s| s.id == id)
    }

    /// Enabled seats in display order; index + 1 is the ⌥n hotkey.
    pub fn enabled(&self) -> Vec<&Seat> {
        self.seats.iter().filter(|s| s.enabled).collect()
    }

    pub fn reorder(&mut self, ids: &[String]) {
        let mut ordered: Vec<Seat> = Vec::with_capacity(self.seats.len());
        for id in ids {
            if let Some(pos) = self.seats.iter().position(|s| &s.id == id) {
                ordered.push(self.seats.remove(pos));
            }
        }
        ordered.append(&mut self.seats);
        self.seats = ordered;
    }
}

pub fn seats_path(config_dir: &Path) -> PathBuf {
    config_dir.join("seats.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_have_pluggable_roster() {
        let cfg = SeatsConfig::defaults();
        assert_eq!(cfg.enabled().len(), 3, "first release ships 2–3 enabled seats");
        assert_eq!(cfg.get("muse").unwrap().status, SeatStatus::Pending);
        assert!(matches!(cfg.get("grok-bot").unwrap().driver, DriverKind::App { .. }));
        assert!(matches!(cfg.get("dot").unwrap().driver, DriverKind::Web { .. }));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = seats_path(dir.path());
        let mut cfg = SeatsConfig::defaults();
        cfg.get_mut("dot").unwrap().name = "Alfred".into();
        cfg.get_mut("dot").unwrap().icon = SeatIcon::Custom { path: "icons/alfred.gif".into() };
        cfg.save(&path).unwrap();
        let loaded = SeatsConfig::load(&path);
        assert_eq!(loaded, cfg);
    }

    #[test]
    fn missing_or_corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = seats_path(dir.path());
        assert_eq!(SeatsConfig::load(&path), SeatsConfig::defaults());
        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(SeatsConfig::load(&path), SeatsConfig::defaults());
    }

    #[test]
    fn reorder_keeps_unlisted_seats_at_tail() {
        let mut cfg = SeatsConfig::defaults();
        cfg.reorder(&["copilot".into(), "dot".into()]);
        let ids: Vec<_> = cfg.seats.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["copilot", "dot", "grok-bot", "devin", "muse"]);
    }
}
