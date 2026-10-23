//! Free discussion in a round-table room: the bots take turns on their own, the user listens and
//! can cut in. Native voice means one live leg at a time, so "talking to each other" is a floor
//! that moves by itself when its holder has finished, to whoever it invited (or whoever has waited
//! longest), each new holder briefed by the relay note.
//!
//! Pure, with injected time: [`FloorClock`] decides when the floor holder is done, [`invited`] and
//! [`next_speaker`] who goes next, [`spoken_command`] what the user said to the room. The state
//! machine (`state.rs`) enforces the caps; nothing a bot says can do more than end its own turn
//! or pick another member.

use crate::roundtable::{Speaker, Utterance};
use crate::state::{Discussion, DiscussionRun, DockState, Phase, RemoteStage, Room};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

/// Nothing ends a turn before this: connecting, the relay note's "OK", the first words.
pub const MIN_FLOOR: Duration = Duration::from_secs(6);
/// A monologue: the note asks for about 30 s.
pub const TURN_CAP: Duration = Duration::from_secs(75);
/// From here on the Dock counts the cap down and offers 再等等.
pub const WARN_AT: Duration = Duration::from_secs(60);
pub const EXTEND_BY: Duration = Duration::from_secs(30);
/// Captions stopped growing for this long (two empty scrapes at the 2 s caption cadence).
pub const QUIET: Duration = Duration::from_secs(4);
const QUIET_BEATS: u32 = 2;
/// A voice playing after its caption rendered: wait for most of its estimated reading time.
const SPEECH_FACTOR: f64 = 0.8;
/// The Dock heard sound this recently: someone is talking, do not move the floor.
const VAD_HOLD: Duration = Duration::from_millis(1500);
pub const NUDGE_AFTER: Duration = Duration::from_secs(8);
pub const NO_START_AFTER: Duration = Duration::from_secs(25);
/// Seats whose words cannot be read get a timed turn, longer after the last sound heard.
pub const TIMED_TURN: Duration = Duration::from_secs(40);
const TIMED_AFTER_SOUND: Duration = Duration::from_secs(20);
const TIMED_WARN: Duration = Duration::from_secs(10);

/// Why an automatic pass happened (shown on the Dock).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PassOrigin {
    /// The floor holder finished and fell quiet.
    Quiet,
    /// It finished by inviting someone by name.
    Named,
    /// It talked past the cap.
    Cap,
    /// A seat whose words cannot be read had its timed turn.
    Timed,
    /// It never started talking.
    NoStart,
    /// It left the call (hung up, or failed to connect).
    LeftCall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockSignal {
    Wait,
    /// The turn ends in this many seconds unless extended.
    Warn(u64),
    /// The bot has not started: say 请讲 (shown once).
    Nudge,
    End(PassOrigin),
}

/// When the floor holder of one turn is done. Feed it what happens; poll it every half second.
#[derive(Debug, Clone)]
pub struct FloorClock {
    pub seat: String,
    pub turn: u64,
    /// Its captions are known to work (it produced an assistant line while live before).
    captions: bool,
    connected_at: Option<Instant>,
    last_user_at: Option<Instant>,
    first_asst_at: Option<Instant>,
    last_growth_at: Option<Instant>,
    asst_text: String,
    beats_since_growth: u32,
    vad_on: bool,
    last_vad_at: Option<Instant>,
    extended: Duration,
    rearmed_at: Option<Instant>,
    nudged: bool,
    ended: bool,
}

impl FloorClock {
    pub fn new(seat: &str, turn: u64, captions: bool) -> Self {
        FloorClock {
            seat: seat.to_string(),
            turn,
            captions,
            connected_at: None,
            last_user_at: None,
            first_asst_at: None,
            last_growth_at: None,
            asst_text: String::new(),
            beats_since_growth: 0,
            vad_on: false,
            last_vad_at: None,
            extended: Duration::ZERO,
            rearmed_at: None,
            nudged: false,
            ended: false,
        }
    }

    pub fn captions_known(&self) -> bool {
        self.captions
    }

    pub fn on_connected(&mut self, now: Instant) {
        self.connected_at.get_or_insert(now);
    }

    /// The user spoke to the floor holder: a new sub-turn starts, it answers before the floor moves.
    pub fn on_user(&mut self, now: Instant) {
        self.last_user_at = Some(now);
        self.first_asst_at = None;
        self.asst_text.clear();
        self.beats_since_growth = 0;
        self.ended = false;
    }

    /// The floor holder's caption is new or grew.
    pub fn on_assistant(&mut self, text: &str, now: Instant) {
        self.captions = true;
        self.first_asst_at.get_or_insert(now);
        self.last_growth_at = Some(now);
        self.asst_text = text.to_string();
        self.beats_since_growth = 0;
    }

    /// A caption scrape that worked and brought nothing new. A failed scrape is not a beat, so a
    /// broken page never looks like silence.
    pub fn on_beat(&mut self) {
        self.beats_since_growth += 1;
    }

    /// The Dock's microphone level crossed its threshold.
    pub fn on_vad(&mut self, active: bool, now: Instant) {
        self.vad_on = active;
        self.last_vad_at = Some(now);
    }

    /// 再等等: more time for this turn.
    pub fn extend(&mut self) {
        self.extended += EXTEND_BY;
        self.ended = false;
    }

    /// After an undo: the floor stays, and a quiet ending needs fresh activity.
    pub fn rearm(&mut self, now: Instant) {
        self.rearmed_at = Some(now);
        self.ended = false;
    }

