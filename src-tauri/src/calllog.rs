//! What was said on the live call, kept locally and only in memory. A warm transfer reads it: when
//! a switch commits, the outgoing seat's last turns become a short brief pasted into the next
//! seat's composer, so the new agent picks up where the previous one left off.
//!
//! Independent of EverOS (the same caption lines feed both). Pure: the host owns timing, the
//! webview and the wording ([`BriefText`], from `i18n`).

use crate::everos::truncate_chars;
use crate::memory::{memory_seat, TranscriptLine};
use crate::state::Phase;
use std::collections::{HashMap, HashSet};

pub const HANDOFF_MARKER: &str = "[AgentDock handoff]";
/// Turns carried over: enough to know the topic, short enough to read at a glance.
pub const HANDOFF_TURNS: usize = 8;
const TURN_CHARS: usize = 300;
const BRIEF_CHARS: usize = 1500;
/// Lines kept per call; a brief only ever needs the tail.
const KEEP_LINES: usize = 200;

#[derive(Debug, Default)]
struct LiveCall {
    lines: Vec<TranscriptLine>,
    seen: HashSet<String>,
}

#[derive(Debug, Default)]
pub struct CallLog {
    open: HashMap<String, LiveCall>,
}

/// A committed switch with something to carry over.
#[derive(Debug, Clone, PartialEq)]
pub struct Handoff {
    pub from: String,
    pub to: String,
    pub lines: Vec<TranscriptLine>,
}

/// The brief's wording in the interface language. `turn` holds `{who}` and `{text}`.
#[derive(Debug, Clone)]
pub struct BriefText {
    pub heading: String,
    pub me: String,
    pub them: String,
    pub turn: String,
    pub ask: String,
}

impl CallLog {
    /// New caption lines for the seat's open call; returns how many were new. Lines for a seat
    /// with no open call are dropped.
    pub fn on_lines(&mut self, seat_id: &str, lines: &[TranscriptLine]) -> usize {
        let Some(call) = self.open.get_mut(seat_id) else { return 0 };
        let added = lines.iter().filter(|line| merge_line(&mut call.lines, &mut call.seen, line) != Merge::Skipped).count();
        if call.lines.len() > KEEP_LINES {
            call.lines.drain(..call.lines.len() - KEEP_LINES);
        }
        added
    }

    /// What was said on the seat's open call so far (a round-table started from a 1:1 call).
    pub fn lines(&self, seat_id: &str) -> Vec<TranscriptLine> {
        self.open.get(seat_id).map(|call| call.lines.clone()).unwrap_or_default()
    }

    /// Open a call when a seat starts dialling, close it when the seat leaves. A switch that
    /// commits with `carry` on hands the outgoing call's lines over.
    pub fn on_phase(&mut self, before: &Phase, after: &Phase) -> Option<Handoff> {
        let (was, now) = (memory_seat(before), memory_seat(after));
        if was == now {
            return None;
        }
        let ended = was.and_then(|seat| self.open.remove(seat));
        if let Some(seat) = now {
            self.open.insert(seat.to_string(), LiveCall::default());
        }
        match (before, after, ended) {
            (Phase::Switching { from, to, carry: true, .. }, Phase::Calling { seat }, Some(call)) if seat == to && !call.lines.is_empty() => {
                Some(Handoff { from: from.clone(), to: to.clone(), lines: call.lines })
            }
            _ => None,
        }
    }
}

/// What one caption line did to a transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Merge {
    /// Not a user/assistant line, empty, or already seen.
    Skipped,
    /// The last line of the same role, still being spoken, came back longer.
    Grew,
    Added,
}

/// Add a scraped line to `lines`, deduped by role and text. A bubble that is still being spoken
/// comes back longer each scrape: the latest version replaces the last line of the same role.
pub(crate) fn merge_line(lines: &mut Vec<TranscriptLine>, seen: &mut HashSet<String>, line: &TranscriptLine) -> Merge {
    if line.role != "user" && line.role != "assistant" {
        return Merge::Skipped;
    }
    let content = line.content.trim();
    if content.is_empty() || !seen.insert(format!("{}\n{content}", line.role)) {
        return Merge::Skipped;
    }
    match lines.last_mut() {
        Some(last) if last.role == line.role && content.starts_with(last.content.as_str()) => {
            last.content = content.to_string();
            Merge::Grew
        }
        _ => {
            lines.push(TranscriptLine { role: line.role.clone(), content: content.to_string() });
            Merge::Added
        }
    }
}

/// Marker, heading, the turns, a footer, within `max_chars`: the oldest turns go first.
pub(crate) fn bounded_brief(marker: &str, heading: &str, mut turns: Vec<String>, footer: &str, max_chars: usize) -> String {
    let frame = marker.chars().count() + heading.chars().count() + footer.chars().count() + 3;
    while turns.len() > 1 && frame + turns.iter().map(|t| t.chars().count() + 1).sum::<usize>() > max_chars {
        turns.remove(0);
    }
    let mut out = format!("{marker}\n{heading}\n");
    for turn in &turns {
        out.push_str(turn);
        out.push('\n');
    }
    out.push_str(footer);
    out
}

