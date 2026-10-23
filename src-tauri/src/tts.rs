//! Reading a remote member's answer aloud with macOS's own speech (`/usr/bin/say`). The text goes
//! in on stdin, never on the command line. Elsewhere (Linux CI, the browser mock) there is no
//! voice: speaking returns at once.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Bumped by `stop`: a reading started before it ends at its next check.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// How a reading ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spoke {
    Done,
    Stopped,
    /// No speech here (not macOS, or `say` failed): the text is in the room's record all the same.
    Unavailable,
}

/// Read `text` aloud and wait until it is done or `stop` is called. Blocking: run it off the UI
/// and while holding the driver lane, so no call is live and nothing dials meanwhile.
pub fn speak(text: &str, voice: Option<&str>) -> Spoke {
    let gen = GENERATION.load(Ordering::SeqCst);
    if !cfg!(target_os = "macos") || !std::path::Path::new("/usr/bin/say").is_file() {
        return Spoke::Unavailable;
    }
    let mut cmd = Command::new("/usr/bin/say");
    if let Some(v) = voice.filter(|v| !v.is_empty() && !v.starts_with('-')) {
        cmd.arg("-v").arg(v);
    }
    let Ok(mut child) = cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else { return Spoke::Unavailable };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return if status.success() { Spoke::Done } else { Spoke::Unavailable },
            Ok(None) if GENERATION.load(Ordering::SeqCst) != gen => {
                let _ = child.kill();
                let _ = child.wait();
                return Spoke::Stopped;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Spoke::Unavailable,
        }
    }
}

/// Stop whatever is being read (打断, 跳过, hanging up).
pub fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// The voices `say -v ?` lists, as (name, locale).
pub fn voices() -> Vec<(String, String)> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let Ok(out) = Command::new("/usr/bin/say").args(["-v", "?"]).output() else { return Vec::new() };
    parse_voices(&String::from_utf8_lossy(&out.stdout))
}

/// `Tingting             zh_CN    # 你好！我叫婷婷。` → ("Tingting", "zh_CN"); names may have spaces.
pub fn parse_voices(listing: &str) -> Vec<(String, String)> {
    listing
        .lines()
        .filter_map(|l| {
            let head = l.split('#').next()?.trim_end();
            let (name, locale) = head.rsplit_once(char::is_whitespace)?;
            let locale = locale.trim();
            (locale.contains('_') && !name.trim().is_empty()).then(|| (name.trim().to_string(), locale.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voices_parse_with_spaces_in_names() {
        let listing = "Albert              en_US    # Hello! My name is Albert.\nTingting            zh_CN    # 你好！我叫婷婷。\nGood News           en_US    # Hello!\n\nbroken line\n";
        assert_eq!(parse_voices(listing), vec![("Albert".into(), "en_US".into()), ("Tingting".into(), "zh_CN".into()), ("Good News".into(), "en_US".into())]);
    }

    #[test]
    fn off_macos_speaking_returns_at_once() {
        if !cfg!(target_os = "macos") {
            assert_eq!(speak("hello", None), Spoke::Unavailable);
        }
    }
}