    /// A discussion starts (or resumes) on a call already going: what it said so far counts as
    /// its turn, so the floor moves once it has been quiet a while, or after it answers you.
    pub fn settle(&mut self, now: Instant) {
        self.connected_at = Some(now);
        self.first_asst_at = Some(now);
        self.last_growth_at = Some(now);
        self.asst_text.clear();
        self.beats_since_growth = 0;
        self.nudged = true;
        self.ended = false;
    }

    pub fn poll(&mut self, now: Instant) -> ClockSignal {
        let Some(connected) = self.connected_at else { return ClockSignal::Wait };
        if self.ended || now < connected + MIN_FLOOR {
            return ClockSignal::Wait;
        }
        let latest = |a: Option<Instant>, b: Option<Instant>| match (a, b) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        let since_user = latest(self.last_user_at, self.rearmed_at);
        // the cap counts from whatever happened last: its first words, the user, a rearm
        let anchor = latest(Some(self.first_asst_at.unwrap_or(connected)), since_user).unwrap_or(connected);
        let cap = anchor + TURN_CAP + self.extended;
        if now >= cap {
            return self.end(PassOrigin::Cap);
        }
        // the microphone only ever holds the floor; on speakers it also hears the bot
        let sound = self.vad_on || self.last_vad_at.is_some_and(|t| now.duration_since(t) < VAD_HOLD);
        if !sound {
            if self.captions {
                let answered = self.first_asst_at.is_some_and(|a| since_user.map_or(true, |u| a > u));
                if answered {
                    let first = self.first_asst_at.unwrap();
                    let quiet = self.last_growth_at.is_some_and(|g| now.duration_since(g) >= QUIET);
                    let spoken = now >= first + speech_eta(&self.asst_text).mul_f64(SPEECH_FACTOR);
                    if self.beats_since_growth >= QUIET_BEATS && quiet && spoken {
                        return self.end(PassOrigin::Quiet);
                    }
                } else if self.first_asst_at.is_none() && since_user.is_none() {
                    if now >= connected + NO_START_AFTER {
                        return self.end(PassOrigin::NoStart);
                    }
                    if now >= connected + NUDGE_AFTER && !self.nudged {
                        self.nudged = true;
                        return ClockSignal::Nudge;
                    }
                }
            } else {
                let deadline = (connected + TIMED_TURN).max(self.last_vad_at.map_or(connected, |t| t + TIMED_AFTER_SOUND)) + self.extended;
                if now >= deadline {
                    return self.end(PassOrigin::Timed);
                }
                if now >= connected + NUDGE_AFTER && self.last_vad_at.is_none() && !self.nudged {
                    self.nudged = true;
                    return ClockSignal::Nudge;
                }
                if deadline.saturating_duration_since(now) <= TIMED_WARN {
                    return ClockSignal::Warn(deadline.saturating_duration_since(now).as_secs() + 1);
                }
            }
        }
        if now + (TURN_CAP - WARN_AT) >= cap {
            return ClockSignal::Warn(cap.saturating_duration_since(now).as_secs() + 1);
        }
        ClockSignal::Wait
    }

    fn end(&mut self, why: PassOrigin) -> ClockSignal {
        self.ended = true;
        ClockSignal::End(why)
    }
}

/// How long `text` takes to say: Han characters about 4/s, kana 7/s, Latin words 2.5/s.
pub fn speech_eta(text: &str) -> Duration {
    let (mut han, mut kana, mut words, mut in_word) = (0usize, 0usize, 0usize, false);
    for c in text.chars() {
        let cp = c as u32;
        let is_kana = (0x3040..=0x30ff).contains(&cp);
        let is_han = (0x4e00..=0x9fff).contains(&cp) || (0x3400..=0x4dbf).contains(&cp);
        if is_kana {
            kana += 1;
        } else if is_han {
            han += 1;
        }
        let latin = c.is_ascii_alphanumeric();
        if latin && !in_word {
            words += 1;
        }
        in_word = latin;
    }
    Duration::from_secs_f64(han as f64 / 4.0 + kana as f64 / 7.0 + words as f64 / 2.5)
}

const EVERYONE: &[&str] = &["大家", "各位", "你们", "everyone", "everybody", "all of you", "皆さん", "みなさん", "みんな"];

/// Who the floor holder invited to speak next: a member named in its *last sentence*, exactly one,
/// not itself. "Everyone", unknown or ambiguous names invite nobody (yobiru's rule for agents).
pub fn invited<'a, M: PartialEq>(text: &str, members: &'a [(M, Vec<String>)], floor: &M) -> Option<&'a M> {
    let trimmed = text.trim_end_matches(|c: char| c.is_whitespace() || "。！？!?.…".contains(c));
    let start = trimmed.rfind(|c: char| "。！？!?.\n".contains(c)).map_or(0, |i| i + trimmed[i..].chars().next().map_or(1, char::len_utf8));
    let last: String = trimmed[start..].chars().rev().take(160).collect::<Vec<_>>().into_iter().rev().collect();
    let lower = last.to_lowercase();
    if EVERYONE.iter().any(|w| lower.contains(w)) {
        return None;
    }
    let mut hit: Option<&M> = None;
    for (who, names) in members {
        if who == floor {
            continue;
        }
        if names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()).any(|n| name_in(&lower, &n.to_lowercase())) {
            if hit.is_some_and(|h| h != who) {
                return None;
            }
            hit = Some(who);
        }
    }
    hit
}

