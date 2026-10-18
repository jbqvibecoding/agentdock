//! Global shortcuts → dock events. Shortcut strings are the plugin's own grammar ("Alt+Space").

use crate::settings::AppSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "action")]
pub enum HotkeyAction {
    Toggle,
    Mute,
    Hangup,
    Orientation,
    Form,
    Seat { index: usize },
}

/// Everything that should be registered for the current settings and roster size.
pub fn bindings(settings: &AppSettings, enabled_seats: usize) -> Vec<(String, HotkeyAction)> {
    let mut out = vec![
        (settings.hotkeys.toggle.clone(), HotkeyAction::Toggle),
        (settings.hotkeys.mute.clone(), HotkeyAction::Mute),
        (settings.hotkeys.hangup.clone(), HotkeyAction::Hangup),
        (settings.hotkeys.orientation.clone(), HotkeyAction::Orientation),
        (settings.hotkeys.form.clone(), HotkeyAction::Form),
    ];
    for i in 1..=enabled_seats.min(9) {
        if let Some(k) = settings.seat_hotkey(i) {
            out.push((k, HotkeyAction::Seat { index: i }));
        }
    }
    out
}

/// Keys that collide with each other inside our own config (the UI shows them in red).
pub fn conflicts(settings: &AppSettings, enabled_seats: usize) -> Vec<String> {
    let mut seen = std::collections::HashMap::<String, usize>::new();
    for (k, _) in bindings(settings, enabled_seats) {
        *seen.entry(k.to_ascii_lowercase()).or_default() += 1;
    }
    let mut dup: Vec<String> = seen.into_iter().filter(|(_, n)| *n > 1).map(|(k, _)| k).collect();
    dup.sort();
    dup
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_five_globals_plus_one_per_seat() {
        let b = bindings(&AppSettings::default(), 3);
        assert_eq!(b.len(), 8);
        assert_eq!(b[3], ("Alt+O".to_string(), HotkeyAction::Orientation));
        assert_eq!(b[5], ("Alt+1".to_string(), HotkeyAction::Seat { index: 1 }));
        assert_eq!(bindings(&AppSettings::default(), 12).len(), 14, "seat hotkeys cap at 9");
    }

    #[test]
    fn detects_duplicate_keys() {
        let mut s = AppSettings::default();
        s.hotkeys.mute = "alt+space".into();
        assert_eq!(conflicts(&s, 2), vec!["alt+space".to_string()]);
        assert!(conflicts(&AppSettings::default(), 2).is_empty());
    }
}
