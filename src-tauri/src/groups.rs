//! Saved group contacts (群聊): a name, two to six members, and what a room started from it may
//! do. Persisted as `groups.json` next to `seats.json`. The checks before dialling a room follow
//! yobiru's onboarding doctor: each row says done / todo / blocked and who has to act.

use crate::state::{MemberRef, ROOM_MAX};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMember {
    pub who: MemberRef,
    /// Other names the member answers to when you pass the floor by voice ("副驾驶" for Copilot).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupContact {
    pub id: String,
    pub name: String,
    pub members: Vec<GroupMember>,
    /// Consent to send what others said into the next floor holder's chat (转述（会发送）).
    #[serde(default)]
    pub relay: bool,
    /// Saying a member's name at the start of a sentence passes the floor to them.
    #[serde(default)]
    pub addressed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupsConfig {
    #[serde(default)]
    pub groups: Vec<GroupContact>,
}

pub fn groups_path(config_dir: &Path) -> PathBuf {
    config_dir.join("groups.json")
}

impl GroupsConfig {
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!("groups.json unreadable ({e}); starting without groups");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).expect("groups serialize"))?;
        std::fs::rename(tmp, path)
    }

    pub fn get(&self, id: &str) -> Option<&GroupContact> {
        self.groups.iter().find(|g| g.id == id)
    }

    /// Members whose seat or remote agent no longer exists are dropped.
    pub fn retain_known(&mut self, known: impl Fn(&MemberRef) -> bool) {
        for g in &mut self.groups {
            g.members.retain(|m| known(&m.who));
        }
    }
}

/// yobiru's agent-name rule (`tailmsg.py` agent_name_error): 1-64 characters, no `/`, no control
/// or line-separator characters, no surrounding whitespace. `None` when the label is fine.
pub fn label_error(label: &str) -> Option<&'static str> {
    if label.is_empty() {
        return Some("empty");
    }
    if label.chars().count() > 64 {
        return Some("too_long");
    }
    if label.contains('/') {
        return Some("slash");
    }
    if label.chars().any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}') {
        return Some("control");
    }
    if label.trim() != label {
        return Some("whitespace");
    }
    None
}