fn name_in(hay: &str, name: &str) -> bool {
    let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() && c.is_ascii());
    let latin = name.chars().any(|c| c.is_ascii_alphanumeric());
    hay.match_indices(name).any(|(i, _)| !latin || (!word(hay[..i].chars().last()) && !word(hay[i + name.len()..].chars().next())))
}

/// The member that speaks next. `last_turn` is when each member last held the floor (0 = never).
/// An invitation wins unless it would make a streak (2 named passes in a row) or a ping-pong
/// (back to the one who just invited it); otherwise whoever has waited longest, ties in order
/// after the floor holder. Members with a badge, and the floor holder, are never picked.
pub struct NextInput<'a> {
    pub members: &'a [(String, u64, bool)],
    pub floor: &'a str,
    pub invited: Option<&'a str>,
    pub named_streak: u8,
    /// Who held the floor before the current holder, and whether that pass was a named one.
    pub previous: Option<(&'a str, bool)>,
    pub round_robin: bool,
}

pub const NAMED_STREAK_MAX: u8 = 2;

pub fn next_speaker(input: &NextInput) -> Option<(String, PassOrigin)> {
    let eligible = |id: &str| input.members.iter().any(|(m, _, trouble)| m == id && !trouble) && id != input.floor;
    if let Some(to) = input.invited.filter(|to| eligible(to)) {
        let ping_pong = input.previous.is_some_and(|(prev, named)| named && prev == to);
        if input.named_streak < NAMED_STREAK_MAX && !ping_pong && !input.round_robin {
            return Some((to.to_string(), PassOrigin::Named));
        }
    }
    let n = input.members.len();
    let start = input.members.iter().position(|(m, _, _)| m == input.floor).unwrap_or(n.saturating_sub(1));
    let in_order: Vec<&(String, u64, bool)> = (1..=n).map(|i| &input.members[(start + i) % n]).filter(|(m, _, _)| eligible(m)).collect();
    let pick = if input.round_robin { in_order.first().copied() } else { in_order.iter().min_by_key(|(_, last, _)| *last).copied() };
    pick.map(|(m, _, _)| (m.clone(), PassOrigin::Quiet))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpokenCommand {
    Pause,
    Next,
}

const STOP_WORDS: &[&str] = &["停一下", "暂停", "等一下", "等等", "打住", "停", "stop", "wait", "hold on", "pause", "ストップ", "ちょっと待って", "待って"];
const NEXT_WORDS: &[&str] = &["下一位", "下一个", "换人", "next", "次の人"];

/// A command at the start of what the user said, in any of the interface languages.
pub fn spoken_command(text: &str) -> Option<SpokenCommand> {
    let t = text.trim_start().to_lowercase();
    let starts = |w: &&str| {
        t.starts_with(*w) && {
            let rest = &t[w.len()..];
            !w.chars().all(|c| c.is_ascii_alphabetic()) || rest.chars().next().map_or(true, |c| !c.is_ascii_alphabetic())
        }
    };
    if STOP_WORDS.iter().any(starts) {
        Some(SpokenCommand::Pause)
    } else if NEXT_WORDS.iter().any(starts) {
        Some(SpokenCommand::Next)
    } else {
        None
    }
}

/// Automatic passes allowed after each time the user speaks: two rounds, within 2..=8.
pub fn hop_budget(members: usize) -> u8 {
    (2 * members.saturating_sub(1)).clamp(2, 8) as u8
}

/// The floor was left empty (hung up, never connected) this long before the next one is dialled:
/// one missed probe is not a member leaving.
pub const EMPTY_GRACE: Duration = Duration::from_secs(2);
/// A pass that was asked for and did not happen (refused, raced) is asked again after this.
const ASK_RETRY: Duration = Duration::from_secs(3);
/// The outgoing bot's captions grew this recently: it is still talking, hold the switch.
const GREW_HOLD: Duration = Duration::from_millis(2500);

/// What the host does next, from [`Tracker::poll`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Act {
    /// Ask the state machine for an automatic pass (it may refuse, or pause the discussion).
    Pass { to: String, turn: u64, origin: PassOrigin },
    /// Someone is still talking during an automatic switch: hold it a moment (`FloorBusy`).
    Hold,
    /// The Dock's countdown on the floor holder, in seconds; `None` clears it.
    Countdown(Option<u64>),
    /// The floor holder has not started talking: the Dock suggests saying 请讲.
    Nudge(String),
}

#[derive(Debug, Clone, Copy)]
struct Empty {
    turn: u64,
    since: Instant,
    /// The holder dropped while the discussion ran (a skip), not a floor left empty on purpose.
    left: bool,
}

/// The host's side of a discussion: the floor holder's [`FloorClock`], which seats' captions work,
/// when each member last held the floor, and what the floor holder last said (its invitation).
/// lib.rs feeds it every state change, caption scrape and microphone edge, and acts on `poll`.
#[derive(Debug, Default)]
pub struct Tracker {
    clock: Option<FloorClock>,
    /// Seats that produced an assistant caption: their turns end on quiet captions, not a timer.
    captions: HashSet<String>,
    last_turn: HashMap<String, u64>,
    said: String,
    user_seq: u64,
    vad_on: bool,
    vad_at: Option<Instant>,
    grew_at: Option<Instant>,
    empty: Option<Empty>,
    asked: Option<(u64, Instant)>,
    countdown: Option<u64>,
}