/// Marker, heading, the last turns, the ask. When it runs long the oldest turns go first.
pub fn handoff_brief(lines: &[TranscriptLine], text: &BriefText) -> String {
    let tail = &lines[lines.len().saturating_sub(HANDOFF_TURNS)..];
    let turns: Vec<String> = tail
        .iter()
        .map(|l| {
            let who = if l.role == "user" { &text.me } else { &text.them };
            text.turn.replace("{who}", who).replace("{text}", &truncate_chars(l.content.trim(), TURN_CHARS))
        })
        .collect();
    bounded_brief(HANDOFF_MARKER, &text.heading, turns, &text.ask, BRIEF_CHARS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(role: &str, content: &str) -> TranscriptLine {
        TranscriptLine { role: role.into(), content: content.into() }
    }

    fn calling(seat: &str) -> Phase {
        Phase::Calling { seat: seat.into() }
    }

    fn in_call(seat: &str) -> Phase {
        Phase::InCall { seat: seat.into(), elapsed_secs: 3 }
    }

    fn switching(from: &str, to: &str, carry: bool) -> Phase {
        Phase::Switching { from: from.into(), to: to.into(), undo_secs_left: 0, carry }
    }

    fn text() -> BriefText {
        BriefText {
            heading: "I was just on a call with Grok:".into(),
            me: "Me".into(),
            them: "Grok".into(),
            turn: "{who}: {text}".into(),
            ask: "Please pick up from here.".into(),
        }
    }

    /// dot is live with two turns said.
    fn live_dot() -> CallLog {
        let mut log = CallLog::default();
        assert_eq!(log.on_phase(&Phase::Idle, &calling("dot")), None);
        assert_eq!(log.on_phase(&calling("dot"), &in_call("dot")), None);
        assert_eq!(log.on_lines("dot", &[line("user", "plan a trip to Kyoto"), line("assistant", "Spring or autumn?")]), 2);
        log
    }

    #[test]
    fn a_committed_switch_carries_the_outgoing_call() {
        let mut log = live_dot();
        assert_eq!(log.on_phase(&in_call("dot"), &switching("dot", "copilot", true)), None, "the undo window keeps the call open");
        log.on_lines("dot", &[line("user", "autumn")]);
        let handoff = log.on_phase(&switching("dot", "copilot", true), &calling("copilot")).expect("handoff");
        assert_eq!((handoff.from.as_str(), handoff.to.as_str()), ("dot", "copilot"));
        assert_eq!(handoff.lines.iter().map(|l| l.content.as_str()).collect::<Vec<_>>(), ["plan a trip to Kyoto", "Spring or autumn?", "autumn"]);
        assert_eq!(log.on_lines("copilot", &[line("user", "hi")]), 1, "the new seat has its own call");
        assert_eq!(log.on_lines("dot", &[line("user", "late")]), 0, "the old call is closed");
    }

    #[test]
    fn the_open_calls_lines_can_seed_a_room() {
        let log = live_dot();
        assert_eq!(log.lines("dot").iter().map(|l| l.content.as_str()).collect::<Vec<_>>(), ["plan a trip to Kyoto", "Spring or autumn?"]);
        assert!(log.lines("copilot").is_empty());
    }

    #[test]
    fn nothing_carries_without_carry_lines_or_a_commit() {
        let mut log = live_dot();
        assert_eq!(log.on_phase(&switching("dot", "copilot", false), &calling("copilot")), None, "carry turned off for this switch");

        let mut log = live_dot();
        assert_eq!(log.on_phase(&switching("dot", "copilot", true), &Phase::Idle), None, "hanging up during the switch");

        let mut log = live_dot();
        log.on_phase(&switching("dot", "copilot", true), &in_call("dot"));
        assert_eq!(log.on_lines("dot", &[line("user", "still here")]), 1, "undo keeps the same call");

        let mut log = CallLog::default();
        log.on_phase(&Phase::Idle, &calling("dot"));
        assert_eq!(log.on_phase(&switching("dot", "copilot", true), &calling("copilot")), None, "nothing was said");

        let mut log = live_dot();
        let needs = Phase::NeedsHuman { seat: "dot".into(), reason: "call_timeout".into() };
        log.on_phase(&in_call("dot"), &needs);
        assert_eq!(log.on_phase(&needs, &calling("copilot")), None, "calling away from needs-you is not a transfer");
    }

    #[test]
    fn lines_are_deduped_role_checked_and_grow_in_place() {
        let mut log = CallLog::default();
        assert_eq!(log.on_lines("dot", &[line("user", "no call open")]), 0);
        log.on_phase(&Phase::Idle, &calling("dot"));
        let added = log.on_lines("dot", &[line("assistant", "Let me"), line("system", "banner"), line("user", "  "), line("assistant", "Let me")]);
        assert_eq!(added, 1);
        assert_eq!(log.on_lines("dot", &[line("assistant", "Let me think about it.")]), 1);
        log.on_lines("dot", &[line("user", "ok")]);
        let handoff = log.on_phase(&switching("dot", "copilot", true), &calling("copilot")).unwrap();
        assert_eq!(handoff.lines, [line("assistant", "Let me think about it."), line("user", "ok")]);
    }

    #[test]
    fn brief_has_the_marker_and_only_the_last_turns_within_budget() {
        let lines: Vec<TranscriptLine> = (0..12).map(|i| line(if i % 2 == 0 { "user" } else { "assistant" }, &format!("turn {i}"))).collect();
        let brief = handoff_brief(&lines, &text());
        assert!(brief.starts_with(HANDOFF_MARKER));
        assert!(brief.ends_with("Please pick up from here."));
        assert!(!brief.contains("turn 3"), "older than the last {HANDOFF_TURNS}");
        assert!(brief.contains("Me: turn 4\nGrok: turn 5"));

        let long: Vec<TranscriptLine> = (0..8).map(|i| line("assistant", &format!("{i}{}", "长".repeat(1000)))).collect();
        let brief = handoff_brief(&long, &text());
        assert!(brief.chars().count() <= BRIEF_CHARS, "{} chars", brief.chars().count());
        assert!(brief.contains("Grok: 7"), "the newest turn survives");
        assert!(!brief.contains("Grok: 0"), "the oldest goes first");
    }
}
