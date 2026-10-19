//! App seats (Grok Bot, native Devin): drive the desktop client through the OS accessibility tree.
//! macOS uses System Events via AppleScript (no extra permissions beyond Accessibility);
//! Windows will use UI Automation; other hosts report `Unsupported`.
//!
//! Selectors in `drivers/*.json` for app seats use the mini-grammar `AXRole[Title]`, e.g.
//! `AXButton[Start voice chat]`.

use super::{DriverError, DriverSpec, ProbeResult, Step};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxSelector {
    pub role: String,
    pub title: Option<String>,
}

pub fn parse_selector(s: &str) -> Option<AxSelector> {
    let s = s.trim();
    let (role, rest) = match s.find('[') {
        Some(i) => (&s[..i], Some(&s[i + 1..s.len().checked_sub(1)?])),
        None => (s, None),
    };
    if !role.starts_with("AX") {
        return None;
    }
    Some(AxSelector { role: role.to_string(), title: rest.filter(|t| !t.is_empty()).map(str::to_string) })
}

/// AppleScript that finds the first matching element anywhere in the app's front window and
/// runs `action` on it (bound to `el`). Returns "ok" or "missing".
pub fn applescript_find(bundle_id: &str, sel: &AxSelector, action: &str) -> String {
    let esc = |t: &str| t.replace('\\', "\\\\").replace('"', "\\\"");
    let title_check = match &sel.title {
        Some(t) => {
            let t = esc(t);
            format!("((title of el is \"{t}\") or (description of el is \"{t}\") or (name of el is \"{t}\"))")
        }
        None => "true".to_string(),
    };
    format!(
        r#"tell application "System Events"
  set theApp to first application process whose bundle identifier is "{bundle}"
  set els to (entire contents of window 1 of theApp)
  repeat with el in els
    try
      if (role of el is "{role}") and {title_check} then
        {action}
        return "ok"
      end if
    end try
  end repeat
  return "missing"
end tell"#,
        bundle = esc(bundle_id),
        role = sel.role,
        title_check = title_check,
        action = action,
    )
}

#[derive(Debug, Default)]
pub struct AppDriver;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
}

impl AppDriver {
    pub fn resolve_bundle_id(bundle_id: &str) -> &str {
        if bundle_id == "com.cursor.grokbot" {
            "com.anysphere.sand"
        } else {
            bundle_id
        }
    }

    pub fn is_installed(bundle_id: &str) -> bool {
        #[cfg(target_os = "macos")]
        {
            let bid = Self::resolve_bundle_id(bundle_id);
            let out = std::process::Command::new("osascript")
                .args(["-e", &format!("id of application id \"{bid}\"")])
                .output();
            if out.map(|o| o.status.success()).unwrap_or(false) {
                return true;
            }
            if bid == "com.anysphere.sand" {
                return std::path::Path::new("/Applications/Grok Bot.app").exists();
            }
            return false;
        }
        #[allow(unreachable_code)]
        {
            let _ = bundle_id;
            false
        }
    }

    pub fn is_ax_trusted() -> bool {
        #[cfg(target_os = "macos")]
        unsafe {
            return AXIsProcessTrusted();
        }
        #[allow(unreachable_code)]
        false
    }

