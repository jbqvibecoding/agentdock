//! The Dock state machine. Pure: no I/O, fully unit-tested. Drivers feed it probe results,
//! the UI reads the resulting `DockState`.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "phase")]
pub enum Phase {
    Idle,
    Calling { seat: String },
    InCall { seat: String, elapsed_secs: u64 },
    /// Hanging up `from` and about to call `to`; cancellable until the deadline. `carry`: paste
    /// what was said with `from` into `to` when the switch commits (see `calllog`).
    Switching { from: String, to: String, undo_secs_left: u64, carry: bool },
    /// The driver hit a captcha / unknown dialog and needs the user to look.
    NeedsHuman { seat: String, reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DockState {
    pub phase: Phase,
    pub muted: bool,
    pub expanded: bool,
    /// A round-table group call. `phase` still names the one live seat (the floor holder).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room: Option<Room>,
}

/// Who a group member is: a seat on this Mac, or an agent on another machine (over yobiru).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "id")]
pub enum MemberRef {
    Seat(String),
    Remote(String),
}

impl MemberRef {
    pub fn seat(&self) -> Option<&str> {
        match self {
            MemberRef::Seat(id) => Some(id),
            MemberRef::Remote(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub who: MemberRef,
    /// Why it cannot take the floor right now (a captcha, a failed dial); the Dock shows a badge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trouble: Option<String>,
}

/// One voice floor at a time: the user talks with whoever holds it, and the others learn what
/// was said from a note sent into their own chat when they take the floor (see `roundtable`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    /// The saved group it was started from, if any.
    #[serde(default)]
    pub group: Option<String>,
    pub members: Vec<Member>,
    /// Counts floor takes; relay notes are keyed by it.
    pub turn: u64,
    /// Consent to SEND what others said into the next floor holder's chat.
    pub relay: bool,
    /// Saying a member's name at the start of a sentence passes the floor to them.
    pub addressed: bool,
    /// Who held the floor last, so 下一位 continues from there while nobody holds it.
    #[serde(default)]
    pub last: Option<MemberRef>,
}

impl Room {
    pub fn member(&self, who: &MemberRef) -> Option<&Member> {
        self.members.iter().find(|m| &m.who == who)
    }

    fn member_mut(&mut self, who: &MemberRef) -> Option<&mut Member> {
        self.members.iter_mut().find(|m| &m.who == who)
    }

    pub fn has_seat(&self, seat: &str) -> bool {
        self.member(&MemberRef::Seat(seat.to_string())).is_some()
    }
}

/// What the host knows when a room is opened (a saved group, the picker, or 拉群 mid-call).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomSpec {
    pub id: String,
    pub name: Option<String>,
    pub group: Option<String>,
    pub members: Vec<MemberRef>,
    pub relay: bool,
    pub addressed: bool,
    /// Who takes the floor first when the room opens from idle (default: the first seat).
    pub first: Option<MemberRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Call(String),
    Hangup,
    ToggleMute,
    SetMuted(bool),
    ToggleExpanded,
    SetExpanded(bool),
    Undo,
    /// Carry the conversation over on this switch, or not.
    SetCarry(bool),
    /// From a driver probe: the seat reports it is (not) in a call.
    ProbeInCall { seat: String, in_call: bool },
    ProbeNeedsHuman { seat: String, reason: String },
    Tick,
    /// Open a room. From idle the first seat member is dialled; during a call, that call becomes
    /// the room's first floor.
    RoomOpen(RoomSpec),
    /// Add a member. During a 1:1 call this starts an ad-hoc room (`room_id`), without consent.
    RoomAdd { who: MemberRef, room_id: String },
    /// Remove a member; dropping the floor holder hangs it up. Fewer than two members ends the room.
    RoomDrop(MemberRef),
    /// 下一位: the next member in order after whoever holds (or last held) the floor.
    FloorNext,
    /// Hang up the floor holder and keep the room.
    ReleaseFloor,
    /// The driver began dialling this seat: a room's dial timeout counts from here, not the tap.
    DialStarted(String),
}

/// Side effects the host must perform after an event. Keeps the machine pure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    DriverCall(String),
    DriverHangup(String),
    SystemMute(bool),
}

pub const UNDO_WINDOW: Duration = Duration::from_secs(3);
pub const CALL_TIMEOUT: Duration = Duration::from_secs(15);
/// The Dock shows this reason in the user's language (src/i18n.ts `dock.callTimeout`).
pub const REASON_CALL_TIMEOUT: &str = "call_timeout";
/// A room member dials only after the previous one hung up and its relay note settled.
pub const ROOM_CALL_TIMEOUT: Duration = Duration::from_secs(45);
pub const ROOM_MAX: usize = 6;
/// Shown as a member's badge (src/i18n.ts `room.troubleDial`) when it did not connect in time.
pub const TROUBLE_DIAL: &str = "dial_timeout";

#[derive(Debug)]
pub struct Machine {
    pub state: DockState,
    call_started: Option<Instant>,
    switch_deadline: Option<Instant>,
    calling_since: Option<Instant>,
}

impl Default for Machine {
    fn default() -> Self {
        Self::new()
    }
}

impl Machine {
    pub fn new() -> Self {
        Machine {
            state: DockState { phase: Phase::Idle, muted: false, expanded: false, room: None },
            call_started: None,
            switch_deadline: None,
            calling_since: None,
        }
    }

    pub fn handle(&mut self, ev: Event) -> Vec<Effect> {
        self.handle_at(ev, Instant::now())
    }

    pub fn handle_at(&mut self, ev: Event, now: Instant) -> Vec<Effect> {
        use Phase::*;
        let ev = match self.handle_room(ev, now) {
            Ok(fx) => return fx,
            Err(ev) => ev,
        };
        let mut fx = Vec::new();
        match (self.state.phase.clone(), ev) {
            (_, Event::ToggleExpanded) => self.state.expanded = !self.state.expanded,
            (_, Event::SetExpanded(v)) => self.state.expanded = v,
            (_, Event::ToggleMute) => {
                self.state.muted = !self.state.muted;
                fx.push(Effect::SystemMute(self.state.muted));
            }
            (_, Event::SetMuted(v)) => {
                if self.state.muted != v {
                    self.state.muted = v;
                    fx.push(Effect::SystemMute(v));
                }
            }

            (Idle, Event::Call(seat)) | (NeedsHuman { .. }, Event::Call(seat)) => {
                // The seat that needed a look may still hold a live call (a timeout the probe
                // missed), and most apps keep one call at a time: hang it up before dialling.
                if !self.admit(&seat) {
                    return fx;
                }
                if let NeedsHuman { seat: cur, .. } = &self.state.phase {
                    if *cur != seat {
                        fx.push(Effect::DriverHangup(cur.clone()));
                    }
                }
                self.state.phase = Calling { seat: seat.clone() };
                self.state.expanded = true;
                self.calling_since = Some(now);
                self.take_floor(&seat);
                fx.push(Effect::DriverCall(seat));
            }
            (Calling { seat: cur }, Event::Call(seat)) if cur == seat => {}
            (Calling { seat: cur }, Event::Call(seat)) | (InCall { seat: cur, .. }, Event::Call(seat)) => {
                if cur == seat || !self.admit(&seat) {
                    return fx;
                }
                // Switching keeps the mute state; the hangup is deferred until the undo window closes.
                // In a room, sending what was said is the room's consent; 1:1 only ever pastes it.
                let carry = self.state.room.as_ref().map_or(true, |r| r.relay);
                self.state.phase = Switching { from: cur, to: seat, undo_secs_left: UNDO_WINDOW.as_secs(), carry };
                self.switch_deadline = Some(now + UNDO_WINDOW);
            }
            (Switching { from, to, carry, .. }, Event::Call(seat)) => {
                if seat == from {
                    // Tapping the original seat again cancels the switch.
                    self.restore_in_call(from, now);
                } else if self.admit(&seat) {
                    self.state.phase = Switching { from, to: seat, undo_secs_left: UNDO_WINDOW.as_secs(), carry };
                    self.switch_deadline = Some(now + UNDO_WINDOW);
                    let _ = to;
                }
            }
            (Switching { from, .. }, Event::Undo) => self.restore_in_call(from, now),
            (Switching { from, to, undo_secs_left, .. }, Event::SetCarry(carry)) => {
                // In a room, turning it on is the consent to send for the rest of the room.
                if let (true, Some(room)) = (carry, self.state.room.as_mut()) {
                    room.relay = true;
                }
                self.state.phase = Switching { from, to, undo_secs_left, carry };
            }

            // Hang up ends the room too (结束会议); ReleaseFloor is the one that keeps it.
            (Calling { seat }, Event::Hangup) | (InCall { seat, .. }, Event::Hangup) => {
                self.to_idle();
                self.state.room = None;
                fx.push(Effect::DriverHangup(seat));
            }
            (Switching { from, .. }, Event::Hangup) => {
                self.to_idle();
                self.state.room = None;
                fx.push(Effect::DriverHangup(from));
            }
            (NeedsHuman { seat, .. }, Event::Hangup) => {
                self.to_idle();
                self.state.room = None;
                fx.push(Effect::DriverHangup(seat));
            }
            (Idle, Event::Hangup) => self.state.room = None,

            // Also out of "needs you": a call the probe only confirmed after the timeout is live after all.
            (Calling { seat: cur } | NeedsHuman { seat: cur, .. }, Event::ProbeInCall { seat, in_call: true }) if cur == seat => {
                self.call_started = Some(now);
                self.calling_since = None;
                if let Some(m) = self.state.room.as_mut().and_then(|r| r.member_mut(&MemberRef::Seat(seat.clone()))) {
                    m.trouble = None;
                }
                self.state.phase = InCall { seat, elapsed_secs: 0 };
            }
            (InCall { seat: cur, .. }, Event::ProbeInCall { seat, in_call: false }) if cur == seat => {
                // The far side hung up (or the page lost the call).
                self.to_idle();
            }
            (phase, Event::ProbeNeedsHuman { seat, reason }) => {
                let live = matches!(phase, Calling { .. } | InCall { .. } | Switching { .. });
                let is_floor = self.current_seat() == Some(seat.as_str());
                if let Some(room) = self.state.room.as_mut() {
                    // A member that needs a look gets a badge; only the floor holder takes over the Dock.
                    if let Some(m) = room.member_mut(&MemberRef::Seat(seat.clone())) {
                        m.trouble = Some(reason.clone());
                    }
                    if !is_floor {
                        return fx;
                    }
                } else if live && !is_floor {
                    // Another seat's page (a background probe) must not take over the live call.
                    return fx;
                }
                self.state.phase = NeedsHuman { seat, reason };
                self.state.expanded = true;
            }

            (InCall { seat, .. }, Event::Tick) => {
                let elapsed = self.call_started.map(|t| now.duration_since(t).as_secs()).unwrap_or(0);
                self.state.phase = InCall { seat, elapsed_secs: elapsed };
            }
            (Calling { seat }, Event::Tick) => {
                let timeout = if self.state.room.is_some() { ROOM_CALL_TIMEOUT } else { CALL_TIMEOUT };
                if let Some(since) = self.calling_since {
                    if now.duration_since(since) >= timeout {
                        if let Some(m) = self.state.room.as_mut().and_then(|r| r.member_mut(&MemberRef::Seat(seat.clone()))) {
                            m.trouble = Some(TROUBLE_DIAL.into());
                        }
                        self.state.phase = NeedsHuman { seat, reason: REASON_CALL_TIMEOUT.into() };
                    }
                }
            }
            (Switching { from, to, carry, .. }, Event::Tick) => {
                let deadline = self.switch_deadline.unwrap_or(now);
                if now >= deadline {
                    self.state.phase = Calling { seat: to.clone() };
                    self.calling_since = Some(now);
                    self.switch_deadline = None;
                    self.take_floor(&to);
                    fx.push(Effect::DriverHangup(from));
                    fx.push(Effect::DriverCall(to));
                } else {
                    let left = deadline.duration_since(now);
                    self.state.phase = Switching { from, to, undo_secs_left: ((left.as_millis() + 999) / 1000) as u64, carry };
                }
            }
            _ => {}
        }
        fx
    }

    /// Room events, and room events that are really a call. `Err` hands the event to the 1:1 arms.
    fn handle_room(&mut self, ev: Event, now: Instant) -> Result<Vec<Effect>, Event> {
        use Phase::*;
        let mut fx = Vec::new();
        match ev {
            Event::RoomOpen(spec) => {
                let mut members: Vec<MemberRef> = Vec::new();
                if let Calling { seat } | InCall { seat, .. } = &self.state.phase {
                    members.push(MemberRef::Seat(seat.clone()));
                }
                for who in spec.members {
                    if !members.contains(&who) && members.len() < ROOM_MAX {
                        members.push(who);
                    }
                }
                if self.state.room.is_some() || members.len() < 2 || matches!(self.state.phase, Switching { .. }) {
                    return Ok(fx);
                }
                let live = self.current_seat().filter(|_| !matches!(self.state.phase, NeedsHuman { .. })).map(str::to_string);
                self.state.room = Some(Room {
                    id: spec.id,
                    name: spec.name,
                    group: spec.group,
                    members: members.iter().map(|who| Member { who: who.clone(), trouble: None }).collect(),
                    turn: 0,
                    relay: spec.relay,
                    addressed: spec.addressed,
                    last: None,
                });
                match live {
                    // the call in progress is the first floor: nothing to dial
                    Some(seat) => self.take_floor(&seat),
                    None => {
                        let first = spec.first.filter(|f| members.contains(f)).and_then(|f| f.seat().map(str::to_string));
                        if let Some(seat) = first.or_else(|| members.iter().find_map(|m| m.seat().map(str::to_string))) {
                            return Ok(self.handle_at(Event::Call(seat), now));
                        }
                    }
                }
            }
            Event::RoomAdd { who, room_id } => match (self.state.room.as_mut(), &self.state.phase) {
                (Some(room), _) => {
                    if room.member(&who).is_none() && room.members.len() < ROOM_MAX {
                        room.members.push(Member { who, trouble: None });
                    }
                }
                (None, Calling { seat } | InCall { seat, .. }) if who != MemberRef::Seat(seat.clone()) => {
                    let cur = MemberRef::Seat(seat.clone());
                    self.state.room = Some(Room {
                        id: room_id,
                        name: None,
                        group: None,
                        members: vec![Member { who: cur.clone(), trouble: None }, Member { who, trouble: None }],
                        turn: 1,
                        relay: false,
                        addressed: false,
                        last: Some(cur),
                    });
                }
                _ => {}
            },
            Event::RoomDrop(who) => {
                let Some(room) = self.state.room.as_mut() else { return Ok(fx) };
                room.members.retain(|m| m.who != who);
                if room.last.as_ref() == Some(&who) {
                    room.last = None;
                }
                let too_small = room.members.len() < 2;
                if let Some(seat) = who.seat() {
                    match self.state.phase.clone() {
                        Switching { from, to, .. } if to == seat => self.restore_in_call(from, now),
                        Switching { from, .. } if from == seat => {
                            self.to_idle();
                            fx.push(Effect::DriverHangup(from));
                        }
                        Calling { seat: cur } | InCall { seat: cur, .. } | NeedsHuman { seat: cur, .. } if cur == seat => {
                            self.to_idle();
                            fx.push(Effect::DriverHangup(cur));
                        }
                        _ => {}
                    }
                }
                if too_small {
                    self.state.room = None;
                }
            }
            Event::FloorNext => {
                if let Some(seat) = self.next_member() {
                    return Ok(self.handle_at(Event::Call(seat), now));
                }
            }
            Event::ReleaseFloor if self.state.room.is_some() => match self.state.phase.clone() {
                Calling { seat } | InCall { seat, .. } | NeedsHuman { seat, .. } | Switching { from: seat, .. } => {
                    self.to_idle();
                    fx.push(Effect::DriverHangup(seat));
                }
                Idle => {}
            },
            Event::DialStarted(seat) => {
                if matches!(&self.state.phase, Calling { seat: cur } if *cur == seat) {
                    self.calling_since = Some(now);
                }
            }
            other => return Err(other),
        }
        Ok(fx)
    }

    /// In a room, a seat that is called joins it (while there is space). Outside a room, always true.
    fn admit(&mut self, seat: &str) -> bool {
        let Some(room) = self.state.room.as_mut() else { return true };
        if room.has_seat(seat) {
            return true;
        }
        if room.members.len() >= ROOM_MAX {
            return false;
        }
        room.members.push(Member { who: MemberRef::Seat(seat.to_string()), trouble: None });
        true
    }

    /// A seat starts dialling in a room: a new floor take.
    fn take_floor(&mut self, seat: &str) {
        if let Some(room) = self.state.room.as_mut() {
            room.turn += 1;
            room.last = Some(MemberRef::Seat(seat.to_string()));
        }
    }

    /// 下一位: the member after the one holding (or about to hold, or last holding) the floor,
    /// skipping members with a badge and members that are not seats on this Mac.
    pub fn next_member(&self) -> Option<String> {
        let room = self.state.room.as_ref()?;
        let cur = match &self.state.phase {
            Phase::Switching { to, .. } => Some(to.clone()),
            Phase::Idle => room.last.as_ref().and_then(|m| m.seat()).map(str::to_string),
            _ => self.current_seat().map(str::to_string),
        };
        let n = room.members.len();
        let start = cur.as_deref().and_then(|c| room.members.iter().position(|m| m.who.seat() == Some(c))).unwrap_or(n - 1);
        (1..=n)
            .map(|i| &room.members[(start + i) % n])
            .find(|m| m.trouble.is_none() && m.who.seat().is_some_and(|s| Some(s) != cur.as_deref()))
            .and_then(|m| m.who.seat().map(str::to_string))
    }

    fn to_idle(&mut self) {
        self.state.phase = Phase::Idle;
        self.call_started = None;
        self.switch_deadline = None;
        self.calling_since = None;
    }

    fn restore_in_call(&mut self, seat: String, now: Instant) {
        let elapsed = self.call_started.map(|t| now.duration_since(t).as_secs()).unwrap_or(0);
        self.state.phase = Phase::InCall { seat, elapsed_secs: elapsed };
        self.switch_deadline = None;
    }

    pub fn current_seat(&self) -> Option<&str> {
        match &self.state.phase {
            Phase::Idle => None,
            Phase::Calling { seat } | Phase::InCall { seat, .. } | Phase::NeedsHuman { seat, .. } => Some(seat),
            Phase::Switching { from, .. } => Some(from),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connected(m: &mut Machine, seat: &str, t: Instant) {
        assert_eq!(m.handle_at(Event::Call(seat.into()), t), vec![Effect::DriverCall(seat.into())]);
        m.handle_at(Event::ProbeInCall { seat: seat.into(), in_call: true }, t + Duration::from_secs(1));
        assert!(matches!(m.state.phase, Phase::InCall { .. }));
    }

    #[test]
    fn call_then_hangup() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        assert!(m.state.expanded, "calling auto-expands the dock");
        m.handle_at(Event::Tick, t + Duration::from_secs(192));
        assert_eq!(m.state.phase, Phase::InCall { seat: "dot".into(), elapsed_secs: 191 });
        assert_eq!(m.handle_at(Event::Hangup, t + Duration::from_secs(200)), vec![Effect::DriverHangup("dot".into())]);
        assert_eq!(m.state.phase, Phase::Idle);
    }

    #[test]
    fn mute_is_system_level_and_survives_switch() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        assert_eq!(m.handle_at(Event::ToggleMute, t), vec![Effect::SystemMute(true)]);
        m.handle_at(Event::Call("grok-bot".into()), t + Duration::from_secs(5));
        assert!(matches!(m.state.phase, Phase::Switching { .. }));
        let fx = m.handle_at(Event::Tick, t + Duration::from_secs(9));
        assert_eq!(fx, vec![Effect::DriverHangup("dot".into()), Effect::DriverCall("grok-bot".into())]);
        assert_eq!(m.state.phase, Phase::Calling { seat: "grok-bot".into() });
        assert!(m.state.muted, "mute state is kept across a switch");
    }

    #[test]
    fn switch_can_be_undone_within_window() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        m.handle_at(Event::Call("copilot".into()), t + Duration::from_secs(10));
        m.handle_at(Event::Tick, t + Duration::from_secs(11));
        assert_eq!(m.state.phase, Phase::Switching { from: "dot".into(), to: "copilot".into(), undo_secs_left: 2, carry: true });
        let fx = m.handle_at(Event::Undo, t + Duration::from_secs(12));
        assert!(fx.is_empty(), "undo never touches drivers");
        assert!(matches!(m.state.phase, Phase::InCall { ref seat, .. } if seat == "dot"));
    }

    #[test]
    fn carry_is_on_by_default_and_can_be_turned_off_for_one_switch() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        assert!(m.handle_at(Event::SetCarry(false), t).is_empty());
        assert!(matches!(m.state.phase, Phase::InCall { .. }), "only a switch carries anything");
        m.handle_at(Event::Call("copilot".into()), t + Duration::from_secs(1));
        assert!(matches!(m.state.phase, Phase::Switching { carry: true, .. }));
        m.handle_at(Event::SetCarry(false), t + Duration::from_secs(2));
        m.handle_at(Event::Call("muse".into()), t + Duration::from_secs(2));
        m.handle_at(Event::Tick, t + Duration::from_secs(3));
        assert!(matches!(m.state.phase, Phase::Switching { ref to, carry: false, .. } if to == "muse"), "re-targeting keeps the choice");
        m.handle_at(Event::Tick, t + Duration::from_secs(6));
        assert_eq!(m.state.phase, Phase::Calling { seat: "muse".into() });
        m.handle_at(Event::ProbeInCall { seat: "muse".into(), in_call: true }, t + Duration::from_secs(7));
        m.handle_at(Event::Call("dot".into()), t + Duration::from_secs(8));
        assert!(matches!(m.state.phase, Phase::Switching { carry: true, .. }), "the next switch starts carrying again");
    }

