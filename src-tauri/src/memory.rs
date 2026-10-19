//! Call-lifecycle memory for AgentDock.
//!
//! The dialer does not run an LLM. Seats are external voice agents (hidden webview or a desktop
//! app), so the memory loop hangs off the dock state machine:
//!
//! * **Read** when a call starts (`Idle`/`NeedsHuman` → `Calling`, and again when a switch
//!   commits onto a new seat). `POST /search` with `method: "hybrid"` for this user, then the
//!   host pastes [`crate::everos::format_context`] into the seat's composer.
//! * **Write** the turns EverOS can actually see: a "call started" line once the probe reports
//!   `InCall`, caption lines scraped from the page while the call is up, and a closing line when
//!   the seat leaves the call (hangup, remote hangup, or a committed switch). `POST /add` is
//!   queued (`async_mode: true`); the host flushes the session a moment later so extraction is
//!   not stuck waiting for the next boundary.
//!
//! Everything here is pure. HTTP, timeouts and the webview live in the host (`lib.rs` + `everos`).

use crate::everos::OutMessage;
use crate::state::Phase;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FLUSH_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeatMeta {
    pub name: String,
    pub service: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct TranscriptLine {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Recall {
    pub seat_id: String,
    pub session_id: String,
    pub query: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Persist {
    pub session_id: String,
    pub messages: Vec<OutMessage>,
    /// Ask the host to `flush` after the add has had a moment to land.
    pub flush: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Recall(Recall),
    Write(Persist),
}

#[derive(Debug, Clone)]
struct OpenSession {
    session_id: String,
    seat_name: String,
    service: String,
    user_id: String,
    agent_sender_id: String,
    connected_ms: Option<u64>,
    seen: HashSet<String>,
    announced: bool,
}

#[derive(Debug, Default)]
pub struct CallBook {
    open: HashMap<String, OpenSession>,
}

impl CallBook {
    pub fn on_lines(
        &mut self,
        seat_id: &str,
        lines: &[TranscriptLine],
        now_ms: u64,
    ) -> Option<Persist> {
        let session = self.open.get_mut(seat_id)?;
        let mut messages = Vec::new();
        let mut ts = bump_ts(now_ms);
        for line in lines.iter().take(20) {
            let content = truncate_line(line.content.trim());
            if content.is_empty() {
                continue;
            }
            let role = match line.role.as_str() {
                "user" => "user",
                "assistant" => "assistant",
                _ => continue,
            };
            let key = format!("{role}\n{content}");
            if !session.seen.insert(key) {
                continue;
            }
            let (sender_id, sender_name) = if role == "user" {
                (session.user_id.clone(), Some("你".into()))
            } else {
                (
                    session.agent_sender_id.clone(),
                    Some(session.seat_name.clone()),
                )
            };
            messages.push(OutMessage {
                sender_id,
                sender_name,
                role: role.into(),
                timestamp: ts,
                content,
            });
            ts += 1;
        }
        if messages.is_empty() {
            None
        } else {
            Some(Persist {
                session_id: session.session_id.clone(),
                messages,
                flush: false,
            })
        }
    }
}

/// What the new phase should do to memory, if anything.
pub fn on_phase(
    book: &mut CallBook,
    before: &Phase,
    after: &Phase,
    meta_of: impl Fn(&str) -> Option<SeatMeta>,
    now_ms: u64,
    user_id: &str,
) -> Vec<Action> {
    let mut actions = Vec::new();
    let before_seat = memory_seat(before);
    let after_seat = memory_seat(after);
    if before_seat != after_seat {
        if let Some(prev) = before_seat {
            if let Some(batch) = end_session(book, prev, now_ms) {
                actions.push(Action::Write(batch));
            }
        }
    }
    if let Some(seat) = just_dialing(before, after) {
        if let Some(meta) = meta_of(seat) {
            if let Some(recall) = start_session(book, seat, &meta, user_id, now_ms) {
                actions.push(Action::Recall(recall));
            }
        }
    }
    if let Some(seat) = just_connected(before, after) {
        if let Some(batch) = announce_connected(book, seat, now_ms) {
            actions.push(Action::Write(batch));
        }
    }
    actions
}

fn start_session(
    book: &mut CallBook,
    seat_id: &str,
    meta: &SeatMeta,
    user_id: &str,
    now_ms: u64,
) -> Option<Recall> {
    if book.open.contains_key(seat_id) || user_id.trim().is_empty() {
        return None;
    }
    let now_ms = bump_ts(now_ms);
    let session_id = session_id_for(seat_id, now_ms);
    let query = format!(
        "{} {} 偏好 事实 未完成的话题",
        meta.name.trim(),
        meta.service.trim()
    );
    book.open.insert(
        seat_id.to_string(),
        OpenSession {
            session_id: session_id.clone(),
            seat_name: meta.name.clone(),
            service: meta.service.clone(),
            user_id: user_id.to_string(),
            agent_sender_id: agent_sender_id(seat_id),
            connected_ms: None,
            seen: HashSet::new(),
            announced: false,
        },
    );
    Some(Recall {
        seat_id: seat_id.to_string(),
        session_id,
        query,
    })
}

fn announce_connected(book: &mut CallBook, seat_id: &str, now_ms: u64) -> Option<Persist> {
    let session = book.open.get_mut(seat_id)?;
    if session.announced {
        return None;
    }
    session.announced = true;
    let now_ms = bump_ts(now_ms);
    session.connected_ms = Some(now_ms);
    let content = format!(
        "开始与 {}（{}）语音通话。",
        session.seat_name, session.service
    );
    let key = format!("user\n{content}");
    session.seen.insert(key);
    Some(Persist {
        session_id: session.session_id.clone(),
        messages: vec![OutMessage {
            sender_id: session.user_id.clone(),
            sender_name: Some("你".into()),
            role: "user".into(),
            timestamp: now_ms,
            content,
        }],
        flush: false,
    })
}

fn end_session(book: &mut CallBook, seat_id: &str, now_ms: u64) -> Option<Persist> {
    let session = book.open.remove(seat_id)?;
    let now_ms = bump_ts(now_ms);
    let (role, sender_id, sender_name, content) = if let Some(connected) = session.connected_ms {
        let secs = now_ms.saturating_sub(connected) / 1000;
        (
            "assistant",
            session.agent_sender_id,
            Some(session.seat_name.clone()),
            format!("与 {} 的语音通话结束，时长 {secs} 秒。", session.seat_name),
        )
    } else {
        (
            "user",
            session.user_id.clone(),
            Some("你".into()),
            format!(
                "呼叫了 {}（{}），通话没有接通。",
                session.seat_name, session.service
            ),
        )
    };
    Some(Persist {
        session_id: session.session_id,
        messages: vec![OutMessage {
            sender_id,
            sender_name,
            role: role.into(),
            timestamp: now_ms,
            content,
        }],
        flush: true,
    })
}

/// Seat whose call is still live. A pending switch keeps the outgoing seat.
pub fn memory_seat(phase: &Phase) -> Option<&str> {
    match phase {
        Phase::Idle => None,
        Phase::Calling { seat } | Phase::InCall { seat, .. } | Phase::NeedsHuman { seat, .. } => {
            Some(seat)
        }
        Phase::Switching { from, .. } => Some(from),
    }
}

fn just_dialing<'a>(before: &Phase, after: &'a Phase) -> Option<&'a str> {
    match after {
        Phase::Calling { seat } if memory_seat(before) != Some(seat.as_str()) => Some(seat),
        _ => None,
    }
}

fn just_connected<'a>(before: &Phase, after: &'a Phase) -> Option<&'a str> {
    match (before, after) {
        (Phase::Calling { seat: from }, Phase::InCall { seat, .. }) if from == seat => Some(seat),
        _ => None,
    }
}

