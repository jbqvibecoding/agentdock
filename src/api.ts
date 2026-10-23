import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LangSetting, MsgKey } from "./i18n";

export type Phase =
  | { phase: "idle" }
  | { phase: "calling"; seat: string }
  | { phase: "in_call"; seat: string; elapsed_secs: number }
  | { phase: "switching"; from: string; to: string; undo_secs_left: number; carry: boolean }
  | { phase: "needs_human"; seat: string; reason: string };

/** A group member: a seat on this Mac, or (later) an agent on another machine over yobiru. */
export type MemberRef = { kind: "seat" | "remote"; id: string };
export interface Member { who: MemberRef; trouble?: string | null }
/** A round-table group call: one voice floor (the phase's seat); the others are briefed by text. */
export interface Room {
  id: string; name: string | null; group: string | null; members: Member[]; turn: number;
  /** Consent to SEND what others said into the next floor holder's chat. */ relay: boolean;
  /** A member's name at the start of a sentence passes the floor. */ addressed: boolean;
  last: MemberRef | null;
  mode?: RoomMode;
  /** Free discussion's state while `mode` is "discussion". */ disc?: Discussion | null;
  /** A member on another machine taking or holding the floor; then no seat is live. */ remote?: RemoteFloor | null;
}
export type RemoteStage = "pending" | "sending" | "delivered" | "thinking" | "speaking";
export interface RemoteFloor { member: string; stage: RemoteStage; undo_secs_left: number; carry: boolean; origin?: PassOrigin | null }
export type RemoteEnd = "answered" | "passed" | "failed" | "timed_out" | "skipped" | "cut_in";
/** An agent on another machine, reached with yobiru; its id is its address (`peer/agent`). */
export interface RemoteMember { id: string; name: string; peer: string; agent?: string | null; voice?: string | null }
export interface YobiruSettings { cli?: string | null; python?: string | null; home?: string | null; wake_rate: number; timeout_secs: number; max_chars: number }
export interface YobiruStatus {
  cli: string | null; python: string | null; problem: "no_cli" | "no_python" | null;
  doctor: { ok: boolean; errors: number; warnings: number; checks: { status: string; check: string; detail: string; fix?: string | null }[] } | null;
  onboard: { steps: { id: string; status: string; title: string; detail: string; commands: string[]; who: string }[]; next?: string | null } | null;
}
export interface RemoteMachine { machine: string; node: string; tailscale_online: boolean; receiver: string; version?: string | null; agents?: { agent?: string | null; default: boolean }[] | null; detail?: string | null }
export interface Discovery { this_machine: string | null; machines: RemoteMachine[] }
export interface RemoteTest { stage: string; why?: string | null; detail: string; text?: string | null }
export type RoomMode = "moderated" | "discussion";
/** Why an automatic pass happened (discussion.rs PassOrigin). */
export type PassOrigin = "quiet" | "named" | "cap" | "timed" | "no_start" | "left_call";
export type PauseWhy = "user" | "spoken" | "budget" | "time_cap" | "trouble";
export interface Discussion {
  run: { state: "running" } | { state: "paused"; why: PauseWhy };
  round_robin: boolean; hops_budget: number; hops_left: number; named_streak: number; skips_in_row: number;
  /** Set while the pending switch is an automatic one. */ pending?: PassOrigin | null;
  previous?: [string, boolean] | null;
}
export interface DockState { phase: Phase; muted: boolean; expanded: boolean; room?: Room | null }

export type Speaker = { kind: "user" } | { kind: "seat" | "remote"; id: string };
export interface Utterance { seq: number; turn: number; speaker: Speaker; text: string; typed: boolean; unheard: boolean }
export interface GroupMember { who: MemberRef; aliases?: string[] }
export interface GroupContact { id: string; name: string; members: GroupMember[]; relay: boolean; addressed: boolean }
export interface CheckRow { who: MemberRef; check: string; status: "done" | "todo" | "blocked"; actor: "you" | "app" | "remote" }
export type RelayOutcome = "not_sent" | "pasted" | "sent" | "uncertain";
export interface RelayReport { id: string; outcome: RelayOutcome; why?: string }

export type DriverKind =
  | { kind: "web"; url: string; driver: string }
  | { kind: "app"; bundle_id: string; driver: string };
export type SeatIcon = { kind: "builtin"; key: string } | { kind: "custom"; path: string };
export type SeatStatus = "connected" | "needs_auth" | "pending" | "unavailable" | "unknown";

