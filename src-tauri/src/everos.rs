//! EverOS memory client.
//!
//! AgentDock's core is Rust and the agents it dials are external voice apps, so this talks to
//! EverOS over HTTP (`POST /api/v2/memory/{add,search,flush}`) instead of shelling out to the
//! Python SDK (`everos-cloud`). The SDK is a thin wrapper over the same routes; adding a Python
//! runtime to a desktop app would not buy a better call.
//!
//! Cloud base URL is `https://api.evermind.ai`. Self-hosted OSS serves the same v2 routes
//! (default `http://127.0.0.1:8000`); point `EVEROS_BASE_URL` at it. A missing API key disables
//! the client — callers get an empty result, never a panic.
//!
//! `add` is asynchronous on Cloud (`202`, `status: "queued"`). `timestamp` is unix milliseconds.
//! `search` takes exactly one of `user_id` / `agent_id`; we always search the local user.

use crate::settings::MemorySettings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const DEFAULT_BASE_URL: &str = "https://api.evermind.ai";
pub const DEFAULT_APP_ID: &str = "agentdock";
pub const DEFAULT_PROJECT_ID: &str = "default";
/// Hybrid search is typically 200–600ms. This caps a stuck call so the dialer never waits on it.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Marker the injector looks for so a second recall does not paste twice.
pub const MEMORY_MARKER: &str = "[AgentDock memory]";
const CONTEXT_CHARS: usize = 1800;
/// Seconds-scale timestamps are rejected by EverOS (`422`), not rescaled.
const MIN_TIMESTAMP_MS: u64 = 1_000_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryEnv {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
    pub app_id: Option<String>,
    pub project_id: Option<String>,
    /// `Some` overrides [`MemorySettings::enabled`].
    pub enabled: Option<bool>,
}

impl MemoryEnv {
    pub fn from_env() -> Self {
        Self {
            api_key: std::env::var("EVEROS_API_KEY").ok(),
            base_url: std::env::var("EVEROS_BASE_URL").ok(),
            user_id: std::env::var("EVEROS_USER_ID").ok(),
            app_id: std::env::var("EVEROS_APP_ID").ok(),
            project_id: std::env::var("EVEROS_PROJECT_ID").ok(),
            enabled: std::env::var("EVEROS_ENABLED")
                .ok()
                .as_deref()
                .and_then(parse_enabled_flag),
        }
    }
}