    #[test]
    fn tapping_same_seat_is_a_noop_and_remote_hangup_resets() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        assert!(m.handle_at(Event::Call("dot".into()), t).is_empty());
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: false }, t + Duration::from_secs(30));
        assert_eq!(m.state.phase, Phase::Idle);
    }

    #[test]
    fn call_timeout_asks_for_a_human() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::Call("dot".into()), t);
        m.handle_at(Event::Tick, t + CALL_TIMEOUT + Duration::from_secs(1));
        assert!(matches!(m.state.phase, Phase::NeedsHuman { ref seat, .. } if seat == "dot"));
        assert_eq!(m.handle_at(Event::Hangup, t), vec![Effect::DriverHangup("dot".into())]);
        assert_eq!(m.state.phase, Phase::Idle);
    }

    #[test]
    fn calling_away_from_needs_human_hangs_that_seat_up_first() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::Call("grok-a".into()), t);
        m.handle_at(Event::Tick, t + CALL_TIMEOUT + Duration::from_secs(1));
        let fx = m.handle_at(Event::Call("grok-b".into()), t + Duration::from_secs(20));
        assert_eq!(fx, vec![Effect::DriverHangup("grok-a".into()), Effect::DriverCall("grok-b".into())], "hang up, then dial, in that order");
        assert!(matches!(m.state.phase, Phase::Calling { ref seat } if seat == "grok-b"));
        // retrying the same seat just dials again
        m.handle_at(Event::Tick, t + Duration::from_secs(40));
        assert_eq!(m.handle_at(Event::Call("grok-b".into()), t + Duration::from_secs(41)), vec![Effect::DriverCall("grok-b".into())]);
    }

    #[test]
    fn a_late_confirmation_turns_needs_human_into_the_call() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::Call("grok".into()), t);
        m.handle_at(Event::Tick, t + CALL_TIMEOUT + Duration::from_secs(1));
        m.handle_at(Event::ProbeInCall { seat: "other".into(), in_call: true }, t + Duration::from_secs(17));
        assert!(matches!(m.state.phase, Phase::NeedsHuman { .. }), "another seat's report changes nothing");
        m.handle_at(Event::ProbeInCall { seat: "grok".into(), in_call: true }, t + Duration::from_secs(18));
        assert!(matches!(m.state.phase, Phase::InCall { ref seat, .. } if seat == "grok"));
    }

    fn seat(id: &str) -> MemberRef {
        MemberRef::Seat(id.into())
    }

    fn spec(members: &[&str], relay: bool) -> RoomSpec {
        RoomSpec { id: "r1".into(), name: Some("评审".into()), group: None, members: members.iter().map(|m| seat(m)).collect(), relay, addressed: false, first: None }
    }

    fn room(m: &Machine) -> &Room {
        m.state.room.as_ref().expect("room open")
    }

    #[test]
    fn opening_a_room_from_idle_dials_its_first_seat() {
        let t = Instant::now();
        let mut m = Machine::new();
        let fx = m.handle_at(Event::RoomOpen(spec(&["dot", "grok", "copilot"], false)), t);
        assert_eq!(fx, vec![Effect::DriverCall("dot".into())]);
        assert_eq!(m.state.phase, Phase::Calling { seat: "dot".into() });
        assert_eq!((room(&m).turn, room(&m).last.clone()), (1, Some(seat("dot"))));
        let mut first = spec(&["dot", "grok"], false);
        first.first = Some(seat("grok"));
        let mut m = Machine::new();
        assert_eq!(m.handle_at(Event::RoomOpen(first), t), vec![Effect::DriverCall("grok".into())]);
        assert!(Machine::new().handle_at(Event::RoomOpen(spec(&["dot"], false)), t).is_empty(), "one member is not a room");
    }

    #[test]
    fn a_floor_pass_waits_out_the_undo_then_hangs_up_before_dialling() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], true)), t);
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: true }, t + Duration::from_secs(1));
        m.handle_at(Event::Call("grok".into()), t + Duration::from_secs(5));
        assert!(matches!(m.state.phase, Phase::Switching { carry: true, .. }), "a room with consent sends");
        let fx = m.handle_at(Event::Tick, t + Duration::from_secs(9));
        assert_eq!(fx, vec![Effect::DriverHangup("dot".into()), Effect::DriverCall("grok".into())]);
        assert_eq!((room(&m).turn, room(&m).last.clone()), (2, Some(seat("grok"))));
    }

    #[test]
    fn without_consent_a_room_switch_does_not_carry_until_the_chip_says_so() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], false)), t);
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: true }, t);
        m.handle_at(Event::Call("grok".into()), t);
        assert!(matches!(m.state.phase, Phase::Switching { carry: false, .. }));
        m.handle_at(Event::SetCarry(true), t);
        assert!(room(&m).relay, "turning it on is the room's consent");
        assert!(matches!(m.state.phase, Phase::Switching { carry: true, .. }));
    }

    #[test]
    fn adding_during_a_call_starts_an_ad_hoc_room_without_dialling() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        assert!(m.handle_at(Event::RoomAdd { who: seat("copilot"), room_id: "adhoc".into() }, t).is_empty());
        let r = room(&m);
        assert_eq!((r.id.as_str(), r.members.len(), r.relay, r.turn), ("adhoc", 2, false, 1));
        assert!(matches!(m.state.phase, Phase::InCall { ref seat, .. } if seat == "dot"), "the current bot keeps talking");
        m.handle_at(Event::RoomAdd { who: seat("grok"), room_id: "ignored".into() }, t);
        assert_eq!(room(&m).members.len(), 3);
        assert_eq!(room(&m).id, "adhoc");
    }

    #[test]
    fn promoting_a_live_call_keeps_it_as_the_first_floor() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "grok", t);
        assert!(m.handle_at(Event::RoomOpen(spec(&["dot", "copilot"], true)), t).is_empty());
        assert_eq!(room(&m).members[0].who, seat("grok"));
        assert_eq!(room(&m).turn, 1);
    }

    #[test]
    fn floor_next_goes_round_robin_and_skips_members_with_a_badge() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["a", "b", "c"], true)), t);
        m.handle_at(Event::ProbeInCall { seat: "a".into(), in_call: true }, t);
        assert_eq!(m.next_member().as_deref(), Some("b"));
        m.handle_at(Event::ProbeNeedsHuman { seat: "b".into(), reason: "captcha".into() }, t);
        assert!(matches!(m.state.phase, Phase::InCall { ref seat, .. } if seat == "a"), "a badge never takes the floor");
        assert_eq!(room(&m).member(&seat("b")).unwrap().trouble.as_deref(), Some("captcha"));
        m.handle_at(Event::FloorNext, t);
        assert!(matches!(m.state.phase, Phase::Switching { ref to, .. } if to == "c"));
        m.handle_at(Event::Tick, t + Duration::from_secs(4));
        m.handle_at(Event::ProbeInCall { seat: "c".into(), in_call: true }, t + Duration::from_secs(5));
        assert_eq!(m.next_member().as_deref(), Some("a"), "wraps around, still skipping b");
    }

    #[test]
    fn another_seats_page_needing_a_look_does_not_take_over_a_one_to_one_call() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        m.handle_at(Event::ProbeNeedsHuman { seat: "copilot".into(), reason: "captcha".into() }, t);
        assert!(matches!(m.state.phase, Phase::InCall { ref seat, .. } if seat == "dot"));
        m.handle_at(Event::ProbeNeedsHuman { seat: "dot".into(), reason: "captcha".into() }, t);
        assert!(matches!(m.state.phase, Phase::NeedsHuman { ref seat, .. } if seat == "dot"), "the live seat still asks");
        let mut idle = Machine::new();
        idle.handle_at(Event::ProbeNeedsHuman { seat: "copilot".into(), reason: "captcha".into() }, t);
        assert!(matches!(idle.state.phase, Phase::NeedsHuman { .. }), "with nothing live it surfaces as before");
    }

    #[test]
    fn a_remote_hang_up_or_release_keeps_the_room_and_hang_up_ends_it() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], true)), t);
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: true }, t);
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: false }, t);
        assert_eq!(m.state.phase, Phase::Idle);
        assert!(m.state.room.is_some(), "the far side hanging up leaves the room open");
        assert_eq!(m.next_member().as_deref(), Some("grok"));
        m.handle_at(Event::Call("grok".into()), t);
        assert_eq!(m.handle_at(Event::ReleaseFloor, t), vec![Effect::DriverHangup("grok".into())]);
        assert!(m.state.room.is_some() && m.state.phase == Phase::Idle);
        assert!(m.handle_at(Event::Hangup, t).is_empty());
        assert!(m.state.room.is_none(), "结束会议 from idle");
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], true)), t);
        assert_eq!(m.handle_at(Event::Hangup, t), vec![Effect::DriverHangup("dot".into())]);
        assert!(m.state.room.is_none());
    }

    #[test]
    fn dropping_the_floor_holder_hangs_it_up_and_a_room_below_two_closes() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["a", "b", "c"], true)), t);
        assert_eq!(m.handle_at(Event::RoomDrop(seat("a")), t), vec![Effect::DriverHangup("a".into())]);
        assert_eq!(room(&m).members.len(), 2);
        assert_eq!(m.state.phase, Phase::Idle);
        m.handle_at(Event::Call("b".into()), t);
        assert!(m.handle_at(Event::RoomDrop(seat("c")), t).is_empty());
        assert!(m.state.room.is_none(), "one member left is a 1:1 call");
        assert_eq!(m.state.phase, Phase::Calling { seat: "b".into() });
    }

    #[test]
    fn a_full_room_ignores_calls_to_outsiders_and_calling_a_new_seat_adds_it() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["a", "b"], true)), t);
        m.handle_at(Event::ProbeInCall { seat: "a".into(), in_call: true }, t);
        m.handle_at(Event::Call("c".into()), t);
        assert!(room(&m).has_seat("c"), "calling a new seat brings it in");
        let mut full = Machine::new();
        full.handle_at(Event::RoomOpen(spec(&["1", "2", "3", "4", "5", "6", "7"], true)), t);
        assert_eq!(room(&full).members.len(), ROOM_MAX);
        full.handle_at(Event::ProbeInCall { seat: "1".into(), in_call: true }, t);
        assert!(full.handle_at(Event::Call("7".into()), t).is_empty());
        assert!(matches!(full.state.phase, Phase::InCall { .. }));
    }

    #[test]
    fn a_room_dial_times_out_from_when_dialling_began_and_badges_the_member() {
        let t = Instant::now();
        let mut m = Machine::new();
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], true)), t);
        m.handle_at(Event::DialStarted("dot".into()), t + Duration::from_secs(20));
        m.handle_at(Event::Tick, t + Duration::from_secs(50));
        assert!(matches!(m.state.phase, Phase::Calling { .. }), "45 s counts from DialStarted");
        m.handle_at(Event::Tick, t + Duration::from_secs(66));
        assert!(matches!(m.state.phase, Phase::NeedsHuman { .. }));
        assert_eq!(room(&m).member(&seat("dot")).unwrap().trouble.as_deref(), Some(TROUBLE_DIAL));
        m.handle_at(Event::ProbeInCall { seat: "dot".into(), in_call: true }, t + Duration::from_secs(70));
        assert_eq!(room(&m).member(&seat("dot")).unwrap().trouble, None, "connecting clears the badge");
    }

    /// A small deterministic fuzz: whatever the order of events, at most one seat is live, every
    /// dial of a new floor in one step is preceded by hanging up the old one, and Hangup ends the room.
    #[test]
    fn room_invariants_hold_under_random_event_orders() {
        let seats = ["a", "b", "c", "d"];
        let mut lcg: u64 = 0x2545_f491_4f6c_dd1d;
        let mut next = |n: u64| {
            lcg = lcg.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (lcg >> 33) % n
        };
        for run in 0..200 {
            let t0 = Instant::now();
            let mut m = Machine::new();
            let mut t = t0;
            for _ in 0..60 {
                t += Duration::from_millis(500 + next(3000));
                let s = seats[next(4) as usize].to_string();
                let ev = match next(12) {
                    0 => Event::RoomOpen(RoomSpec { id: format!("r{run}"), name: None, group: None, members: seats.iter().map(|x| seat(x)).collect(), relay: next(2) == 0, addressed: false, first: None }),
                    1 => Event::Call(s),
                    2 => Event::FloorNext,
                    3 => Event::ReleaseFloor,
                    4 => Event::RoomDrop(seat(&s)),
                    5 => Event::RoomAdd { who: seat(&s), room_id: "x".into() },
                    6 => Event::ProbeInCall { seat: s, in_call: next(3) != 0 },
                    7 => Event::ProbeNeedsHuman { seat: s, reason: "r".into() },
                    8 => Event::Undo,
                    9 => Event::SetCarry(next(2) == 0),
                    10 => Event::Hangup,
                    _ => Event::Tick,
                };
                let hangup = ev == Event::Hangup;
                let fx = m.handle_at(ev, t);
                let calls: Vec<&String> = fx.iter().filter_map(|f| if let Effect::DriverCall(s) = f { Some(s) } else { None }).collect();
                assert!(calls.len() <= 1, "one dial at a time: {fx:?}");
                if let Some(called) = calls.first() {
                    let pos = fx.iter().position(|f| f == &Effect::DriverCall((*called).clone())).unwrap();
                    assert!(fx[pos + 1..].iter().all(|f| !matches!(f, Effect::DriverHangup(_))), "hang up comes before the dial: {fx:?}");
                }
                if hangup {
                    assert!(m.state.room.is_none());
                }
                if let Some(r) = &m.state.room {
                    assert!(r.members.len() >= 2 && r.members.len() <= ROOM_MAX);
                    let live = m.current_seat();
                    if let (Some(l), false) = (live, matches!(m.state.phase, Phase::NeedsHuman { .. })) {
                        assert!(r.has_seat(l), "the floor holder is a member: {l} in {r:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn room_state_serializes_for_the_dock_and_is_absent_outside_rooms() {
        let t = Instant::now();
        let mut m = Machine::new();
        assert!(!serde_json::to_string(&m.state).unwrap().contains("room"));
        m.handle_at(Event::RoomOpen(spec(&["dot", "grok"], false)), t);
        let v = serde_json::to_value(&m.state).unwrap();
        assert_eq!(v["room"]["members"][1]["who"], serde_json::json!({"kind": "seat", "id": "grok"}));
        assert_eq!(v["room"]["turn"], 1);
    }

    #[test]
    fn expanded_toggle_does_not_interrupt_call() {
        let t = Instant::now();
        let mut m = Machine::new();
        connected(&mut m, "dot", t);
        m.handle_at(Event::ToggleExpanded, t);
        assert!(!m.state.expanded);
        assert!(matches!(m.state.phase, Phase::InCall { .. }));
    }
}