export interface ProbeResult {
  in_call: boolean; muted: boolean; needs_human: boolean; logged_in: boolean;
  account: string | null; url: string | null;
}
export interface Seat {
  id: string; name: string; service: string; driver: DriverKind; icon: SeatIcon;
  enabled: boolean; status: SeatStatus; account: string | null;
  /** What to pick inside the service before calling, e.g. one Bot in Grok Bot. */
  target?: string | null;
}
export interface SeatView extends Seat {
  probe: ProbeResult | null; driver_verified: boolean; silent: boolean;
  /** The driver can send a round-table relay note (otherwise it is pasted, or not at all). */ relay?: boolean;
}

export type DefaultForm = "dot" | "capsule" | "expanded" | "pet";
export type Theme = "system" | "light" | "dark";
export type Snap = "free" | "top_center" | "bottom_center" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
export type Orientation = "horizontal" | "vertical";
export type CollapseMode = "auto" | "pinned_expanded" | "pinned_collapsed";
export interface DockAnchor { x: number; y: number }
export interface Hotkeys { toggle: string; mute: string; hangup: string; orientation: string; form: string; discussion?: string; seat_modifier: string; push_to_talk: boolean }
export interface MemorySettings {
  enabled: boolean; user_id: string; inject_context: boolean; top_k: number;
}
export interface MemoryStatus {
  active: boolean; enabled: boolean; key_present: boolean; base_url: string; user_id: string;
  app_id: string; project_id: string; reason: string; inject_context: boolean; top_k: number;
}
export interface AppSettings {
  default_form: DefaultForm; theme: Theme; snap: Snap; orientation: Orientation; dock_anchor: DockAnchor | null; auto_collapse_secs: number; collapse_mode: CollapseMode; show_names: "hover" | "always" | "never";
  reduce_motion: boolean; material_strength: number; dock_scale?: number; accent?: string | null; hotkeys: Hotkeys; mute_mode: "system" | "seat";
  pause_media_in_call: boolean; input_device: string | null; confirm_switch: boolean;
  /** Paste the outgoing call's last turns into the next web seat when a switch commits. */
  warm_transfer?: boolean;
  web_via_chrome: boolean;
  /** macOS: where AgentDock's own icon lives; the Dock icon opens settings. */
  app_icon?: "both" | "dock" | "menu_bar";
  /** Interface language; "system" follows the OS (HostInfo.locale). */
  language?: LangSetting;
  memory: MemorySettings;
  /** Round-table members on other machines (yobiru). */
  yobiru?: YobiruSettings;
  remote_members?: RemoteMember[];
}
export interface ChromeStatus { available: boolean; connected: boolean }
export interface DriverInfo {
  id: string; display_name: string; version: number; verified: boolean; kind: "web" | "app";
  url: string | null; bundle_id: string | null; installed: boolean;
  /** The app can list what to call (its Bots). */ discover: boolean;
  /** A call picks something inside the service first. */ picks: boolean;
  target_noun: string | null;
  /** Placeholder: icon and contact only, calling not wired up yet. */ pending: boolean;
}
export interface HostInfo { os: string; vibrancy: boolean; material?: string; version: string; window_radius?: number; locale?: string }

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Browser fallback so the UI can be developed and screenshotted outside Tauri. */
const mock = (() => {
  let state: DockState = { phase: { phase: "idle" }, muted: false, expanded: true };
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (ev: string, payload: unknown) => listeners.get(ev)?.forEach((f) => f(payload));
  const seats: SeatView[] = [
    { id: "dot", name: "dot", service: "ChatGPT dot", driver: { kind: "web", url: "https://chatgpt.com/", driver: "chatgpt-dot" }, icon: { kind: "builtin", key: "dot" }, enabled: true, status: "connected", account: "weijia", probe: null, driver_verified: false, silent: true, relay: true },
    { id: "grok-bot", name: "Grok Bot", service: "Grok Bot", driver: { kind: "app", bundle_id: "com.anysphere.sand", driver: "grok-bot" }, icon: { kind: "builtin", key: "grok-bot" }, enabled: true, status: "needs_auth", account: null, probe: null, driver_verified: false, silent: false, relay: true },
    { id: "copilot", name: "Copilot", service: "Copilot Voice", driver: { kind: "web", url: "https://copilot.microsoft.com/", driver: "copilot-voice" }, icon: { kind: "builtin", key: "copilot" }, enabled: true, status: "needs_auth", account: null, probe: null, driver_verified: false, silent: true, relay: true },
    { id: "devin", name: "Devin", service: "Devin", driver: { kind: "web", url: "https://app.devin.ai/", driver: "devin-voice" }, icon: { kind: "builtin", key: "devin" }, enabled: false, status: "unknown", account: null, probe: null, driver_verified: false, silent: true },
    { id: "muse", name: "Muse", service: "Meta Muse", driver: { kind: "web", url: "https://muse.ai/", driver: "muse-voice" }, icon: { kind: "builtin", key: "muse" }, enabled: false, status: "pending", account: null, probe: null, driver_verified: false, silent: true },
  ];
  let settings: AppSettings = {
    default_form: "dot", theme: "system", snap: "top_center", orientation: "horizontal", dock_anchor: null, auto_collapse_secs: 8, collapse_mode: "auto", show_names: "hover", reduce_motion: false, material_strength: 0.5, dock_scale: 1, accent: null,
    hotkeys: { toggle: "Alt+Space", mute: "Alt+M", hangup: "Alt+Escape", orientation: "Alt+O", form: "Alt+P", discussion: "Alt+D", seat_modifier: "Alt", push_to_talk: false },
    mute_mode: "system", pause_media_in_call: true, input_device: null, confirm_switch: false, warm_transfer: true, web_via_chrome: true, app_icon: "both", language: "system",
    memory: { enabled: false, user_id: "", inject_context: true, top_k: 5 },
    yobiru: { cli: null, python: null, home: null, wake_rate: 6, timeout_secs: 150, max_chars: 300 },
    remote_members: [{ id: "devbox/codex", name: "Codex", peer: "devbox", agent: "codex", voice: null }],
  };
  if (typeof window !== "undefined") (window as any).__mockSettings = settings;
  let started = 0; let timer: number | undefined; let undoTimer: number | undefined; let connectTimer: number | undefined;
  const setState = (s: DockState) => { state = s; emit("dock:state", state); };
  // round-table: the room rides on the state like in Rust (state.rs Room); relays are recorded
  let groups: GroupContact[] = [{ id: "g-demo", name: "产品评审", members: [{ who: { kind: "seat", id: "dot" } }, { who: { kind: "seat", id: "grok-bot" }, aliases: ["格罗克"] }, { who: { kind: "seat", id: "copilot" } }], relay: true, addressed: true }];
  let ledger: Utterance[] = [];
  const W = () => window as any;
  const seatRef = (id: string): MemberRef => ({ kind: "seat", id });
  const takeFloor = (seat: string) => {
    const r = state.room;
    if (!r) return;
    if (!r.members.some((m) => m.who.id === seat) && r.members.length < 6) r.members.push({ who: seatRef(seat) });
    r.turn += 1; r.last = seatRef(seat);
  };
  const startCall = (seat: string) => {
    takeFloor(seat);
    setState({ ...state, phase: { phase: "calling", seat }, expanded: true });
    window.clearTimeout(connectTimer);
    connectTimer = window.setTimeout(() => {
      started = Date.now();
      setState({ ...state, phase: { phase: "in_call", seat, elapsed_secs: 0 } });
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (state.phase.phase !== "in_call") return;
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setState({ ...state, phase: { ...state.phase, elapsed_secs: elapsed } });
        const r = state.room, d = r?.disc;
        if (!r || !d || d.run.state !== "running" || elapsed < (W().__mockTurnSecs ?? 8)) return;
        if (d.hops_left === 0) { d.run = { state: "paused", why: "budget" }; setState({ ...state }); return; }
        const inRoom = r.members.filter((m) => !m.trouble);
        const i = inRoom.findIndex((m) => m.who.id === seat);
        const next = inRoom[(i + 1) % inRoom.length]?.who;
        if (!next || next.id === seat || r.remote) return;
        if (next.kind === "remote") { passRemote(next.id, "quiet"); return; }
        d.pending = "quiet";
        cmds.call_seat({ seatId: next.id, auto: true });
      }, 1000);
    }, 1200);
  };
  let remoteTimer: number | undefined;
  /** Like state.rs: the remote member's turn goes on after its undo window, with no seat live. */
  const remoteStep = (member: string, stage: RemoteStage) => {
    const r = state.room;
    if (!r?.remote || r.remote.member !== member) return;
    r.remote = { ...r.remote, stage };
    setState({ ...state });
  };
  const passRemote = (member: string, origin: PassOrigin | null) => {
    const r = state.room;
    if (!r || !r.members.some((m) => m.who.kind === "remote" && m.who.id === member && !m.trouble) || r.remote?.member === member) return;
    window.clearTimeout(remoteTimer);
    if (state.phase.phase === "switching") { window.clearInterval(undoTimer); state = { ...state, phase: { phase: "in_call", seat: state.phase.from, elapsed_secs: 0 } }; }
    r.remote = { member, stage: "pending", undo_secs_left: 3, carry: r.relay, origin };
    setState({ ...state });
    const tick = (left: number) => {
      remoteTimer = window.setTimeout(() => {
        const rf = state.room?.remote;
        if (!rf || rf.member !== member || rf.stage !== "pending") return;
        if (left > 1) { rf.undo_secs_left = left - 1; setState({ ...state }); tick(left - 1); return; }
        const d = state.room!.disc;
        if (d && rf.origin) { d.hops_left = Math.max(0, d.hops_left - 1); }
        window.clearInterval(timer); window.clearTimeout(connectTimer);
        state.room!.turn += 1; state.room!.last = { kind: "remote", id: member };
        state.room!.remote = { member, stage: "sending", undo_secs_left: 0, carry: rf.carry, origin: null };
        setState({ ...state, phase: { phase: "idle" } });
        (W().__mockRemoteAsks ??= []).push({ member, carry: rf.carry });
        const steps: [number, () => void][] = [
          [600, () => remoteStep(member, "delivered")],
          [900, () => remoteStep(member, "thinking")],
          [900, () => {
            const u: Utterance = { seq: ledger.length, turn: state.room?.turn ?? 0, speaker: { kind: "remote", id: member }, text: "大阪更便宜，住宿也好订。", typed: false, unheard: false };
            ledger.push(u); emit("room:lines", [u]); remoteStep(member, "speaking");
          }],
          [W().__mockSpeakMs ?? 1500, () => {
            if (state.room?.remote?.member !== member) return;
            state.room.remote = null;
            setState({ ...state });
            // free talk goes on after the answer, like discussion.rs's Tracker
            if (state.room.disc?.run.state === "running") window.setTimeout(() => cmds.floor_next({}), 800);
          }],
        ];
        const run = (i: number) => { if (i < steps.length) remoteTimer = window.setTimeout(() => { if (state.room?.remote?.member !== member) return; steps[i][1](); run(i + 1); }, steps[i][0]); };
        run(0);
      }, 1000);
    };
    tick(3);
  };
  const cmds: Record<string, (a: any) => unknown> = {
    get_state: () => state,
    get_seats: () => seats,
    get_settings: () => settings,
    save_settings: (a) => { settings = a.settings; (window as any).__mockSettings = settings; emit("settings:changed", settings); },
    save_seats: (a) => { seats.splice(0, seats.length, ...a.seats.map((s: Seat) => ({ ...s, probe: null, driver_verified: false, silent: s.driver.kind === "web" }))); emit("seats:changed", seats); },
    reorder_seats: (a) => { const ids: string[] = a.ids; seats.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)); emit("seats:changed", seats); },
    list_drivers: () => {
      const web = (id: string, display_name: string, url: string) => ({ id, display_name, version: 1, verified: false, kind: "web", url, bundle_id: null, installed: true, discover: false, picks: false, target_noun: null, pending: false });
      const app = (id: string, display_name: string, bundle_id: string, discover: boolean, target_noun: string) => ({ id, display_name, version: 1, verified: false, kind: "app", url: null, bundle_id, installed: true, discover, picks: true, target_noun, pending: false });
      const soon = (id: string, display_name: string, bundle_id: string) => ({ ...app(id, display_name, bundle_id, false, ""), picks: false, target_noun: null, pending: true });
      return [
        soon("antigravity", "Antigravity", "com.google.antigravity"),
        app("chatgpt-app", "ChatGPT dot", "com.openai.codex", false, "dot"),
        web("chatgpt-dot", "ChatGPT dot", "https://chatgpt.com/"),
        soon("claude-app", "Claude", "com.anthropic.claudefordesktop"),
        web("copilot-voice", "Copilot Voice", "https://copilot.microsoft.com/"),
        soon("cursor", "Cursor", "com.todesktop.230313mzl4w4u92"),
        web("devin-voice", "Devin voice", "https://app.devin.ai/"),
        soon("gemini-app", "Gemini", "com.google.GeminiMacOS"),
        app("grok-bot", "Grok Bot", "com.anysphere.sand", true, "Bot"),
        web("muse-voice", "Meta Muse voice", "https://muse.ai/"),
      ];
    },
    call_seat: (a) => {
      if (state.room?.remote) { window.clearTimeout(remoteTimer); state.room.remote = null; }
      const p = state.phase;
      const d = state.room?.disc;
      if (d && !a.auto) { d.pending = null; d.hops_left = d.hops_budget; }
      if ((p.phase === "in_call" || p.phase === "calling") && p.seat !== a.seatId) {
        const from = p.seat; let left = 3;
        if (state.room && !state.room.members.some((m) => m.who.id === a.seatId) && state.room.members.length >= 6) return;
        setState({ ...state, phase: { phase: "switching", from, to: a.seatId, undo_secs_left: left, carry: state.room ? state.room.relay : true } });
        window.clearInterval(undoTimer);
        undoTimer = window.setInterval(() => {
          left -= 1;
          if (state.phase.phase !== "switching") { window.clearInterval(undoTimer); return; }
          if (left <= 0) {
            window.clearInterval(undoTimer);
            const d = state.room?.disc;
            if (d) {
              if (d.pending) { d.hops_left = Math.max(0, d.hops_left - 1); d.previous = [from, d.pending === "named"]; }
              d.pending = null;
            }
            const room = !!state.room;
            const carry = state.phase.carry && (room || (settings.warm_transfer !== false && seats.find((s) => s.id === a.seatId)?.driver.kind === "web"));
            startCall(a.seatId);
            // like the host: the new phase goes out first, then the note (room) or handoff (1:1) it carried
            if (carry && room) {
              const r = { id: `rt-${state.room!.id.slice(0, 8)}-${state.room!.turn}`, to: a.seatId, turn: state.room!.turn, lines: 3, mode: "send" };
              (W().__mockRelays ??= []).push(r); emit("room:relay", r);
              window.setTimeout(() => emit("room:relay_outcome", { id: r.id, outcome: "sent", why: "" }), 400);
            } else if (carry) { const h = { from, to: a.seatId, lines: 4 }; (W().__mockHandoffs ??= []).push(h); emit("dock:handoff", h); }
          } else setState({ ...state, phase: { ...state.phase, undo_secs_left: left } });
        }, 1000);
      } else if (p.phase === "idle" || p.phase === "needs_human") startCall(a.seatId);
    },
    hangup: () => { window.clearTimeout(remoteTimer); window.clearInterval(timer); window.clearTimeout(connectTimer); window.clearInterval(undoTimer); ledger = []; setState({ ...state, phase: { phase: "idle" }, room: null }); },
    start_room: (a) => {
      const g = a.groupId ? groups.find((x) => x.id === a.groupId) : null;
      const members: MemberRef[] = g ? g.members.map((m) => m.who) : [...(a.seatIds ?? []).map(seatRef), ...(a.remoteIds ?? []).map((id: string) => ({ kind: "remote" as const, id }))];
      if (members.length < 2) throw new Error("群聊至少要两位");
      state = { ...state, room: { id: "a1b2c3d4e5f", name: g?.name ?? null, group: g?.id ?? null, members: members.map((who) => ({ who })), turn: 0, relay: g?.relay ?? false, addressed: g?.addressed ?? false, last: null } };
      const first = a.first ?? members.find((m) => m.kind === "seat")?.id;
      if (first) startCall(first); else setState({ ...state });
    },
    room_add: (a) => {
      const p = state.phase;
      const who: MemberRef = a.remoteId ? { kind: "remote", id: a.remoteId } : seatRef(a.seatId);
      if (state.room) { if (!state.room.members.some((m) => m.who.id === who.id)) state.room.members.push({ who }); }
      else if ((p.phase === "in_call" || p.phase === "calling") && p.seat !== a.seatId) {
        state = { ...state, room: { id: "adhoc00000", name: null, group: null, members: [{ who: seatRef(p.seat) }, { who }], turn: 1, relay: false, addressed: false, last: seatRef(p.seat) } };
      }
      setState({ ...state });
    },
    room_drop: (a) => {
      const room = state.room;
      if (!room) return;
      room.members = room.members.filter((m) => m.who.id !== a.seatId);
      const p = state.phase;
      if ((p.phase === "in_call" || p.phase === "calling") && p.seat === a.seatId) { window.clearInterval(timer); state = { ...state, phase: { phase: "idle" } }; }
      if (room.members.length < 2) state = { ...state, room: null };
      setState({ ...state });
    },
    floor_next: () => {
      const r = state.room; if (!r) return;
      const p = state.phase;
      const cur = r.remote ? r.remote.member : p.phase === "idle" ? r.last?.id : p.phase === "switching" ? p.to : p.seat;
      const i = r.members.findIndex((m) => m.who.id === cur);
      for (let k = 1; k <= r.members.length; k++) {
        const m = r.members[(i + k + r.members.length) % r.members.length];
        if (m.trouble || m.who.id === cur) continue;
        if (m.who.kind === "remote") passRemote(m.who.id, null); else void cmds.call_seat({ seatId: m.who.id });
        return;
      }
    },
    release_floor: () => {
      if (!state.room) return;
      window.clearTimeout(remoteTimer); state.room.remote = null;
      if (state.room.disc) { state.room.disc.pending = null; state.room.disc.run = { state: "paused", why: "user" }; }
      window.clearInterval(timer); window.clearTimeout(connectTimer); setState({ ...state, phase: { phase: "idle" } });
    },
    // free discussion: like state.rs, a discussion needs the room's consent to send (or gives it)
    set_room_mode: (a) => {
      const r = state.room; if (!r) return;
      if (a.mode === "discussion") {
        if (!r.relay && !a.consent) return;
        const n = r.members.filter((m) => m.who.kind === "seat").length;
        const budget = Math.min(8, Math.max(2, 2 * (n - 1)));
        r.relay = true; r.mode = "discussion";
        r.disc = { run: { state: "running" }, round_robin: false, hops_budget: budget, hops_left: budget, named_streak: 0, skips_in_row: 0, pending: null, previous: null };
      } else { r.mode = "moderated"; r.disc = null; }
      setState({ ...state });
    },
    discussion_pause: () => { const d = state.room?.disc; if (!d) return; d.run = { state: "paused", why: "user" }; if (state.phase.phase === "switching" && d.pending) cmds.undo_switch({}); else setState({ ...state }); },
    discussion_resume: () => { const d = state.room?.disc; if (!d) return; d.run = { state: "running" }; d.hops_left = d.hops_budget; setState({ ...state }); },
    floor_extend: () => { W().__mockExtends = (W().__mockExtends ?? 0) + 1; emit("room:countdown", null); },
    room_vad: (a) => { (W().__mockVad ??= []).push(a.active); },
    // test hooks: the user's words on the floor holder's page (spoken commands), and any host event
    mock_user_says: (a) => {
      const d = state.room?.disc; if (!d) return;
      const text = String(a.text).trim().toLowerCase();
      if (/^(停一下|暂停|等一下|等等|打住|停|stop|wait|pause|ストップ)/.test(text)) { d.run = { state: "paused", why: "spoken" }; if (state.phase.phase === "switching" && d.pending) cmds.undo_switch({}); else setState({ ...state }); }
      else if (/^(下一位|下一个|换人|next)/.test(text)) cmds.floor_next({});
      else { d.hops_left = d.hops_budget; if (d.run.state === "paused" && (d.run.why === "budget" || d.run.why === "trouble")) d.run = { state: "running" }; setState({ ...state }); }
    },
    mock_emit: (a) => emit(a.event, a.payload),
    room_say: (a) => { if (!state.room) throw new Error("no room"); const u: Utterance = { seq: ledger.length, turn: state.room.turn, speaker: { kind: "user" }, text: a.text, typed: true, unheard: false }; ledger.push(u); (W().__mockRoomSays ??= []).push(a.text); emit("room:lines", [u]); },
    room_ledger: () => ledger,
    get_groups: () => groups,
    save_groups: (a) => {
      for (const g of a.groups as GroupContact[]) {
        if (!g.name.trim() || g.name !== g.name.trim()) throw new Error("grp.err.empty");
        if (g.members.length < 2 || g.members.length > 6) throw new Error("grp.err.members");
      }
      groups = a.groups; W().__mockGroups = groups; emit("groups:changed", groups);
    },
    room_preflight: (a) => [...(a.seatIds as string[]).flatMap((id) => {
      const s = seats.find((x) => x.id === id);
      const who = seatRef(id);
      if (!s || s.status === "pending") return [{ who, check: "placeholder", status: "blocked", actor: "app" }];
      const rows: CheckRow[] = [];
      if (s.status === "needs_auth") rows.push({ who, check: s.driver.kind === "app" ? "accessibility" : "sign_in", status: "todo", actor: "you" });
      if (s.driver.kind === "app") rows.push({ who, check: "no_captions", status: "todo", actor: "app" });
      return rows.length ? rows : [{ who, check: "ready", status: "done", actor: "you" }];
    }), ...((a.remoteIds ?? []) as string[]).map((id): CheckRow => ({ who: { kind: "remote", id }, ...(settings.remote_members?.some((m) => m.id === id) ? { check: "ready", status: "done", actor: "you" } : { check: "remote_unknown", status: "blocked", actor: "you" }) }))],
    // remote members (yobiru)
    pass_remote: (a) => passRemote(a.memberId, null),
    remote_end: (a) => {
      const r = state.room, rf = r?.remote;
      if (!r || !rf || rf.stage === "pending") return;
      window.clearTimeout(remoteTimer); r.remote = null;
      if (a.how === "cut_in" && r.disc) r.disc.run = { state: "paused", why: "user" };
      (W().__mockRemoteEnds ??= []).push(a.how);
      setState({ ...state });
    },
    room_play: (a) => { (W().__mockPlays ??= []).push(a.seq); },
    yobiru_status: () => ({
      cli: "/Users/me/.claude/plugins/cache/yobiru/0.5.2/scripts/yobiru", python: "/opt/homebrew/bin/python3", problem: null,
      doctor: { ok: true, errors: 0, warnings: 1, checks: [{ status: "ok", check: "python", detail: "3.12.4", fix: null }, { status: "warn", check: "receiver", detail: "not durable", fix: "yobiru install-runtime --apply" }] },
      onboard: { steps: [{ id: "tailscale", status: "done", title: "Tailscale", detail: "signed in", commands: [], who: "agent" }, { id: "runtime", status: "todo", title: "Durable receiver", detail: "not installed", commands: ["yobiru install-runtime --apply"], who: "user" }], next: "runtime" },
    }),
    yobiru_agents: () => ({ this_machine: "macbook", machines: [
      { machine: "devbox", node: "devbox.tail.ts.net", tailscale_online: true, receiver: "ok", version: "0.5.2", agents: [{ agent: "codex", default: true }, { agent: "grok", default: false }] },
      { machine: "nas", node: "nas.tail.ts.net", tailscale_online: true, receiver: "unreachable", version: null, agents: null, detail: "no receiver" },
    ] }),
    save_remote_members: (a) => {
      const ms = a.members as RemoteMember[];
      if (new Set(ms.map((m) => m.id)).size !== ms.length) throw new Error("rm.err.duplicate");
      for (const m of ms) if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?$/.test(m.peer)) throw new Error("rm.err.peer");
      settings = { ...settings, remote_members: ms }; W().__mockSettings = settings; emit("settings:changed", settings);
    },
    test_remote: () => new Promise((r) => setTimeout(() => r({ stage: "answered", why: null, detail: "", text: "收到" }), 500)),
    tts_voices: () => [["Tingting", "zh_CN"], ["Samantha", "en_US"], ["Kyoko", "ja_JP"]],
    test_relay: (a) => new Promise((r) => setTimeout(() => r({ id: "rt-test0000-0", outcome: a.seatId === "grok-bot" ? "uncertain" : "sent", why: "" }), 600)),
    open_room_panel: () => window.open("/room.html", "_blank"),
    // test hook: a member's page needs a look (a badge, the floor stays)
    mock_member_trouble: (a) => { const m = state.room?.members.find((x) => x.who.id === a.seatId); if (m) { m.trouble = a.reason ?? "captcha"; setState({ ...state }); } },
    toggle_mute: () => setState({ ...state, muted: !state.muted }),
    set_muted: (a) => setState({ ...state, muted: a.muted }),
    toggle_expanded: () => setState({ ...state, expanded: !state.expanded }),
    set_expanded: (a) => setState({ ...state, expanded: a.expanded }),
    set_carry: (a) => { const rf = state.room?.remote; if (rf?.stage === "pending") { rf.carry = a.carry; if (a.carry) state.room!.relay = true; setState({ ...state }); return; } if (state.phase.phase === "switching") { if (a.carry && state.room) state.room.relay = true; setState({ ...state, phase: { ...state.phase, carry: a.carry } }); } },
    undo_switch: () => { if (state.room?.remote?.stage === "pending") { window.clearTimeout(remoteTimer); state.room.remote = null; setState({ ...state }); return; } if (state.phase.phase === "switching") { window.clearInterval(undoTimer); if (state.room?.disc) state.room.disc.pending = null; setState({ ...state, phase: { phase: "in_call", seat: state.phase.from, elapsed_secs: Math.floor((Date.now() - started) / 1000) } }); } },
    resize_dock: () => undefined,
    drag_dock: (a) => { const w = window as any; w.__mockDrags = (w.__mockDrags || 0) + 1; w.__mockGrab = { x: a.offsetX, y: a.offsetY }; },
    remember_dock_position: () => { (window as any).__mockAnchored = true; settings = { ...settings, snap: "free" }; (window as any).__mockSettings = settings; emit("settings:changed", settings); },
    ui_log: () => undefined,
    cursor_over_dock: () => false,
    toggle_orientation: () => { settings = { ...settings, orientation: settings.orientation === "vertical" ? "horizontal" : "vertical" }; (window as any).__mockSettings = settings; emit("settings:changed", settings); },
    toggle_collapsed_form: () => { settings = { ...settings, default_form: settings.default_form === "pet" ? "dot" : "pet" }; (window as any).__mockSettings = settings; emit("settings:changed", settings); },
    dock_menu: () => { (window as any).__mockMenuOpened = ((window as any).__mockMenuOpened || 0) + 1; },
    connect_account: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.status = "connected"; s.account = "demo@example.com"; emit("seats:changed", seats); } return s?.driver.kind === "app" ? "app" : "webview"; },
    chrome_status: () => ({ available: false, connected: false }),
    app_targets: () => ["Analytics", "Radar", "Content", "Code"],
    disconnect_seat: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.status = "needs_auth"; s.account = null; emit("seats:changed", seats); } },
    show_seat: () => undefined,
    test_call: () => new Promise((r) => setTimeout(() => r(true), 1500)),
    probe_seat: () => undefined,
    set_seat_icon: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.icon = { kind: "custom", path: `data:${a.fileName}` }; (s as any)._data = a.dataBase64; emit("seats:changed", seats); } return "icons/x"; },
    reset_seat_icon: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.icon = { kind: "builtin", key: s.id }; emit("seats:changed", seats); } },
    seat_icon_data: (a) => { const s: any = seats.find((x) => x.id === a.seatId); return s?._data ? `data:image/png;base64,${s._data}` : null; },
    hotkey_conflicts: (a) => { const h = a.settings.hotkeys; const all = [h.toggle, h.mute, h.hangup, h.orientation, h.form, h.discussion ?? "Alt+D"].map((k: string) => k.toLowerCase()); return all.filter((k: string, i: number) => all.indexOf(k) !== i); },
    open_settings: () => window.open("/settings.html", "_blank"),
    quit: () => undefined,
    // ?os=macos previews the macOS-only rows (screenshots)
    // ?lang=ja picks the "system" language for screenshots; the mock defaults to Chinese like the tests
    host_info: () => ({ os: new URLSearchParams(location.search).get("os") ?? "browser", vibrancy: false, version: "0.1.0-dev", locale: new URLSearchParams(location.search).get("lang") ?? "zh-CN" }),
    glass_scheme: () => null,
    memory_status: () => ({
      active: false, enabled: !!settings.memory?.enabled, key_present: false,
      base_url: "https://api.evermind.ai", user_id: settings.memory?.user_id || "",
      app_id: "agentdock", project_id: "default", reason: settings.memory?.enabled ? "未设置 EVEROS_API_KEY" : "已在设置中关闭",
      inject_context: settings.memory?.inject_context !== false, top_k: settings.memory?.top_k || 5,
    }),
  };
  return {
    invoke: async <T,>(cmd: string, args: any = {}): Promise<T> => cmds[cmd]?.(args) as T,
    listen: async (ev: string, cb: (e: { payload: unknown }) => void): Promise<UnlistenFn> => {
      const f = (p: unknown) => cb({ payload: p });
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(f);
      return () => { listeners.get(ev)!.delete(f); };
    },
  };
})();

if (!inTauri && typeof window !== "undefined") {
  // test hook for tests/e2e_mock.py (a dynamic import would get a fresh module instance under Vite HMR)
  (window as any).__mockInvoke = (cmd: string, args?: Record<string, unknown>) => mock.invoke(cmd, args);
}

export const api = {
  isTauri: inTauri,
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return inTauri ? invoke<T>(cmd, args) : mock.invoke<T>(cmd, args);
  },
  on<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
    return inTauri
      ? listen<T>(event, (e) => cb(e.payload))
      : mock.listen(event, (e) => cb(e.payload as T));
  },
};

export const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Theme-colour presets (设置 › 外观 › 主题色). `null` = untinted system glass. */
export const ACCENTS: [string | null, MsgKey][] = [
  [null, "accent.none"], ["#0a84ff", "accent.blue"], ["#5e5ce6", "accent.indigo"], ["#bf5af2", "accent.purple"], ["#ff375f", "accent.pink"],
  ["#ff9f0a", "accent.orange"], ["#30d158", "accent.green"], ["#64d2ff", "accent.teal"], ["#8e8e93", "accent.graphite"],
];
export const validAccent = (c: string | null | undefined): string | null => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
}