impl Tracker {
    /// After every state change. A floor holder gets a clock when it connects; an undo rearms it;
    /// starting or resuming the discussion settles it; an empty floor starts its grace period.
    pub fn follow(&mut self, before: &DockState, after: &DockState, now: Instant) {
        let Some((room, d)) = after.room.as_ref().and_then(|r| r.disc.as_ref().map(|d| (r, d))) else {
            // what was learnt about captions outlives the discussion
            let captions = std::mem::take(&mut self.captions);
            *self = Tracker { captions, ..Default::default() };
            return;
        };
        let running = d.run == DiscussionRun::Running;
        let was_running = before.room.as_ref().and_then(|r| r.disc.as_ref()).map(|d| d.run == DiscussionRun::Running);
        let restarted = running && was_running != Some(true);
        // a remote member holds the floor: its turn ends when its answer has been read (RemoteEnded)
        if let Some(rf) = room.remote.as_ref().filter(|r| r.stage != RemoteStage::Pending) {
            self.clock = None;
            self.empty = None;
            self.last_turn.insert(rf.member.clone(), room.turn);
            return;
        }
        let remote_before = before.room.as_ref().and_then(|r| r.remote.as_ref()).filter(|r| r.stage != RemoteStage::Pending).map(|r| r.member.clone());
        match &after.phase {
            Phase::InCall { seat, .. } => {
                self.empty = None;
                if !self.clock.as_ref().is_some_and(|c| c.seat == *seat && c.turn == room.turn) {
                    let mut clock = FloorClock::new(seat, room.turn, self.captions.contains(seat));
                    clock.on_connected(now);
                    self.clock = Some(clock);
                    self.said.clear();
                    self.grew_at = None;
                    self.asked = None;
                    self.last_turn.insert(seat.clone(), room.turn);
                }
                let clock = self.clock.as_mut().expect("clock");
                if restarted {
                    clock.settle(now);
                    self.asked = None;
                } else if matches!(&before.phase, Phase::Switching { from, .. } if from == seat) {
                    clock.rearm(now);
                    self.asked = None;
                }
            }
            // the outgoing holder keeps its clock until the switch commits
            Phase::Switching { .. } => {}
            Phase::Calling { seat } => {
                self.clock = None;
                self.empty = None;
                self.last_turn.insert(seat.clone(), room.turn);
            }
            Phase::Idle | Phase::NeedsHuman { .. } => {
                self.clock = None;
                // a remote member whose request failed counts as one that left the call
                let failed = remote_before.as_deref().and_then(|m| room.member_by_id(m)).is_some_and(|m| m.trouble.is_some());
                let left = running && (failed || !matches!(before.phase, Phase::Idle | Phase::NeedsHuman { .. }));
                if left || restarted || remote_before.is_some() || self.empty.map_or(true, |e| e.turn != room.turn) {
                    self.empty = Some(Empty { turn: room.turn, since: now, left });
                }
            }
        }
    }

    /// A caption scrape of `seat` that worked; `touched` is what the room ledger took from it
    /// (empty: nothing new, a beat). Returns what the user newly said (ledger seq, words), for the
    /// host to act on.
    pub fn on_lines(&mut self, seat: &str, touched: &[Utterance], now: Instant) -> Vec<(u64, String)> {
        let mut heard = Vec::new();
        let mut grew = false;
        for u in touched {
            match &u.speaker {
                Speaker::Seat(s) if s == seat && !u.unheard => {
                    self.captions.insert(seat.to_string());
                    if let Some(clock) = self.clock.as_mut().filter(|c| c.seat == seat) {
                        clock.on_assistant(&u.text, now);
                    }
                    self.said = u.text.clone();
                    grew = true;
                }
                Speaker::User if !u.typed && u.seq > self.user_seq => {
                    self.user_seq = u.seq;
                    heard.push((u.seq, u.text.clone()));
                }
                _ => {}
            }
        }
        if grew {
            self.grew_at = Some(now);
        } else if let Some(clock) = self.clock.as_mut().filter(|c| c.seat == seat) {
            clock.on_beat();
        }
        heard
    }

    /// The user spoke to the floor holder (a caption, or push-to-talk).
    pub fn user_spoke(&mut self, now: Instant) {
        if let Some(clock) = self.clock.as_mut() {
            clock.on_user(now);
        }
    }

    pub fn on_vad(&mut self, active: bool, now: Instant) {
        self.vad_on = active;
        self.vad_at = Some(now);
        if let Some(clock) = self.clock.as_mut() {
            clock.on_vad(active, now);
        }
    }

    /// 再等等.
    pub fn extend(&mut self) {
        if let Some(clock) = self.clock.as_mut() {
            clock.extend();
        }
    }