    /// Trigger the native macOS Accessibility permission prompt so the current binary is added to
    /// System Settings › Privacy & Security › Accessibility automatically.
    pub fn prompt_ax_trust() -> bool {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2_foundation::{NSNumber, NSString};
            let key = NSString::from_str("AXTrustedCheckOptionPrompt");
            let val = NSNumber::new_bool(true);
            let dict: *mut objc2::runtime::AnyObject = objc2::msg_send![
                objc2::class!(NSDictionary),
                dictionaryWithObject: &*val,
                forKey: &*key
            ];
            return AXIsProcessTrustedWithOptions(dict as *const std::ffi::c_void);
        }
        #[allow(unreachable_code)]
        false
    }

    pub fn run_steps(spec: &DriverSpec, steps: &[Step]) -> Result<(), DriverError> {
        let raw_bundle = spec.bundle_id.as_deref().ok_or(DriverError::Unsupported)?;
        let bundle = Self::resolve_bundle_id(raw_bundle);
        if !Self::is_ax_trusted() {
            return Err(DriverError::NeedsAuth);
        }
        for step in steps {
            match step {
                Step::Click { selectors } => {
                    let mut done = false;
                    for s in selectors {
                        let sel = parse_selector(s).ok_or_else(|| DriverError::Step(format!("bad AX selector {s}")))?;
                        if run_osascript(&applescript_find(bundle, &sel, "perform action \"AXPress\" of el"))? == "ok" {
                            done = true;
                            break;
                        }
                    }
                    if !done {
                        return Err(DriverError::Step(format!("not found: {}", selectors.join(" | "))));
                    }
                }
                Step::Clear { selectors } => {
                    for s in selectors {
                        if let Some(sel) = parse_selector(s) {
                            if run_osascript(&applescript_find(bundle, &sel, "set value of el to \"\""))? == "ok" {
                                break;
                            }
                        }
                    }
                }
                Step::Sleep { ms } => std::thread::sleep(std::time::Duration::from_millis(*ms)),
                Step::WaitFor { selectors, timeout_ms } => {
                    let t0 = std::time::Instant::now();
                    loop {
                        if selectors.iter().filter_map(|s| parse_selector(s)).any(|sel| {
                            run_osascript(&applescript_find(bundle, &sel, "set ok to true")).map(|r| r == "ok").unwrap_or(false)
                        }) {
                            break;
                        }
                        if t0.elapsed().as_millis() as u64 > *timeout_ms {
                            return Err(DriverError::Step("timeout".into()));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                }
                Step::Key { key } => {
                    run_osascript(&format!(
                        "tell application \"System Events\" to keystroke \"{}\"",
                        key.replace('"', "\\\"")
                    ))?;
                }
                Step::Goto { .. } => {}
            }
        }
        Ok(())
    }

    pub fn probe(spec: &DriverSpec) -> Result<ProbeResult, DriverError> {
        let raw_bundle = spec.bundle_id.as_deref().ok_or(DriverError::Unsupported)?;
        let bundle = Self::resolve_bundle_id(raw_bundle);
        if !Self::is_installed(bundle) {
            return Err(DriverError::Unsupported);
        }
        if !Self::is_ax_trusted() {
            return Err(DriverError::NeedsAuth);
        }
        let running = run_osascript(&format!(
            "tell application \"System Events\" to (exists (first application process whose bundle identifier is \"{bundle}\"))"
        ))
        .map(|r| r == "true")
        .unwrap_or(false);
        if !running {
            return Ok(ProbeResult {
                in_call: false,
                muted: false,
                needs_human: false,
                logged_in: true,
                account: None,
                url: None,
            });
        }
        let any = |sels: &[String]| -> bool {
            sels.iter().filter_map(|s| parse_selector(s)).any(|sel| {
                run_osascript(&applescript_find(bundle, &sel, "set ok to true")).map(|r| r == "ok").unwrap_or(false)
            })
        };
        Ok(ProbeResult {
            in_call: any(&spec.probe.in_call),
            muted: any(&spec.probe.muted),
            needs_human: any(&spec.probe.needs_human),
            logged_in: true,
            account: None,
            url: None,
        })
    }

    /// Bring the app forward (needed for AX on some clients), remembering the previous front app.
    pub fn activate(bundle_id: &str) -> Result<(), DriverError> {
        let bid = Self::resolve_bundle_id(bundle_id);
        run_osascript(&format!("tell application id \"{bid}\" to activate")).map(|_| ())
    }
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, DriverError> {
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| DriverError::Step(e.to_string()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("not allowed assistive access") || err.contains("-1719") {
            return Err(DriverError::NeedsAuth);
        }
        return Err(DriverError::Step(err.trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(not(target_os = "macos"))]
fn run_osascript(_script: &str) -> Result<String, DriverError> {
    Err(DriverError::Unsupported)
}

/// Deep link into System Settings › Privacy & Security › Accessibility.
pub const MACOS_ACCESSIBILITY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ax_selectors() {
        assert_eq!(
            parse_selector("AXButton[Start voice chat]"),
            Some(AxSelector { role: "AXButton".into(), title: Some("Start voice chat".into()) })
        );
        assert_eq!(parse_selector("AXTextArea"), Some(AxSelector { role: "AXTextArea".into(), title: None }));
        assert_eq!(parse_selector("button[aria-label]"), None, "CSS selectors are not AX selectors");
    }

    #[test]
    fn applescript_escapes_quotes() {
        let sel = parse_selector("AXButton[Say \"hi\"]").unwrap();
        let s = applescript_find("com.cursor.grokbot", &sel, "set ok to true");
        assert!(s.contains("com.cursor.grokbot"));
        assert!(s.contains("\\\"hi\\\""));
    }
}
