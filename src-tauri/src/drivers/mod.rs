//! Drivers reach an agent's voice entry. A driver is *data*: a `DriverSpec` (URL, login detector,
//! CSS selectors, step scripts) loaded from `drivers/*.json`, interpreted by a small runtime.
//! Web seats run inside hidden, persistent webviews; app seats go through Accessibility / UIA.

pub mod app;
pub mod web;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "op")]
pub enum Step {
    /// Click the first visible element matching the selector (tries each selector in order).
    Click { selectors: Vec<String> },
    /// Wait for a selector to appear (ms budget).
    WaitFor { selectors: Vec<String>, timeout_ms: u64 },
    Sleep { ms: u64 },
    /// Navigate the hidden webview.
    Goto { url: String },
    /// Press a key on the focused element (web) or the app (native).
    Key { key: String },
    /// Clear a text field so an empty-composer-only button appears.
    Clear { selectors: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProbeSpec {
    /// Any of these present ⇒ in a call.
    pub in_call: Vec<String>,
    /// Any of these present ⇒ seat-level mute is on.
    #[serde(default)]
    pub muted: Vec<String>,
    /// Any of these present ⇒ user must look (captcha, unknown dialog).
    #[serde(default)]
    pub needs_human: Vec<String>,
    /// Any of these present ⇒ logged in.
    pub logged_in: Vec<String>,
    /// URL substrings that mean "this is the login flow".
    #[serde(default)]
    pub login_urls: Vec<String>,
    /// Selector whose text / src gives the account name or avatar.
    #[serde(default)]
    pub account: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriverSpec {
    pub id: String,
    pub display_name: String,
    pub version: u32,
    /// Whether the selectors were pinned against the live product on a real machine.
    #[serde(default)]
    pub verified: bool,
    pub url: Option<String>,
    pub bundle_id: Option<String>,
    pub user_agent: Option<String>,
    pub call: Vec<Step>,
    pub hangup: Vec<Step>,
    #[serde(default)]
    pub mute: Vec<Step>,
    #[serde(default)]
    pub unmute: Vec<Step>,
    pub probe: ProbeSpec,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProbeResult {
    pub in_call: bool,
    pub muted: bool,
    pub needs_human: bool,
    pub logged_in: bool,
    pub account: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum DriverError {
    #[error("no driver named {0}")]
    Unknown(String),
    #[error("driver step failed: {0}")]
    Step(String),
    #[error("seat needs login or permission")]
    NeedsAuth,
    #[error("platform not supported for this driver")]
    Unsupported,
}

/// Bundled driver specs, compiled in so the app works offline; can be overridden by files in
/// `<config>/drivers/*.json` (hot update without shipping a new binary).
pub const BUNDLED: &[(&str, &str)] = &[
    ("chatgpt-dot", include_str!("../../drivers/chatgpt-dot.json")),
    ("copilot-voice", include_str!("../../drivers/copilot-voice.json")),
    ("devin-voice", include_str!("../../drivers/devin-voice.json")),
    ("muse-voice", include_str!("../../drivers/muse-voice.json")),
    ("grok-bot", include_str!("../../drivers/grok-bot.json")),
];

#[derive(Debug, Default)]
pub struct Registry {
    specs: HashMap<String, DriverSpec>,
}

impl Registry {
    pub fn bundled() -> Self {
        let mut r = Registry::default();
        for (id, text) in BUNDLED {
            let spec: DriverSpec = serde_json::from_str(text).unwrap_or_else(|e| panic!("bundled driver {id} invalid: {e}"));
            debug_assert_eq!(&spec.id, id);
            r.specs.insert(spec.id.clone(), spec);
        }
        r
    }

    /// Layer user-provided overrides (hot updates) on top of the bundled set.
    pub fn with_overrides(mut self, dir: &std::path::Path) -> Self {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                match std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<DriverSpec>(&t).ok()) {
                    Some(spec) => {
                        let newer = self.specs.get(&spec.id).map(|cur| spec.version > cur.version).unwrap_or(true);
                        if newer {
                            self.specs.insert(spec.id.clone(), spec);
                        }
                    }
                    None => tracing::warn!("ignoring invalid driver override {}", path.display()),
                }
            }
        }
        self
    }

    pub fn get(&self, id: &str) -> Result<&DriverSpec, DriverError> {
        self.specs.get(id).ok_or_else(|| DriverError::Unknown(id.into()))
    }

    pub fn ids(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self.specs.keys().map(String::as_str).collect();
        v.sort();
        v
    }
}

/// JS that evaluates a probe inside the page and reports back through the Tauri IPC bridge.
/// Kept here (not in web.rs) so it can be unit-tested as a pure string builder.
pub fn probe_script(spec: &ProbeSpec, seat_id: &str) -> String {
    let j = |v: &Vec<String>| serde_json::to_string(v).unwrap();
    format!(
        r#"(() => {{
  const vis = (sel) => Array.from(document.querySelectorAll(sel)).some(el => {{
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }});
  const any = (sels) => sels.some(s => {{ try {{ return vis(s); }} catch (_) {{ return false; }} }});
  const acct = (() => {{ const sel = {account}; if (!sel) return null;
    const el = document.querySelector(sel); if (!el) return null;
    return el.getAttribute('alt') || el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('src') || null; }})();
  const loginUrls = {login_urls};
  const onLogin = loginUrls.some(u => location.href.includes(u));
  const result = {{
    in_call: any({in_call}), muted: any({muted}), needs_human: any({needs_human}),
    logged_in: !onLogin && any({logged_in}), account: acct, url: location.href
  }};
  window.__TAURI_INTERNALS__?.invoke('driver_report', {{ seatId: {seat}, result }});
  return result;
}})()"#,
        account = serde_json::to_string(&spec.account).unwrap(),
        login_urls = j(&spec.login_urls),
        in_call = j(&spec.in_call),
        muted = j(&spec.muted),
        needs_human = j(&spec.needs_human),
        logged_in = j(&spec.logged_in),
        seat = serde_json::to_string(seat_id).unwrap(),
    )
}