pub fn session_id_for(seat_id: &str, now_ms: u64) -> String {
    let seat: String = seat_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    let seat = if seat.is_empty() {
        "seat"
    } else {
        seat.as_str()
    };
    let id = format!("ad-{seat}-{now_ms}");
    id.chars().take(128).collect()
}

pub fn agent_sender_id(seat_id: &str) -> String {
    let seat: String = seat_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    let seat = if seat.is_empty() {
        "seat"
    } else {
        seat.as_str()
    };
    format!("seat-{seat}")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn bump_ts(now_ms: u64) -> u64 {
    now_ms.max(1_000_000_000_000)
}

fn truncate_line(s: &str) -> String {
    crate::everos::truncate_chars(s, 4000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> SeatMeta {
        SeatMeta {
            name: "dot".into(),
            service: "ChatGPT dot".into(),
        }
    }

    fn lookup<'a>(id: &'a str, meta: &'a SeatMeta) -> Option<SeatMeta> {
        (id == "dot" || id == "copilot").then(|| SeatMeta {
            name: if id == "dot" {
                meta.name.clone()
            } else {
                "Copilot".into()
            },
            service: if id == "dot" {
                meta.service.clone()
            } else {
                "Copilot Voice".into()
            },
        })
    }

    const T0: u64 = 1_700_000_000_000;

    #[test]
    fn a_call_recalls_then_writes_the_turn_and_flushes_on_hangup() {
        let mut book = CallBook::default();
        let meta = meta();
        let actions = on_phase(
            &mut book,
            &Phase::Idle,
            &Phase::Calling { seat: "dot".into() },
            |id| lookup(id, &meta),
            T0,
            "user_001",
        );
        match &actions[..] {
            [Action::Recall(r)] => {
                assert_eq!(r.seat_id, "dot");
                assert_eq!(r.session_id, session_id_for("dot", T0));
                assert!(r.query.contains("dot"));
                assert!(r.query.contains("ChatGPT dot"));
            }
            other => panic!("expected one recall, got {other:?}"),
        }

        let actions = on_phase(
            &mut book,
            &Phase::Calling { seat: "dot".into() },
            &Phase::InCall {
                seat: "dot".into(),
                elapsed_secs: 0,
            },
            |id| lookup(id, &meta),
            T0 + 2_000,
            "user_001",
        );
        match &actions[..] {
            [Action::Write(p)] => {
                assert!(!p.flush);
                assert_eq!(p.messages.len(), 1);
                assert_eq!(p.messages[0].role, "user");
                assert_eq!(p.messages[0].sender_id, "user_001");
                assert!(p.messages[0].content.contains("开始与 dot"));
                assert!(p.messages[0].timestamp >= 1_000_000_000_000);
            }
            other => panic!("expected the start line, got {other:?}"),
        }

        let first = book
            .on_lines(
                "dot",
                &[
                    TranscriptLine {
                        role: "user".into(),
                        content: "我喜欢美式，不加糖。".into(),
                    },
                    TranscriptLine {
                        role: "assistant".into(),
                        content: "记下了。".into(),
                    },
                    TranscriptLine {
                        role: "system".into(),
                        content: "ignored".into(),
                    },
                    TranscriptLine {
                        role: "user".into(),
                        content: "   ".into(),
                    },
                ],
                T0 + 3_000,
            )
            .unwrap();
        assert_eq!(first.messages.len(), 2);
        assert_eq!(first.messages[0].sender_id, "user_001");
        assert_eq!(first.messages[1].role, "assistant");
        assert_eq!(first.messages[1].sender_id, agent_sender_id("dot"));
        assert_eq!(first.messages[1].sender_name.as_deref(), Some("dot"));
        assert!(first.messages[1].timestamp > first.messages[0].timestamp);
        assert!(!first.flush);

        let again = book.on_lines(
            "dot",
            &[TranscriptLine {
                role: "user".into(),
                content: "我喜欢美式，不加糖。".into(),
            }],
            T0 + 4_000,
        );
        assert!(again.is_none(), "the same caption is not written twice");

        let actions = on_phase(
            &mut book,
            &Phase::InCall {
                seat: "dot".into(),
                elapsed_secs: 9,
            },
            &Phase::Idle,
            |id| lookup(id, &meta),
            T0 + 11_000,
            "user_001",
        );
        match &actions[..] {
            [Action::Write(p)] => {
                assert!(p.flush);
                assert_eq!(p.messages[0].role, "assistant");
                assert!(
                    p.messages[0].content.contains("时长 9 秒"),
                    "{}",
                    p.messages[0].content
                );
            }
            other => panic!("expected a flushed closing line, got {other:?}"),
        }
        assert!(book
            .on_lines(
                "dot",
                &[TranscriptLine {
                    role: "user".into(),
                    content: "too late".into()
                }],
                T0 + 12_000
            )
            .is_none());
    }

    #[test]
    fn ringing_hangup_records_that_the_call_never_connected() {
        let mut book = CallBook::default();
        let meta = meta();
        let _ = on_phase(
            &mut book,
            &Phase::Idle,
            &Phase::Calling { seat: "dot".into() },
            |id| lookup(id, &meta),
            T0,
            "user_001",
        );
        let actions = on_phase(
            &mut book,
            &Phase::Calling { seat: "dot".into() },
            &Phase::Idle,
            |_| None,
            T0 + 1_000,
            "user_001",
        );
        match &actions[..] {
            [Action::Write(p)] => {
                assert!(p.flush);
                assert_eq!(p.messages[0].role, "user");
                assert!(p.messages[0].content.contains("没有接通"));
            }
            other => panic!("expected a not-connected note, got {other:?}"),
        }
    }

    #[test]
    fn undo_does_not_reopen_memory_and_a_committed_switch_flushes_the_old_seat() {
        let mut book = CallBook::default();
        let meta = meta();
        let dial = |book: &mut CallBook, before: &Phase, after: &Phase, t: u64| {
            on_phase(book, before, after, |id| lookup(id, &meta), t, "user_001")
        };

        let idle = Phase::Idle;
        let calling = Phase::Calling { seat: "dot".into() };
        let connected = Phase::InCall {
            seat: "dot".into(),
            elapsed_secs: 0,
        };
        dial(&mut book, &idle, &calling, T0);
        dial(&mut book, &calling, &connected, T0 + 1_000);

        let in_call = Phase::InCall {
            seat: "dot".into(),
            elapsed_secs: 4,
        };
        let switching = Phase::Switching {
            from: "dot".into(),
            to: "copilot".into(),
            undo_secs_left: 3,
        };
        let mid = dial(&mut book, &in_call, &switching, T0 + 4_000);
        assert!(mid.is_empty(), "the undo window keeps the original session");

        let back = Phase::InCall {
            seat: "dot".into(),
            elapsed_secs: 5,
        };
        let undone = dial(&mut book, &switching, &back, T0 + 5_000);
        assert!(undone.is_empty(), "undo is not a new call");

        let switching = Phase::Switching {
            from: "dot".into(),
            to: "copilot".into(),
            undo_secs_left: 0,
        };
        let calling_next = Phase::Calling {
            seat: "copilot".into(),
        };
        let committed = dial(&mut book, &switching, &calling_next, T0 + 8_000);
        assert!(
            matches!(&committed[0], Action::Write(p) if p.flush && p.messages[0].content.contains("dot"))
        );
        assert!(matches!(&committed[1], Action::Recall(r) if r.seat_id == "copilot"));
    }

    #[test]
    fn needs_human_keeps_the_session_until_the_call_is_dropped() {
        let mut book = CallBook::default();
        let meta = meta();
        let _ = on_phase(
            &mut book,
            &Phase::Idle,
            &Phase::Calling { seat: "dot".into() },
            |id| lookup(id, &meta),
            T0,
            "user_001",
        );
        let stuck = Phase::NeedsHuman {
            seat: "dot".into(),
            reason: "captcha".into(),
        };
        let actions = on_phase(
            &mut book,
            &Phase::Calling { seat: "dot".into() },
            &stuck,
            |id| lookup(id, &meta),
            T0 + 15_000,
            "user_001",
        );
        assert!(actions.is_empty());
        let actions = on_phase(
            &mut book,
            &stuck,
            &Phase::Idle,
            |id| lookup(id, &meta),
            T0 + 16_000,
            "user_001",
        );
        assert!(matches!(&actions[..], [Action::Write(p)] if p.flush));
    }

    #[test]
    fn session_ids_stay_inside_the_api_limit() {
        let long = "x".repeat(400);
        let id = session_id_for(&long, T0);
        assert!(id.chars().count() <= 128);
        assert!(id.starts_with("ad-"));
        assert_eq!(session_id_for("你好", T0), format!("ad-seat-{T0}"));
    }

    #[test]
    fn no_user_id_means_no_session() {
        let mut book = CallBook::default();
        let meta = meta();
        let actions = on_phase(
            &mut book,
            &Phase::Idle,
            &Phase::Calling { seat: "dot".into() },
            |id| lookup(id, &meta),
            T0,
            "  ",
        );
        assert!(actions.is_empty());
    }
}