/// Why a group cannot be saved, as an i18n key under `grp.err.`.
pub fn validate(g: &GroupContact) -> Result<(), &'static str> {
    if let Some(e) = label_error(&g.name) {
        return Err(e);
    }
    if !(2..=ROOM_MAX).contains(&g.members.len()) {
        return Err("members");
    }
    for (i, m) in g.members.iter().enumerate() {
        if g.members[..i].iter().any(|o| o.who == m.who) {
            return Err("duplicate");
        }
        if m.aliases.iter().any(|a| label_error(a).is_some()) {
            return Err("alias");
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Done,
    Todo,
    Blocked,
}

/// Who has to act on a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    You,
    /// Waiting on AgentDock itself (a driver that is not wired up or not pinned yet).
    App,
    /// The remote machine's owner (yobiru members).
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CheckRow {
    pub who: MemberRef,
    /// i18n key under `pre.`
    pub check: &'static str,
    pub status: CheckStatus,
    pub actor: Actor,
}

/// What the host knows about a member before a room dials it.
#[derive(Debug, Clone, Default)]
pub struct MemberFacts {
    pub app: bool,
    pub enabled: bool,
    pub installed: bool,
    /// Placeholder driver: on the Dock, but calling is not wired up.
    pub placeholder: bool,
    pub needs_sign_in: bool,
    pub ax_trusted: bool,
    /// The driver can send a relay note (otherwise it is pasted unsent).
    pub relay_capable: bool,
    /// The driver can read what the bot says (captions).
    pub captions: bool,
    /// A yobiru member whose CLI check failed, with the reason key.
    pub remote_problem: Option<&'static str>,
}

/// One row per problem (or a single `ready` row). `relay` is whether the room will send notes.
pub fn preflight(who: &MemberRef, f: &MemberFacts, relay: bool) -> Vec<CheckRow> {
    let row = |check, status, actor| CheckRow { who: who.clone(), check, status, actor };
    let mut rows = Vec::new();
    match who {
        MemberRef::Remote(_) => {
            if let Some(problem) = f.remote_problem {
                // yobiru missing on this Mac, or a member no longer configured, is yours to fix
                let actor = if matches!(problem, "remote_no_cli" | "remote_no_python" | "remote_unknown") { Actor::You } else { Actor::Remote };
                rows.push(row(problem, CheckStatus::Blocked, actor));
            }
        }
        MemberRef::Seat(_) => {
            if f.placeholder {
                rows.push(row("placeholder", CheckStatus::Blocked, Actor::App));
            }
            if f.app && !f.installed {
                rows.push(row("not_installed", CheckStatus::Blocked, Actor::You));
            }
            if !f.enabled {
                rows.push(row("disabled", CheckStatus::Todo, Actor::You));
            }
            if f.app && f.installed && !f.ax_trusted {
                rows.push(row("accessibility", CheckStatus::Todo, Actor::You));
            }
            if f.needs_sign_in {
                rows.push(row("sign_in", CheckStatus::Todo, Actor::You));
            }
            if relay && !f.relay_capable {
                rows.push(row("paste_only", CheckStatus::Todo, Actor::App));
            }
            if !f.captions {
                rows.push(row("no_captions", CheckStatus::Todo, Actor::App));
            }
        }
    }
    if rows.is_empty() {
        rows.push(row("ready", CheckStatus::Done, Actor::You));
    }
    rows
}

/// A member can be dialled into a room unless a row blocks it.
pub fn can_join(rows: &[CheckRow]) -> bool {
    !rows.iter().any(|r| r.status == CheckStatus::Blocked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seat(id: &str) -> MemberRef {
        MemberRef::Seat(id.into())
    }

    fn group(members: &[&str]) -> GroupContact {
        GroupContact {
            id: "g1".into(),
            name: "产品评审".into(),
            members: members.iter().map(|m| GroupMember { who: seat(m), aliases: vec![] }).collect(),
            relay: true,
            addressed: false,
        }
    }

    #[test]
    fn labels_follow_yobirus_agent_name_rule() {
        assert_eq!(label_error("私信联系人"), None);
        assert_eq!(label_error(""), Some("empty"));
        assert_eq!(label_error(&"x".repeat(65)), Some("too_long"));
        assert_eq!(label_error(&"名".repeat(64)), None, "characters, not bytes");
        assert_eq!(label_error("a/b"), Some("slash"));
        assert_eq!(label_error("a\nb"), Some("control"));
        assert_eq!(label_error("a\u{2028}b"), Some("control"));
        assert_eq!(label_error(" pad"), Some("whitespace"));
    }

    #[test]
    fn a_group_has_two_to_six_distinct_members_and_clean_aliases() {
        assert_eq!(validate(&group(&["dot", "grok"])), Ok(()));
        assert_eq!(validate(&group(&["dot"])), Err("members"));
        assert_eq!(validate(&group(&["a", "b", "c", "d", "e", "f", "g"])), Err("members"));
        assert_eq!(validate(&group(&["dot", "dot"])), Err("duplicate"));
        let mut g = group(&["dot", "grok"]);
        g.members[0].aliases = vec!["ChatGPT".into(), "bad/alias".into()];
        assert_eq!(validate(&g), Err("alias"));
        g.name = " 评审".into();
        assert_eq!(validate(&g), Err("whitespace"));
    }

    #[test]
    fn groups_round_trip_and_a_corrupt_file_means_no_groups() {
        let dir = tempfile::tempdir().unwrap();
        let path = groups_path(dir.path());
        assert_eq!(GroupsConfig::load(&path), GroupsConfig::default());
        let mut cfg = GroupsConfig { groups: vec![group(&["dot", "grok"])] };
        cfg.groups[0].members.push(GroupMember { who: MemberRef::Remote("codex@devbox".into()), aliases: vec!["Codex".into()] });
        cfg.save(&path).unwrap();
        assert_eq!(GroupsConfig::load(&path), cfg);
        std::fs::write(&path, "{nope").unwrap();
        assert_eq!(GroupsConfig::load(&path), GroupsConfig::default());
    }

    #[test]
    fn members_that_no_longer_exist_are_dropped() {
        let mut cfg = GroupsConfig { groups: vec![group(&["dot", "gone", "grok"])] };
        cfg.retain_known(|m| m.seat() != Some("gone"));
        assert_eq!(cfg.groups[0].members.iter().map(|m| m.who.clone()).collect::<Vec<_>>(), [seat("dot"), seat("grok")]);
    }

    #[test]
    fn preflight_says_what_is_missing_and_who_acts() {
        let ready = MemberFacts { enabled: true, installed: true, ax_trusted: true, relay_capable: true, captions: true, ..Default::default() };
        let rows = preflight(&seat("dot"), &ready, true);
        assert_eq!((rows.len(), rows[0].check, rows[0].status), (1, "ready", CheckStatus::Done));

        let grok = MemberFacts { app: true, installed: true, enabled: true, ax_trusted: false, relay_capable: false, captions: false, ..Default::default() };
        let rows = preflight(&seat("grok"), &grok, true);
        let checks: Vec<_> = rows.iter().map(|r| (r.check, r.status, r.actor)).collect();
        assert_eq!(checks, [("accessibility", CheckStatus::Todo, Actor::You), ("paste_only", CheckStatus::Todo, Actor::App), ("no_captions", CheckStatus::Todo, Actor::App)]);
        assert!(can_join(&rows));
        assert!(!preflight(&seat("grok"), &grok, false).iter().any(|r| r.check == "paste_only"), "no relay, nothing to paste");

        let missing = MemberFacts { app: true, installed: false, enabled: true, ..Default::default() };
        assert!(!can_join(&preflight(&seat("claude"), &missing, false)));
        let placeholder = MemberFacts { placeholder: true, enabled: true, captions: true, ..Default::default() };
        assert!(!can_join(&preflight(&seat("cursor"), &placeholder, false)));
        let remote = MemberFacts { remote_problem: Some("remote_unreachable"), ..Default::default() };
        let rows = preflight(&MemberRef::Remote("codex@devbox".into()), &remote, true);
        assert_eq!((rows[0].check, rows[0].actor), ("remote_unreachable", Actor::Remote));
        assert!(!can_join(&rows));
    }
}
