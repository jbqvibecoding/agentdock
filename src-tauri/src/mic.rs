//! System-level microphone mute. One switch for every seat, zero latency, independent of any
//! agent's UI. macOS: input volume via CoreAudio-backed AppleScript (built-in mics expose no mute
//! property, so we drop input volume to 0 and restore it). Windows: IAudioEndpointVolume on the
//! default capture endpoint. Linux (dev box): PulseAudio/PipeWire `pactl`.

use std::sync::Mutex;

#[derive(Debug, Default)]
pub struct Mic {
    /// Input level before muting, so unmute restores exactly what the user had.
    saved_level: Mutex<Option<u8>>,
}

#[derive(Debug, thiserror::Error)]
pub enum MicError {
    #[error("microphone control failed: {0}")]
    Backend(String),
}

impl Mic {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_muted(&self, muted: bool) -> Result<(), MicError> {
        if muted {
            let level = backend::input_level()?;
            *self.saved_level.lock().unwrap() = Some(level);
            backend::set_muted(true, 0)
        } else {
            let level = self.saved_level.lock().unwrap().take().unwrap_or(75);
            backend::set_muted(false, level)
        }
    }

    pub fn is_muted(&self) -> Result<bool, MicError> {
        backend::is_muted()
    }
}

#[cfg(target_os = "macos")]
mod backend {
    use super::MicError;
    use std::process::Command;

    fn osascript(script: &str) -> Result<String, MicError> {
        let out = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| MicError::Backend(e.to_string()))?;
        if !out.status.success() {
            return Err(MicError::Backend(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    pub fn input_level() -> Result<u8, MicError> {
        osascript("input volume of (get volume settings)")?
            .parse::<u8>()
            .map_err(|e| MicError::Backend(e.to_string()))
    }

    pub fn set_muted(muted: bool, restore_level: u8) -> Result<(), MicError> {
        let level = if muted { 0 } else { restore_level.max(1) };
        osascript(&format!("set volume input volume {level}")).map(|_| ())
    }

    pub fn is_muted() -> Result<bool, MicError> {
        Ok(input_level()? == 0)
    }
}

#[cfg(target_os = "windows")]
mod backend {
    use super::MicError;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    fn endpoint() -> Result<IAudioEndpointVolume, MicError> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| MicError::Backend(e.to_string()))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eCapture, eCommunications)
                .map_err(|e| MicError::Backend(e.to_string()))?;
            device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .map_err(|e| MicError::Backend(e.to_string()))
        }
    }

    pub fn input_level() -> Result<u8, MicError> {
        let ep = endpoint()?;
        let scalar = unsafe { ep.GetMasterVolumeLevelScalar() }.map_err(|e| MicError::Backend(e.to_string()))?;
        Ok((scalar * 100.0).round() as u8)
    }

    pub fn set_muted(muted: bool, _restore_level: u8) -> Result<(), MicError> {
        let ep = endpoint()?;
        unsafe { ep.SetMute(muted, std::ptr::null()) }.map_err(|e| MicError::Backend(e.to_string()))
    }

    pub fn is_muted() -> Result<bool, MicError> {
        let ep = endpoint()?;
        let m = unsafe { ep.GetMute() }.map_err(|e| MicError::Backend(e.to_string()))?;
        Ok(m.as_bool())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod backend {
    use super::MicError;
    use std::process::Command;

    fn pactl(args: &[&str]) -> Result<String, MicError> {
        let out = Command::new("pactl").args(args).output().map_err(|e| MicError::Backend(e.to_string()))?;
        if !out.status.success() {
            return Err(MicError::Backend(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    pub fn input_level() -> Result<u8, MicError> {
        let text = pactl(&["get-source-volume", "@DEFAULT_SOURCE@"]).unwrap_or_default();
        Ok(text
            .split_whitespace()
            .find_map(|tok| tok.strip_suffix('%').and_then(|n| n.parse::<u8>().ok()))
            .unwrap_or(75))
    }

    pub fn set_muted(muted: bool, _restore_level: u8) -> Result<(), MicError> {
        match pactl(&["set-source-mute", "@DEFAULT_SOURCE@", if muted { "1" } else { "0" }]) {
            Ok(_) => Ok(()),
            // No audio server on a headless dev box: not an error for the UI.
            Err(e) => {
                tracing::warn!("mic mute unavailable on this host: {e}");
                Ok(())
            }
        }
    }

    pub fn is_muted() -> Result<bool, MicError> {
        Ok(pactl(&["get-source-mute", "@DEFAULT_SOURCE@"]).map(|t| t.contains("yes")).unwrap_or(false))
    }
}