    /// Every half second while a discussion is open. `names` are each seat member's names.
    pub fn poll(&mut self, state: &DockState, names: &[(String, Vec<String>)], now: Instant) -> Vec<Act> {
        let mut acts = Vec::new();
        let mut countdown = None;
        if let Some((room, d)) = state.room.as_ref().and_then(|r| r.disc.as_ref().map(|d| (r, d))) {
            let waiting = self.asked.is_some_and(|(turn, at)| turn == room.turn && now.duration_since(at) < ASK_RETRY);
            let remote = room.remote.as_ref();
            let sound = self.vad_on || self.vad_at.is_some_and(|t| now.duration_since(t) < VAD_HOLD);
            let growing = self.grew_at.is_some_and(|t| now.duration_since(t) < GREW_HOLD);
            match &state.phase {
                // a remote member holds the floor, or is about to: nothing to time or ask
                _ if remote.is_some_and(|r| r.stage != RemoteStage::Pending) => {}
                _ if remote.is_some() => {
                    if remote.is_some_and(|r| r.origin.is_some()) && (sound || growing) {
                        acts.push(Act::Hold);
                    }
                }
                Phase::Switching { .. } => {
                    if d.pending.is_some() && (sound || growing) {
                        acts.push(Act::Hold);
                    }
                }
                _ if d.run != DiscussionRun::Running || waiting => {}
                Phase::InCall { seat, .. } => {
                    if let Some(clock) = self.clock.as_mut().filter(|c| c.seat == *seat && c.turn == room.turn) {
                        if self.asked.take().is_some() {
                            // asked, and nothing happened: start this turn's clock over
                            clock.rearm(now);
                        }
                        match clock.poll(now) {
                            ClockSignal::Warn(secs) => countdown = Some(secs),
                            ClockSignal::Nudge => acts.push(Act::Nudge(seat.clone())),
                            ClockSignal::End(origin) => acts.extend(self.next(room, d, seat, origin, names, now)),
                            ClockSignal::Wait => {}
                        }
                    }
                }
                Phase::Idle | Phase::NeedsHuman { .. } => {
                    if let Some(e) = self.empty.filter(|e| e.turn == room.turn && now.duration_since(e.since) >= EMPTY_GRACE) {
                        let floor = room.last.as_ref().map(|m| m.id()).unwrap_or_default().to_string();
                        acts.extend(self.next(room, d, &floor, if e.left { PassOrigin::LeftCall } else { PassOrigin::Quiet }, names, now));
                    }
                }
                Phase::Calling { .. } => {}
            }
        }
        if countdown != self.countdown {
            self.countdown = countdown;
            acts.push(Act::Countdown(countdown));
        }
        acts
    }