/// JS that runs a step list sequentially inside the page.
pub fn steps_script(steps: &[Step]) -> String {
    let steps_json = serde_json::to_string(steps).unwrap();
    format!(
        r#"(async () => {{
  const steps = {steps_json};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const find = (sels) => {{ for (const s of sels) {{ try {{
      const els = Array.from(document.querySelectorAll(s));
      const el = els.find(e => {{ const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }});
      if (el) return el; }} catch (_) {{}} }} return null; }};
  const waitFor = async (sels, ms) => {{ const t0 = Date.now();
    while (Date.now() - t0 < ms) {{ const el = find(sels); if (el) return el; await sleep(100); }} return null; }};
  for (const st of steps) {{
    if (st.op === 'click') {{ const el = await waitFor(st.selectors, 4000); if (!el) throw new Error('not found: ' + st.selectors.join(' | ')); el.click(); }}
    else if (st.op === 'wait_for') {{ if (!(await waitFor(st.selectors, st.timeout_ms))) throw new Error('timeout: ' + st.selectors.join(' | ')); }}
    else if (st.op === 'sleep') {{ await sleep(st.ms); }}
    else if (st.op === 'goto') {{ location.href = st.url; await sleep(1500); }}
    else if (st.op === 'key') {{ const t = document.activeElement || document.body;
      t.dispatchEvent(new KeyboardEvent('keydown', {{ key: st.key, bubbles: true }})); t.dispatchEvent(new KeyboardEvent('keyup', {{ key: st.key, bubbles: true }})); }}
    else if (st.op === 'clear') {{ const el = find(st.selectors); if (el) {{ if ('value' in el) el.value = ''; else el.textContent = ''; el.dispatchEvent(new Event('input', {{ bubbles: true }})); }} }}
  }}
  return 'ok';
}})().catch(e => {{ window.__TAURI_INTERNALS__?.invoke('driver_error', {{ message: String(e) }}); throw e; }})"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_specs_parse_and_cover_every_default_seat() {
        let r = Registry::bundled();
        assert_eq!(r.ids(), ["chatgpt-dot", "copilot-voice", "devin-voice", "grok-bot", "muse-voice"]);
        for id in r.ids() {
            let s = r.get(id).unwrap();
            assert!(!s.call.is_empty(), "{id} has a call sequence");
            assert!(!s.hangup.is_empty(), "{id} has a hangup sequence");
            assert!(!s.probe.in_call.is_empty(), "{id} can detect an active call");
        }
    }

    #[test]
    fn overrides_only_win_when_newer() {
        let dir = tempfile::tempdir().unwrap();
        let mut spec = Registry::bundled().get("copilot-voice").unwrap().clone();
        spec.version += 1;
        spec.display_name = "Copilot (hotfix)".into();
        std::fs::write(dir.path().join("copilot.json"), serde_json::to_string(&spec).unwrap()).unwrap();
        let mut stale = Registry::bundled().get("chatgpt-dot").unwrap().clone();
        stale.version = 0;
        stale.display_name = "stale".into();
        std::fs::write(dir.path().join("dot.json"), serde_json::to_string(&stale).unwrap()).unwrap();
        let r = Registry::bundled().with_overrides(dir.path());
        assert_eq!(r.get("copilot-voice").unwrap().display_name, "Copilot (hotfix)");
        assert_ne!(r.get("chatgpt-dot").unwrap().display_name, "stale");
    }

    #[test]
    fn scripts_embed_selectors_safely() {
        let reg = Registry::bundled();
        let spec = reg.get("chatgpt-dot").unwrap();
        let js = probe_script(&spec.probe, "dot\"); alert(1); (\"");
        assert!(js.contains(r#"invoke('driver_report'"#));
        assert!(js.contains(r#""dot\"); alert(1); (\"""#), "seat id is JSON-escaped");
        let steps = steps_script(&spec.call);
        assert!(steps.contains("\"op\":\"click\""));
    }
}