/// `1` / `true` / `yes` / `on` → enable, `0` / `false` / `no` / `off` → disable, anything else → ignore.
pub fn parse_enabled_flag(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" => None,
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

/// Safe to show in the settings window. Never carries the API key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Status {
    pub active: bool,
    pub enabled: bool,
    pub key_present: bool,
    pub base_url: String,
    pub user_id: String,
    pub app_id: String,
    pub project_id: String,
    pub reason: String,
    pub inject_context: bool,
    pub top_k: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum EverOsError {
    #[error("everos memory is disabled")]
    Disabled,
    #[error("everos request timed out")]
    Timeout,
    #[error("everos http {status}: {body}")]
    Http { status: u16, body: String },
    #[error("everos transport: {0}")]
    Transport(String),
    #[error("everos response: {0}")]
    Decode(String),
    #[error("everos invalid request: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutMessage {
    pub sender_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_name: Option<String>,
    pub role: String,
    pub timestamp: u64,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct SearchData {
    #[serde(default)]
    pub episodes: Vec<Episode>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub unprocessed_messages: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Episode {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub episode: String,
    #[serde(default)]
    pub atomic_facts: Vec<AtomicFact>,
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct AtomicFact {
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Profile {
    #[serde(default)]
    pub profile_data: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct Envelope<T> {
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Default, Deserialize)]
struct AddData {
    #[serde(default)]
    status: String,
    #[serde(default)]
    message_count: u32,
}

#[derive(Debug, Default, Deserialize)]
struct FlushData {
    #[serde(default)]
    status: String,
}

#[derive(Clone)]
struct Live {
    http: ureq::Agent,
    api_key: String,
    base_url: String,
    user_id: String,
    app_id: String,
    project_id: String,
}

#[derive(Clone)]
enum Inner {
    Off,
    On(Live),
}

/// Clone is cheap (the HTTP client is internally reference-counted). The key stays inside `On`.
#[derive(Clone)]
pub struct Client {
    inner: Inner,
    status: Status,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("active", &self.status.active)
            .field("base_url", &self.status.base_url)
            .field("user_id", &self.status.user_id)
            .finish()
    }
}

impl Client {
    pub fn resolve(settings: &MemorySettings, env: &MemoryEnv) -> Self {
        let (status, key) = resolve(settings, env);
        match key {
            Some(api_key) => Client {
                inner: Inner::On(Live {
                    http: build_http(REQUEST_TIMEOUT, CONNECT_TIMEOUT),
                    api_key,
                    base_url: status.base_url.clone(),
                    user_id: status.user_id.clone(),
                    app_id: status.app_id.clone(),
                    project_id: status.project_id.clone(),
                }),
                status,
            },
            None => Client {
                inner: Inner::Off,
                status,
            },
        }
    }

    /// Test helper: a live client aimed at `base_url` with explicit timeouts.
    pub fn for_test(base_url: &str, api_key: &str, user_id: &str, timeout: Duration) -> Self {
        let http = build_http(timeout, timeout);
        let status = Status {
            active: true,
            enabled: true,
            key_present: true,
            base_url: base_url.trim_end_matches('/').to_string(),
            user_id: user_id.to_string(),
            app_id: DEFAULT_APP_ID.into(),
            project_id: DEFAULT_PROJECT_ID.into(),
            reason: "test".into(),
            inject_context: true,
            top_k: 5,
        };
        Client {
            inner: Inner::On(Live {
                http,
                api_key: api_key.to_string(),
                base_url: status.base_url.clone(),
                user_id: status.user_id.clone(),
                app_id: status.app_id.clone(),
                project_id: status.project_id.clone(),
            }),
            status,
        }
    }

    pub fn is_active(&self) -> bool {
        self.status.active && matches!(self.inner, Inner::On(_))
    }

    pub fn status(&self) -> &Status {
        &self.status
    }

    pub fn user_id(&self) -> &str {
        &self.status.user_id
    }

    pub fn add(&self, session_id: &str, messages: &[OutMessage]) -> Result<String, EverOsError> {
        let live = self.live()?;
        validate_session(session_id)?;
        if messages.is_empty() {
            return Ok("empty".into());
        }
        if messages.len() > 500 {
            return Err(EverOsError::Invalid("at most 500 messages per add".into()));
        }
        for (i, m) in messages.iter().enumerate() {
            if m.timestamp < MIN_TIMESTAMP_MS {
                return Err(EverOsError::Invalid(format!(
                    "messages[{i}].timestamp must be unix milliseconds"
                )));
            }
            if !matches!(m.role.as_str(), "user" | "assistant" | "tool") {
                return Err(EverOsError::Invalid(format!(
                    "messages[{i}].role must be user, assistant or tool"
                )));
            }
            if m.content.trim().is_empty() {
                return Err(EverOsError::Invalid(format!(
                    "messages[{i}].content is empty"
                )));
            }
            if m.sender_id.trim().is_empty() {
                return Err(EverOsError::Invalid(format!(
                    "messages[{i}].sender_id is empty"
                )));
            }
        }
        let body = serde_json::json!({
            "session_id": session_id,
            "messages": messages,
            "async_mode": true,
            "app_id": live.app_id,
            "project_id": live.project_id,
        });
        let value = self.post(live, "/api/v2/memory/add", &body)?;
        let env: Envelope<AddData> =
            serde_json::from_value(value).map_err(|e| EverOsError::Decode(e.to_string()))?;
        Ok(env
            .data
            .map(|d| {
                if d.status.is_empty() {
                    format!("count:{}", d.message_count)
                } else {
                    d.status
                }
            })
            .unwrap_or_else(|| "ok".into()))
    }

    pub fn search(&self, query: &str, top_k: u32) -> Result<SearchData, EverOsError> {
        let live = self.live()?;
        let query = query.trim();
        if query.is_empty() {
            return Err(EverOsError::Invalid("query is empty".into()));
        }
        if live.user_id.trim().is_empty() {
            return Err(EverOsError::Invalid("user_id is empty".into()));
        }
        let top_k = clamp_top_k(top_k);
        let body = serde_json::json!({
            "query": query,
            "user_id": live.user_id,
            "method": "hybrid",
            "top_k": top_k,
            "include_profile": true,
            "app_id": live.app_id,
            "project_id": live.project_id,
        });
        let value = self.post(live, "/api/v2/memory/search", &body)?;
        let env: Envelope<SearchData> =
            serde_json::from_value(value).map_err(|e| EverOsError::Decode(e.to_string()))?;
        Ok(env.data.unwrap_or_default())
    }

    /// Recall formatted for a composer. Disabled or an empty hit list is an empty string.
    pub fn recall(&self, query: &str, top_k: u32) -> Result<String, EverOsError> {
        if !self.is_active() {
            return Ok(String::new());
        }
        Ok(format_context(&self.search(query, top_k)?))
    }

    pub fn flush(&self, session_id: &str) -> Result<String, EverOsError> {
        let live = self.live()?;
        validate_session(session_id)?;
        let body = serde_json::json!({
            "session_id": session_id,
            "app_id": live.app_id,
            "project_id": live.project_id,
        });
        let value = self.post(live, "/api/v2/memory/flush", &body)?;
        let env: Envelope<FlushData> =
            serde_json::from_value(value).map_err(|e| EverOsError::Decode(e.to_string()))?;
        Ok(env.data.map(|d| d.status).unwrap_or_else(|| "ok".into()))
    }

    fn live(&self) -> Result<&Live, EverOsError> {
        match &self.inner {
            Inner::On(live) if self.status.active => Ok(live),
            _ => Err(EverOsError::Disabled),
        }
    }

    fn post(&self, live: &Live, path: &str, body: &Value) -> Result<Value, EverOsError> {
        let url = format!("{}{path}", live.base_url);
        let response = live
            .http
            .post(&url)
            .set("Authorization", &format!("Bearer {}", live.api_key))
            .set("Accept", "application/json")
            .send_json(body);
        let (status, text) = match response {
            Ok(resp) => {
                let status = resp.status();
                let text = resp
                    .into_string()
                    .map_err(|e| EverOsError::Transport(e.to_string()))?;
                (status, text)
            }
            Err(ureq::Error::Status(status, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                return Err(EverOsError::Http {
                    status,
                    body: snippet(&text),
                });
            }
            Err(ureq::Error::Transport(t)) => return Err(transport_err(&t)),
        };
        if !(200..300).contains(&status) {
            return Err(EverOsError::Http {
                status,
                body: snippet(&text),
            });
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|e| EverOsError::Decode(format!("{e}: {}", snippet(&text))))
    }
}

fn transport_err(t: &ureq::Transport) -> EverOsError {
    let rendered = t.to_string();
    let timed_out = matches!(t.kind(), ureq::ErrorKind::Io)
        && rendered.to_ascii_lowercase().contains("timed out");
    if timed_out {
        EverOsError::Timeout
    } else {
        EverOsError::Transport(rendered)
    }
}

fn snippet(body: &str) -> String {
    let flat: String = body
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(300)
        .collect();
    flat.trim().to_string()
}

fn validate_session(session_id: &str) -> Result<(), EverOsError> {
    let n = session_id.chars().count();
    if !(1..=128).contains(&n) {
        return Err(EverOsError::Invalid(
            "session_id must be 1–128 characters".into(),
        ));
    }
    Ok(())
}

fn build_http(timeout: Duration, connect: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(connect)
        .timeout_read(timeout)
        .timeout_write(timeout)
        .user_agent(concat!("agentdock/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// When memory is on but no user id is configured yet, mint a stable one into settings.
/// Returns true when `settings` was modified and should be saved.
pub fn assign_user_id(settings: &mut MemorySettings, env: &MemoryEnv) -> bool {
    let (status, _) = resolve(settings, env);
    let env_user = non_empty(env.user_id.as_deref());
    if status.active && settings.user_id.trim().is_empty() && env_user.is_none() {
        settings.user_id = format!("ad-{}", uuid::Uuid::new_v4());
        true
    } else {
        false
    }
}

pub fn resolve(settings: &MemorySettings, env: &MemoryEnv) -> (Status, Option<String>) {
    let key = non_empty(env.api_key.as_deref()).map(str::to_string);
    let key_present = key.is_some();
    let enabled = env.enabled.unwrap_or(settings.enabled);
    let user_id = non_empty(env.user_id.as_deref())
        .or_else(|| non_empty(Some(settings.user_id.as_str())))
        .unwrap_or("")
        .to_string();
    let app_id = non_empty(env.app_id.as_deref())
        .unwrap_or(DEFAULT_APP_ID)
        .to_string();
    let project_id = non_empty(env.project_id.as_deref())
        .unwrap_or(DEFAULT_PROJECT_ID)
        .to_string();
    let base_raw = non_empty(env.base_url.as_deref()).unwrap_or(DEFAULT_BASE_URL);
    let base = normalize_base(base_raw);
    let top_k = clamp_top_k(settings.top_k);

    let (active, reason, base_url) = if !enabled {
        let why = if env.enabled == Some(false) {
            "EVEROS_ENABLED 已关闭"
        } else {
            "已在设置中关闭"
        };
        (
            false,
            why.to_string(),
            base.clone()
                .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string()),
        )
    } else if !key_present {
        (
            false,
            "未设置 EVEROS_API_KEY".to_string(),
            base.clone()
                .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string()),
        )
    } else if let Err(()) = &base {
        (
            false,
            "EVEROS_BASE_URL 不是 http(s) 地址".to_string(),
            DEFAULT_BASE_URL.to_string(),
        )
    } else {
        (
            true,
            "已启用，呼叫时读写记忆".to_string(),
            base.clone().unwrap(),
        )
    };

    let status = Status {
        active,
        enabled,
        key_present,
        base_url,
        user_id,
        app_id,
        project_id,
        reason,
        inject_context: settings.inject_context,
        top_k,
    };
    let secret = if active { key } else { None };
    (status, secret)
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

fn normalize_base(raw: &str) -> Result<String, ()> {
    let raw = raw.trim().trim_end_matches('/');
    if !(raw.starts_with("https://") || raw.starts_with("http://")) || raw.contains(' ') {
        return Err(());
    }
    Ok(raw.to_string())
}

pub fn clamp_top_k(v: u32) -> u32 {
    if (1..=100).contains(&v) {
        v
    } else {
        5
    }
}

/// Episodes (the narrative EverOS says to paste into a prompt) plus a few profile lines.
/// Empty when nothing matched. Bounded so a composer injection stays small.
pub fn format_context(data: &SearchData) -> String {
    let mut episodes = Vec::new();
    for ep in &data.episodes {
        let text = episode_text(ep);
        if text.is_empty() {
            continue;
        }
        episodes.push(truncate_chars(&text, 500));
        if episodes.len() == 5 {
            break;
        }
    }
    let mut profile = Vec::new();
    for p in &data.profiles {
        flatten_profile(&p.profile_data, &mut profile);
        if profile.len() >= 8 {
            break;
        }
    }
    profile.truncate(8);
    if episodes.is_empty() && profile.is_empty() {
        return String::new();
    }
    let mut out = String::from(MEMORY_MARKER);
    out.push('\n');
    if !episodes.is_empty() {
        out.push_str("你记得的事：\n");
        for line in &episodes {
            out.push_str("- ");
            out.push_str(line);
            out.push('\n');
        }
    }
    if !profile.is_empty() {
        out.push_str("画像：\n");
        for line in &profile {
            out.push_str("- ");
            out.push_str(line);
            out.push('\n');
        }
    }
    truncate_chars(out.trim_end(), CONTEXT_CHARS)
}

fn episode_text(ep: &Episode) -> String {
    let narrative = ep.episode.trim();
    if !narrative.is_empty() {
        return narrative.to_string();
    }
    let summary = ep.summary.trim();
    if !summary.is_empty() {
        return summary.to_string();
    }
    ep.atomic_facts
        .iter()
        .map(|f| f.content.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("；")
}

fn flatten_profile(value: &Value, out: &mut Vec<String>) {
    let Some(map) = value.as_object() else {
        if let Some(s) = value.as_str() {
            let s = s.trim();
            if !s.is_empty() {
                out.push(truncate_chars(s, 160));
            }
        }
        return;
    };
    for (k, v) in map {
        if out.len() >= 8 {
            return;
        }
        match v {
            Value::String(s) if !s.trim().is_empty() => {
                out.push(format!("{k}: {}", truncate_chars(s.trim(), 160)))
            }
            Value::Array(items) => {
                for item in items {
                    if out.len() >= 8 {
                        return;
                    }
                    if let Some(desc) = item
                        .get("description")
                        .and_then(|d| d.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        let cat = item.get("category").and_then(|c| c.as_str()).unwrap_or(k);
                        out.push(format!("{cat}: {}", truncate_chars(desc, 160)));
                    } else if let Some(s) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                        out.push(format!("{k}: {}", truncate_chars(s, 160)));
                    }
                }
            }
            Value::Object(obj) => {
                for (k2, v2) in obj {
                    if out.len() >= 8 {
                        return;
                    }
                    if let Some(s) = v2.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                        out.push(format!("{k}.{k2}: {}", truncate_chars(s, 160)));
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings(enabled: bool) -> MemorySettings {
        MemorySettings {
            enabled,
            user_id: String::new(),
            inject_context: true,
            top_k: 5,
        }
    }

    fn env_with_key(key: &str) -> MemoryEnv {
        MemoryEnv {
            api_key: Some(key.into()),
            base_url: None,
            user_id: None,
            app_id: None,
            project_id: None,
            enabled: None,
        }
    }

    #[test]
    fn missing_key_disables_without_a_secret_in_status() {
        let (status, key) = resolve(
            &settings(true),
            &MemoryEnv {
                api_key: None,
                base_url: None,
                user_id: None,
                app_id: None,
                project_id: None,
                enabled: None,
            },
        );
        assert!(!status.active);
        assert!(!status.key_present);
        assert_eq!(status.reason, "未设置 EVEROS_API_KEY");
        assert!(key.is_none());
        let client = Client::resolve(
            &settings(true),
            &MemoryEnv {
                api_key: Some("   ".into()),
                base_url: None,
                user_id: None,
                app_id: None,
                project_id: None,
                enabled: None,
            },
        );
        assert!(!client.is_active());
    }

    #[test]
    fn settings_off_wins_until_env_overrides() {
        let (status, key) = resolve(&settings(false), &env_with_key("super-secret-key"));
        assert!(!status.active);
        assert!(status.key_present);
        assert!(key.is_none());
        assert_eq!(status.reason, "已在设置中关闭");

        let mut env = env_with_key("super-secret-key");
        env.enabled = Some(true);
        env.base_url = Some("http://127.0.0.1:8000/".into());
        env.user_id = Some("user_001".into());
        env.app_id = Some("agentdock".into());
        let (status, key) = resolve(&settings(false), &env);
        assert!(status.active);
        assert_eq!(status.base_url, "http://127.0.0.1:8000");
        assert_eq!(status.user_id, "user_001");
        assert_eq!(key.as_deref(), Some("super-secret-key"));

        env.enabled = Some(false);
        let (status, _) = resolve(&settings(true), &env);
        assert!(!status.active);
        assert_eq!(status.reason, "EVEROS_ENABLED 已关闭");
    }

    #[test]
    fn bad_base_url_disables() {
        let mut env = env_with_key("k");
        env.enabled = Some(true);
        env.base_url = Some("ftp://files.example".into());
        let (status, key) = resolve(&settings(false), &env);
        assert!(!status.active);
        assert!(key.is_none());
        assert!(status.reason.contains("EVEROS_BASE_URL"));
    }

    #[test]
    fn debug_never_prints_the_key() {
        let mut env = env_with_key("super-secret-key");
        env.enabled = Some(true);
        let client = Client::resolve(&settings(true), &env);
        let rendered = format!("{client:?}");
        assert!(!rendered.contains("super-secret-key"));
        assert!(client.is_active());
    }

    #[test]
    fn assign_user_id_only_when_active_and_unset() {
        let mut s = settings(false);
        let env = env_with_key("k");
        assert!(!assign_user_id(&mut s, &env));
        assert!(s.user_id.is_empty());

        let mut env = env_with_key("k");
        env.enabled = Some(true);
        assert!(assign_user_id(&mut s, &env));
        let id = s.user_id.clone();
        assert!(id.starts_with("ad-"));
        assert!(!assign_user_id(&mut s, &env));
        assert_eq!(s.user_id, id);

        s.user_id.clear();
        env.user_id = Some("from-env".into());
        assert!(!assign_user_id(&mut s, &env));
        assert!(s.user_id.is_empty());
    }

    #[test]
    fn parse_enabled_flag_recognises_common_spellings() {
        assert_eq!(parse_enabled_flag(" YES "), Some(true));
        assert_eq!(parse_enabled_flag("0"), Some(false));
        assert_eq!(parse_enabled_flag("maybe"), None);
        assert_eq!(parse_enabled_flag(""), None);
    }

    #[test]
    fn top_k_out_of_range_falls_back_to_chat_default() {
        assert_eq!(clamp_top_k(0), 5);
        assert_eq!(clamp_top_k(101), 5);
        assert_eq!(clamp_top_k(10), 10);
    }

    #[test]
    fn format_context_prefers_episode_narrative_and_bounds_length() {
        let data = SearchData {
            episodes: vec![Episode {
                episode: "用户喜欢美式、不加糖。".into(),
                summary: "ignored when episode is present".into(),
                ..Episode::default()
            }],
            profiles: vec![Profile {
                profile_data: json!({
                    "explicit_info": [{"category": "drink", "description": "黑咖啡，不加糖"}],
                    "nickname": "Jia"
                }),
            }],
            unprocessed_messages: vec![json!({"content": "should not be pasted"})],
        };
        let text = format_context(&data);
        assert!(text.starts_with(MEMORY_MARKER));
        assert!(text.contains("用户喜欢美式、不加糖。"));
        assert!(!text.contains("ignored when episode"));
        assert!(text.contains("drink: 黑咖啡，不加糖"));
        assert!(text.contains("nickname: Jia"));
        assert!(!text.contains("should not be pasted"));
        assert!(text.chars().count() <= CONTEXT_CHARS);

        let huge = SearchData {
            episodes: vec![Episode {
                episode: "事".repeat(5000),
                ..Episode::default()
            }],
            ..SearchData::default()
        };
        assert!(format_context(&huge).chars().count() <= CONTEXT_CHARS);
        assert!(format_context(&SearchData::default()).is_empty());
    }

    #[test]
    fn seconds_timestamp_is_rejected_before_any_http() {
        let client = Client::for_test(
            "http://127.0.0.1:9",
            "k",
            "user_001",
            Duration::from_millis(200),
        );
        let msg = OutMessage {
            sender_id: "user_001".into(),
            sender_name: None,
            role: "user".into(),
            timestamp: 1_700_000_000,
            content: "hello".into(),
        };
        let err = client.add("session_001", &[msg]);
        match err {
            Err(EverOsError::Invalid(m)) => assert!(m.contains("milliseconds"), "{m}"),
            other => panic!("expected invalid timestamp, got {other:?}"),
        }
    }

    #[test]
    fn add_search_and_flush_match_the_v2_contract() {
        let (base, rx) = serve(
            202,
            r#"{"request_id":"req-1","data":{"message_count":1,"status":"queued"}}"#,
        );
        let client = Client::for_test(&base, "test-key", "user_001", Duration::from_secs(2));
        let status = client
            .add(
                "ad-dot-1700000000000",
                &[OutMessage {
                    sender_id: "user_001".into(),
                    sender_name: Some("你".into()),
                    role: "user".into(),
                    timestamp: 1_700_000_000_000,
                    content: "开始与 dot 语音通话。".into(),
                }],
            )
            .unwrap();
        assert_eq!(status, "queued");
        let hit = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(hit.start_line.contains("POST /api/v2/memory/add"));
        assert!(hit
            .headers
            .to_ascii_lowercase()
            .contains("authorization: bearer test-key"));
        let body: serde_json::Value = serde_json::from_str(&hit.body).unwrap();
        assert_eq!(body["session_id"], "ad-dot-1700000000000");
        assert_eq!(body["async_mode"], true);
        assert_eq!(body["app_id"], "agentdock");
        assert_eq!(body["project_id"], "default");
        assert_eq!(body["messages"][0]["sender_id"], "user_001");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["timestamp"], 1_700_000_000_000u64);
        assert_eq!(body["messages"][0]["content"], "开始与 dot 语音通话。");

        let (base, rx) = serve(
            200,
            r#"{"request_id":"req-2","data":{"episodes":[{"id":"ep1","summary":"short","episode":"用户喜欢美式、不加糖。","atomic_facts":[{"content":"不加糖"}],"score":0.87}],"profiles":[{"profile_data":{"drink":"americano"}}],"unprocessed_messages":[]}}"#,
        );
        let client = Client::for_test(&base, "test-key", "user_001", Duration::from_secs(2));
        let brief = client.recall("coffee", 5).unwrap();
        assert!(brief.contains("用户喜欢美式、不加糖。"));
        assert!(brief.contains("drink: americano"));
        let hit = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(hit.start_line.contains("POST /api/v2/memory/search"));
        let body: serde_json::Value = serde_json::from_str(&hit.body).unwrap();
        assert_eq!(body["query"], "coffee");
        assert_eq!(body["user_id"], "user_001");
        assert_eq!(body["method"], "hybrid");
        assert_eq!(body["top_k"], 5);
        assert_eq!(body["include_profile"], true);
        assert!(body.get("agent_id").is_none());

        let (base, _rx) = serve(
            200,
            r#"{"request_id":"req-3","data":{"status":"no_extraction"}}"#,
        );
        let client = Client::for_test(&base, "test-key", "user_001", Duration::from_secs(2));
        assert_eq!(
            client.flush("ad-dot-1700000000000").unwrap(),
            "no_extraction"
        );
    }

    #[test]
    fn http_errors_and_timeouts_are_errors_not_panics() {
        let (base, _rx) = serve(
            401,
            r#"{"error":{"code":"unauthorized","message":"bad token"}}"#,
        );
        let client = Client::for_test(&base, "nope", "user_001", Duration::from_secs(2));
        let err = client.search("coffee", 5).unwrap_err();
        assert!(
            matches!(err, EverOsError::Http { status: 401, .. }),
            "{err}"
        );

        let (base, _rx) = serve_hang();
        let client = Client::for_test(&base, "k", "user_001", Duration::from_millis(200));
        let err = client.search("coffee", 5).unwrap_err();
        assert!(matches!(err, EverOsError::Timeout), "{err}");
    }

    #[test]
    fn disabled_recall_skips_the_network() {
        let client = Client::resolve(
            &settings(false),
            &MemoryEnv {
                api_key: None,
                base_url: None,
                user_id: None,
                app_id: None,
                project_id: None,
                enabled: None,
            },
        );
        assert_eq!(client.recall("anything", 5).unwrap(), "");
        assert!(matches!(
            client.add("s", &[]).unwrap_err(),
            EverOsError::Disabled
        ));
    }

    #[test]
    fn connection_refused_is_a_transport_error() {
        let client = Client::for_test(
            "http://127.0.0.1:1",
            "k",
            "user_001",
            Duration::from_millis(200),
        );
        let err = client.search("coffee", 5).unwrap_err();
        assert!(
            matches!(err, EverOsError::Transport(_) | EverOsError::Timeout),
            "{err}"
        );
    }

    struct Hit {
        start_line: String,
        headers: String,
        body: String,
    }

    fn serve(status: u16, response_body: &str) -> (String, std::sync::mpsc::Receiver<Hit>) {
        let response_body = response_body.to_string();
        bind_server(move |mut sock| {
            let hit = read_hit(&mut sock);
            let resp = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            );
            let _ = std::io::Write::write_all(&mut sock, resp.as_bytes());
            hit
        })
    }

    fn serve_hang() -> (String, std::sync::mpsc::Receiver<Hit>) {
        bind_server(|mut sock| {
            let hit = read_hit(&mut sock);
            std::thread::sleep(Duration::from_secs(2));
            let _ = sock;
            hit
        })
    }

    fn bind_server(
        handler: impl FnOnce(std::net::TcpStream) -> Hit + Send + 'static,
    ) -> (String, std::sync::mpsc::Receiver<Hit>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((sock, _)) = listener.accept() {
                sock.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let _ = tx.send(handler(sock));
            }
        });
        (format!("http://{addr}"), rx)
    }

    fn read_hit(sock: &mut std::net::TcpStream) -> Hit {
        use std::io::Read;
        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        let (header_end, content_len) = loop {
            let n = sock.read(&mut tmp).unwrap_or(0);
            if n == 0 {
                break (buf.len(), 0);
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&buf[..end]).to_string();
                let len = content_length(&headers);
                break (end + 4, len);
            }
        };
        while buf.len() < header_end + content_len {
            let n = sock.read(&mut tmp).unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        let headers = String::from_utf8_lossy(&buf[..header_end.saturating_sub(4)]).to_string();
        let body =
            String::from_utf8_lossy(&buf[header_end..(header_end + content_len).min(buf.len())])
                .to_string();
        Hit {
            start_line: headers.lines().next().unwrap_or("").to_string(),
            headers,
            body,
        }
    }

    fn content_length(headers: &str) -> usize {
        headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("content-length") {
                    value.trim().parse().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0)
    }
}