    fn next(&mut self, room: &Room, d: &Discussion, floor: &str, origin: PassOrigin, names: &[(String, Vec<String>)], now: Instant) -> Option<Act> {
        let members: Vec<(String, u64, bool)> =
            room.members.iter().map(|m| (m.who.id().to_string(), self.last_turn.get(m.who.id()).copied().unwrap_or(0), m.trouble.is_some())).collect();
        let floor_id = floor.to_string();
        let invited = invited(&self.said, names, &floor_id).map(String::as_str);
        let previous = d.previous.as_ref().map(|(p, named)| (p.as_str(), *named));
        let input = NextInput { members: &members, floor, invited, named_streak: d.named_streak, previous, round_robin: d.round_robin };
        let (to, how) = next_speaker(&input)?;
        self.asked = Some((room.turn, now));
        Some(Act::Pass { to, turn: room.turn, origin: if how == PassOrigin::Named { how } else { origin } })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(t: Instant, s: u64) -> Instant {
        t + Duration::from_secs(s)
    }

    #[test]
    fn a_turn_ends_when_captions_stay_quiet_after_the_answer_was_spoken() {
        let t = Instant::now();
        let mut c = FloorClock::new("dot", 3, true);
        assert_eq!(c.poll(t), ClockSignal::Wait, "not connected yet");
        c.on_connected(t);
        c.on_assistant("I think autumn is best.", secs(t, 2));
        c.on_beat();
        c.on_beat();
        assert_eq!(c.poll(secs(t, 5)), ClockSignal::Wait, "the first 6 s never end a turn");
        assert_eq!(c.poll(secs(t, 7)), ClockSignal::End(PassOrigin::Quiet));
        assert_eq!(c.poll(secs(t, 8)), ClockSignal::Wait, "an ending is latched");
    }

    #[test]
    fn growth_sound_and_long_answers_hold_the_floor() {
        let t = Instant::now();
        let mut c = FloorClock::new("dot", 1, true);
        c.on_connected(t);
        c.on_assistant("我觉得", secs(t, 2));
        c.on_beat();
        c.on_assistant("我觉得秋天最好，因为红叶", secs(t, 8));
        c.on_beat();
        assert_eq!(c.poll(secs(t, 10)), ClockSignal::Wait, "one empty beat is a pause between sentences");
        c.on_beat();
        c.on_vad(true, secs(t, 12));
        assert_eq!(c.poll(secs(t, 13)), ClockSignal::Wait, "the microphone hears someone");
        c.on_vad(false, secs(t, 13));
        assert_eq!(c.poll(secs(t, 14)), ClockSignal::Wait, "sound a moment ago still holds");
        assert_eq!(c.poll(secs(t, 15)), ClockSignal::End(PassOrigin::Quiet));
        let long = "红".repeat(200);
        let mut c = FloorClock::new("dot", 1, true);
        c.on_connected(t);
        c.on_assistant(&long, secs(t, 1));
        c.on_beat();
        c.on_beat();
        assert_eq!(c.poll(secs(t, 20)), ClockSignal::Wait, "200 characters take about 50 s to say");
        assert_eq!(c.poll(secs(t, 41)), ClockSignal::End(PassOrigin::Quiet));
    }

    #[test]
    fn the_user_cutting_in_restarts_the_turn_and_the_cap_ends_a_monologue() {
        let t = Instant::now();
        let mut c = FloorClock::new("dot", 1, true);
        c.on_connected(t);
        c.on_assistant("first answer", secs(t, 2));
        c.on_user(secs(t, 5));
        c.on_beat();
        c.on_beat();
        assert_eq!(c.poll(secs(t, 12)), ClockSignal::Wait, "it has to answer the user first");
        c.on_assistant("answer to you", secs(t, 13));
        c.on_beat();
        c.on_beat();
        assert_eq!(c.poll(secs(t, 18)), ClockSignal::End(PassOrigin::Quiet));

        let mut m = FloorClock::new("dot", 1, true);
        m.on_connected(t);
        m.on_assistant("…", secs(t, 1));
        m.on_vad(true, secs(t, 1));
        assert_eq!(m.poll(secs(t, 62)), ClockSignal::Warn(15));
        m.extend();
        assert_eq!(m.poll(secs(t, 77)), ClockSignal::Wait, "再等等 adds 30 s");
        assert_eq!(m.poll(secs(t, 106)), ClockSignal::End(PassOrigin::Cap), "even while it is still talking");
    }

    #[test]
    fn a_bot_that_never_starts_is_nudged_then_skipped_only_if_its_captions_work() {
        let t = Instant::now();
        let mut c = FloorClock::new("dot", 1, true);
        c.on_connected(t);
        assert_eq!(c.poll(secs(t, 9)), ClockSignal::Nudge);
        assert_eq!(c.poll(secs(t, 10)), ClockSignal::Wait, "nudged once");
        assert_eq!(c.poll(secs(t, 26)), ClockSignal::End(PassOrigin::NoStart));

        let mut blind = FloorClock::new("grok", 1, false);
        blind.on_connected(t);
        assert_eq!(blind.poll(secs(t, 9)), ClockSignal::Nudge);
        assert_eq!(blind.poll(secs(t, 26)), ClockSignal::Wait, "no captions: never skipped for silence");
        blind.on_vad(true, secs(t, 25));
        blind.on_vad(false, secs(t, 31));
        assert_eq!(blind.poll(secs(t, 40)), ClockSignal::Wait, "a timed turn runs 20 s past the last sound");
        assert_eq!(blind.poll(secs(t, 42)), ClockSignal::Warn(10));
        assert_eq!(blind.poll(secs(t, 51)), ClockSignal::End(PassOrigin::Timed));
    }

    #[test]
    fn invitations_come_from_the_last_sentence_and_name_exactly_one_member() {
        let members = vec![
            ("dot".to_string(), vec!["dot".to_string()]),
            ("copilot".to_string(), vec!["Copilot".to_string(), "副驾驶".into()]),
            ("radar".to_string(), vec!["Radar".to_string(), "雷达".into()]),
        ];
        let floor = "dot".to_string();
        assert_eq!(invited("我同意。Copilot，你怎么看？", &members, &floor), Some(&"copilot".to_string()));
        assert_eq!(invited("Radar mentioned costs. What do you think, copilot?", &members, &floor), Some(&"copilot".to_string()));
        assert_eq!(invited("副驾驶你来说说", &members, &floor), Some(&"copilot".to_string()));
        assert_eq!(invited("Copilot said this earlier. I disagree.", &members, &floor), None, "an earlier sentence is not an invitation");
        assert_eq!(invited("Copilot 和雷达，你们怎么看？", &members, &floor), None, "two names, or 你们, invite nobody");
        assert_eq!(invited("大家觉得呢，Copilot？", &members, &floor), None);
        assert_eq!(invited("dot, again?", &members, &floor), None, "not itself");
        assert_eq!(invited("copilots everywhere?", &members, &floor), None, "word boundaries for Latin names");
    }

    #[test]
    fn next_is_the_invited_member_unless_that_makes_a_streak_or_ping_pong_else_the_longest_waiting() {
        let members = vec![("a".to_string(), 3u64, false), ("b".to_string(), 5, false), ("c".to_string(), 1, false), ("d".to_string(), 0, true)];
        let base = NextInput { members: &members, floor: "b", invited: Some("a"), named_streak: 0, previous: Some(("c", false)), round_robin: false };
        assert_eq!(next_speaker(&base), Some(("a".into(), PassOrigin::Named)));
        assert_eq!(next_speaker(&NextInput { named_streak: 2, ..base }), Some(("c".into(), PassOrigin::Quiet)), "a streak: the longest waiting instead");
        let ping_pong = next_speaker(&NextInput { invited: Some("c"), previous: Some(("c", true)), ..base });
        assert_eq!(ping_pong, Some(("c".to_string(), PassOrigin::Quiet)), "c invited b, b invites c back: fair choice, not Named");
        assert_eq!(next_speaker(&NextInput { invited: Some("d"), ..base }).map(|x| x.0), Some("c".into()), "a member with a badge is never invited");
        assert_eq!(next_speaker(&NextInput { invited: None, ..base }).map(|x| x.0), Some("c".into()), "c waited longest");
        assert_eq!(next_speaker(&NextInput { invited: None, round_robin: true, ..base }).map(|x| x.0), Some("c".into()), "after b comes c");
        assert_eq!(next_speaker(&NextInput { invited: Some("a"), round_robin: true, ..base }).map(|x| x.0), Some("c".into()), "round robin ignores invitations");
        let alone = vec![("b".to_string(), 1u64, false), ("d".to_string(), 0, true)];
        assert_eq!(next_speaker(&NextInput { members: &alone, invited: None, ..base }), None);
    }

    #[test]
    fn spoken_commands_only_at_the_start_in_any_language() {
        assert_eq!(spoken_command("停一下，我有个问题"), Some(SpokenCommand::Pause));
        assert_eq!(spoken_command("Stop, wait"), Some(SpokenCommand::Pause));
        assert_eq!(spoken_command("ストップ"), Some(SpokenCommand::Pause));
        assert_eq!(spoken_command("下一位"), Some(SpokenCommand::Next));
        assert_eq!(spoken_command("next please"), Some(SpokenCommand::Next));
        assert_eq!(spoken_command("stopwatch is broken"), None, "a word, not a prefix of one");
        assert_eq!(spoken_command("please stop"), None, "only at the start");
        assert_eq!(spoken_command("nextjs"), None);
    }

    /// The tracker and the real state machine on one injected clock, wired like lib.rs.
    struct Sim {
        m: crate::state::Machine,
        tr: Tracker,
        t: Instant,
        start: Instant,
        seq: u64,
        names: Vec<(String, Vec<String>)>,
        log: Vec<Act>,
    }

    impl Sim {
        fn new(members: &[&str]) -> Sim {
            Sim::with(members.iter().map(|m| crate::state::MemberRef::Seat(m.to_string())).collect())
        }

        fn with(members: Vec<crate::state::MemberRef>) -> Sim {
            use crate::state::{Event, RoomMode, RoomSpec};
            let t = Instant::now();
            let names = members.iter().map(|m| (m.id().to_string(), vec![m.id().to_string()])).collect();
            let first = members[0].id().to_string();
            let mut sim = Sim { m: crate::state::Machine::new(), tr: Tracker::default(), t, start: t, seq: 0, names, log: Vec::new() };
            sim.ev(Event::RoomOpen(RoomSpec { id: "r".into(), name: None, group: None, members, relay: true, addressed: false, first: None }));
            sim.ev(Event::ProbeInCall { seat: first, in_call: true });
            sim.ev(Event::SetRoomMode { mode: RoomMode::Discussion, consent: true });
            sim
        }

        fn ev(&mut self, ev: crate::state::Event) {
            let before = self.m.state.clone();
            self.m.handle_at(ev, self.t);
            self.tr.follow(&before, &self.m.state.clone(), self.t);
        }

        /// The floor holder's page shows `text` (a new bubble).
        fn says(&mut self, text: &str) {
            let seat = self.m.current_seat().unwrap().to_string();
            self.seq += 1;
            let u = Utterance { seq: self.seq, turn: 0, speaker: Speaker::Seat(seat.clone()), text: text.into(), typed: false, unheard: false };
            self.tr.on_lines(&seat, &[u], self.t);
        }

        /// The user's words show up on the floor holder's page; the host reacts like lib.rs.
        fn user(&mut self, text: &str) -> Vec<(u64, String)> {
            let seat = self.m.current_seat().unwrap().to_string();
            self.seq += 1;
            let u = Utterance { seq: self.seq, turn: 0, speaker: Speaker::User, text: text.into(), typed: false, unheard: false };
            let heard = self.tr.on_lines(&seat, &[u], self.t);
            for _ in &heard {
                self.ev(crate::state::Event::UserActive);
                self.tr.user_spoke(self.t);
            }
            heard
        }

        /// Half-second steps: a caption scrape every 2 s (a beat when nothing is new), a state
        /// tick every second, the tracker's poll every step, and each new holder connecting.
        fn run(&mut self, secs: u64) {
            use crate::state::Event;
            for _ in 0..secs * 2 {
                self.t += Duration::from_millis(500);
                let half = (self.t - self.start).as_millis() / 500;
                if half % 4 == 0 {
                    if let Some(seat) = self.m.current_seat().map(str::to_string) {
                        self.tr.on_lines(&seat, &[], self.t);
                    }
                }
                if half % 2 == 0 {
                    self.ev(Event::Tick);
                }
                if let Phase::Calling { seat } = self.m.state.phase.clone() {
                    self.ev(Event::ProbeInCall { seat, in_call: true });
                }
                let acts = self.tr.poll(&self.m.state.clone(), &self.names.clone(), self.t);
                for act in acts {
                    match &act {
                        Act::Pass { to, turn, origin } => self.ev(Event::AutoPass { to: to.clone(), turn: *turn, origin: *origin }),
                        Act::Hold => self.ev(Event::FloorBusy),
                        _ => {}
                    }
                    self.log.push(act);
                }
            }
        }

        fn floor(&self) -> Option<&str> {
            self.m.current_seat()
        }

        fn passes(&self) -> Vec<(String, PassOrigin)> {
            self.log.iter().filter_map(|a| match a { Act::Pass { to, origin, .. } => Some((to.clone(), *origin)), _ => None }).collect()
        }
    }

    #[test]
    fn a_bot_that_finishes_by_inviting_someone_hands_the_floor_over() {
        let mut sim = Sim::new(&["a", "b", "c"]);
        sim.run(1);
        sim.says("I'd pick autumn. c, what do you think?");
        sim.run(5);
        assert_eq!(sim.passes(), vec![("c".into(), PassOrigin::Named)], "quiet for 4 s, 6 s into the turn");
        assert!(matches!(sim.m.state.phase, Phase::Switching { ref to, .. } if to == "c"), "through the undo window");
        sim.run(4);
        assert_eq!(sim.floor(), Some("c"));
        // c has never been heard: a timed turn, then whoever waited longest (b), not back to a
        sim.run(41);
        assert_eq!(sim.passes().last(), Some(&("b".into(), PassOrigin::Timed)));
    }

    #[test]
    fn the_outgoing_bot_still_talking_holds_the_switch_and_you_cutting_in_cancels_it() {
        let mut sim = Sim::new(&["a", "b"]);
        sim.run(1);
        sim.says("Autumn.");
        sim.run(5);
        assert!(matches!(sim.m.state.phase, Phase::Switching { .. }));
        sim.tr.on_vad(true, sim.t);
        sim.run(4);
        assert!(matches!(sim.m.state.phase, Phase::Switching { .. }), "held while sound continues");
        assert!(sim.log.contains(&Act::Hold));
        sim.tr.on_vad(false, sim.t);
        assert_eq!(sim.user("wait, why autumn?").len(), 1);
        assert!(matches!(sim.m.state.phase, Phase::InCall { ref seat, .. } if seat == "a"), "the floor stays with a");
        let n = sim.passes().len();
        sim.run(10);
        assert_eq!(sim.passes().len(), n, "a answers you before the floor moves");
        sim.says("Because of the leaves.");
        sim.run(8);
        assert_eq!(sim.passes().len(), n + 1);
    }

    #[test]
    fn a_holder_that_drops_is_replaced_after_a_grace_and_a_released_floor_waits_for_you() {
        use crate::state::Event;
        let mut sim = Sim::new(&["a", "b", "c"]);
        sim.run(2);
        sim.ev(Event::ProbeInCall { seat: "a".into(), in_call: false });
        sim.run(1);
        assert!(sim.passes().is_empty(), "one missed probe is not leaving");
        sim.run(2);
        assert_eq!(sim.passes(), vec![("b".into(), PassOrigin::LeftCall)]);
        assert_eq!(sim.floor(), Some("b"));
        sim.ev(Event::ReleaseFloor);
        sim.run(10);
        assert_eq!(sim.passes().len(), 1, "paused: nobody is dialled");
        sim.ev(Event::DiscussionResume);
        sim.run(3);
        assert_eq!(sim.passes().last(), Some(&("c".into(), PassOrigin::Quiet)), "resuming an empty floor dials the next, not as a skip");
    }

    #[test]
    fn a_long_turn_counts_down_and_extending_it_clears_the_countdown() {
        let mut sim = Sim::new(&["a", "b"]);
        sim.run(1);
        sim.says("…");
        sim.tr.on_vad(true, sim.t);
        sim.run(62);
        assert!(sim.log.iter().any(|a| matches!(a, Act::Countdown(Some(s)) if *s <= 15)), "{:?}", sim.log);
        assert!(sim.passes().is_empty());
        sim.tr.extend();
        sim.run(1);
        assert_eq!(sim.log.last(), Some(&Act::Countdown(None)));
        sim.run(40);
        assert!(sim.passes().is_empty(), "30 s more");
        sim.run(4);
        assert_eq!(sim.passes(), vec![("b".into(), PassOrigin::Cap)]);
    }

    #[test]
    fn a_remote_member_takes_its_turn_and_the_floor_moves_on_after_its_answer() {
        use crate::state::{Event, MemberRef, RemoteEnd, RemoteStage};
        let mut sim = Sim::with(vec![MemberRef::Seat("a".into()), MemberRef::Remote("r".into()), MemberRef::Seat("b".into())]);
        sim.run(1);
        sim.says("I'd say autumn. r, what do you think?");
        sim.run(5);
        assert_eq!(sim.passes(), vec![("r".into(), PassOrigin::Named)]);
        sim.run(4);
        assert_eq!(sim.m.state.room.as_ref().unwrap().remote.as_ref().map(|r| r.stage), Some(RemoteStage::Sending));
        sim.run(30);
        assert_eq!(sim.passes().len(), 1, "a remote turn has no clock: it waits for the answer");
        sim.ev(Event::RemoteEnded { member: "r".into(), how: RemoteEnd::Answered });
        sim.run(3);
        assert_eq!(sim.passes().last(), Some(&("b".into(), PassOrigin::Quiet)), "then whoever waited longest");
        sim.run(4);
        assert_eq!(sim.floor(), Some("b"));
    }

    #[test]
    fn a_bot_whose_captions_work_is_nudged_then_skipped() {
        let mut sim = Sim::new(&["a", "b", "c"]);
        sim.run(1);
        sim.says("Spring.");
        sim.run(8);
        sim.run(4);
        assert_eq!(sim.floor(), Some("b"));
        // b is known to caption from an earlier room
        sim.tr.captions.insert("c".into());
        sim.says("Summer. c?");
        sim.run(12);
        assert_eq!(sim.floor(), Some("c"));
        sim.run(9);
        assert!(sim.log.contains(&Act::Nudge("c".into())));
        sim.run(17);
        assert_eq!(sim.passes().last().map(|p| p.1), Some(PassOrigin::NoStart));
    }

    #[test]
    fn speech_time_and_hop_budget() {
        assert_eq!(speech_eta("秋天最好").as_secs_f64(), 1.0);
        assert!((speech_eta("autumn is best").as_secs_f64() - 1.2).abs() < 1e-9);
        assert_eq!(hop_budget(2), 2);
        assert_eq!(hop_budget(3), 4);
        assert_eq!(hop_budget(6), 8);
    }
}
