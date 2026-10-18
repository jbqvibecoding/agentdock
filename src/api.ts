import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Phase =
  | { phase: "idle" }
  | { phase: "calling"; seat: string }
  | { phase: "in_call"; seat: string; elapsed_secs: number }
  | { phase: "switching"; from: string; to: string; undo_secs_left: number }
  | { phase: "needs_human"; seat: string; reason: string };

export interface DockState { phase: Phase; muted: boolean; expanded: boolean }

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
}
export interface SeatView extends Seat { probe: ProbeResult | null; driver_verified: boolean; silent: boolean }

export type DefaultForm = "dot" | "capsule" | "expanded" | "pet";
export type Theme = "system" | "light" | "dark";
export type Snap = "top_center" | "bottom_center" | "top_left" | "top_right" | "bottom_left" | "bottom_right";
export interface Hotkeys { toggle: string; mute: string; hangup: string; seat_modifier: string; push_to_talk: boolean }
export interface AppSettings {
  default_form: DefaultForm; theme: Theme; snap: Snap; show_names: "hover" | "always" | "never";
  reduce_motion: boolean; material_strength: number; hotkeys: Hotkeys; mute_mode: "system" | "seat";
  pause_media_in_call: boolean; input_device: string | null; confirm_switch: boolean;
}
export interface DriverInfo { id: string; display_name: string; version: number; verified: boolean; kind: "web" | "app" }
export interface HostInfo { os: string; vibrancy: boolean; material?: string; version: string }

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Browser fallback so the UI can be developed and screenshotted outside Tauri. */
const mock = (() => {
  let state: DockState = { phase: { phase: "idle" }, muted: false, expanded: true };
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (ev: string, payload: unknown) => listeners.get(ev)?.forEach((f) => f(payload));
  const seats: SeatView[] = [
    { id: "dot", name: "dot", service: "ChatGPT dot", driver: { kind: "web", url: "https://chatgpt.com/", driver: "chatgpt-dot" }, icon: { kind: "builtin", key: "dot" }, enabled: true, status: "connected", account: "weijia", probe: null, driver_verified: false, silent: true },
    { id: "grok-bot", name: "Grok Bot", service: "Grok Bot", driver: { kind: "app", bundle_id: "com.cursor.grokbot", driver: "grok-bot" }, icon: { kind: "builtin", key: "grok-bot" }, enabled: true, status: "needs_auth", account: null, probe: null, driver_verified: false, silent: false },
    { id: "copilot", name: "Copilot", service: "Copilot Voice", driver: { kind: "web", url: "https://copilot.microsoft.com/", driver: "copilot-voice" }, icon: { kind: "builtin", key: "copilot" }, enabled: true, status: "needs_auth", account: null, probe: null, driver_verified: false, silent: true },
    { id: "devin", name: "Devin", service: "Devin", driver: { kind: "web", url: "https://app.devin.ai/", driver: "devin-voice" }, icon: { kind: "builtin", key: "devin" }, enabled: false, status: "unknown", account: null, probe: null, driver_verified: false, silent: true },
    { id: "muse", name: "Muse", service: "Meta Muse", driver: { kind: "web", url: "https://muse.ai/", driver: "muse-voice" }, icon: { kind: "builtin", key: "muse" }, enabled: false, status: "pending", account: null, probe: null, driver_verified: false, silent: true },
  ];
  let settings: AppSettings = {
    default_form: "dot", theme: "system", snap: "top_center", show_names: "hover", reduce_motion: false, material_strength: 0.5,
    hotkeys: { toggle: "Alt+Space", mute: "Alt+M", hangup: "Alt+Escape", seat_modifier: "Alt", push_to_talk: false },
    mute_mode: "system", pause_media_in_call: true, input_device: null, confirm_switch: false,
  };
  let started = 0; let timer: number | undefined; let undoTimer: number | undefined;
  const setState = (s: DockState) => { state = s; emit("dock:state", state); };
  const startCall = (seat: string) => {
    setState({ ...state, phase: { phase: "calling", seat }, expanded: true });
    window.setTimeout(() => {
      started = Date.now();
      setState({ ...state, phase: { phase: "in_call", seat, elapsed_secs: 0 } });
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (state.phase.phase === "in_call") setState({ ...state, phase: { ...state.phase, elapsed_secs: Math.floor((Date.now() - started) / 1000) } });
      }, 1000);
    }, 1200);
  };
  const cmds: Record<string, (a: any) => unknown> = {
    get_state: () => state,
    get_seats: () => seats,
    get_settings: () => settings,
    save_settings: (a) => { settings = a.settings; (window as any).__mockSettings = settings; emit("settings:changed", settings); },
    save_seats: (a) => { seats.splice(0, seats.length, ...a.seats.map((s: Seat) => ({ ...s, probe: null, driver_verified: false, silent: s.driver.kind === "web" }))); emit("seats:changed", seats); },
    reorder_seats: (a) => { const ids: string[] = a.ids; seats.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)); emit("seats:changed", seats); },
    list_drivers: () => [
      { id: "chatgpt-dot", display_name: "ChatGPT dot", version: 1, verified: false, kind: "web" },
      { id: "copilot-voice", display_name: "Copilot Voice", version: 1, verified: false, kind: "web" },
      { id: "devin-voice", display_name: "Devin voice", version: 1, verified: false, kind: "web" },
      { id: "grok-bot", display_name: "Grok Bot", version: 1, verified: false, kind: "app" },
      { id: "muse-voice", display_name: "Meta Muse voice", version: 1, verified: false, kind: "web" },
    ],
    call_seat: (a) => {
      const p = state.phase;
      if ((p.phase === "in_call" || p.phase === "calling") && p.seat !== a.seatId) {
        const from = p.seat; let left = 3;
        setState({ ...state, phase: { phase: "switching", from, to: a.seatId, undo_secs_left: left } });
        window.clearInterval(undoTimer);
        undoTimer = window.setInterval(() => {
          left -= 1;
          if (state.phase.phase !== "switching") { window.clearInterval(undoTimer); return; }
          if (left <= 0) { window.clearInterval(undoTimer); startCall(a.seatId); } else setState({ ...state, phase: { ...state.phase, undo_secs_left: left } });
        }, 1000);
      } else if (p.phase === "idle" || p.phase === "needs_human") startCall(a.seatId);
    },
    hangup: () => { window.clearInterval(timer); setState({ ...state, phase: { phase: "idle" } }); },
    toggle_mute: () => setState({ ...state, muted: !state.muted }),
    set_muted: (a) => setState({ ...state, muted: a.muted }),
    toggle_expanded: () => setState({ ...state, expanded: !state.expanded }),
    set_expanded: (a) => setState({ ...state, expanded: a.expanded }),
    undo_switch: () => { if (state.phase.phase === "switching") { window.clearInterval(undoTimer); setState({ ...state, phase: { phase: "in_call", seat: state.phase.from, elapsed_secs: Math.floor((Date.now() - started) / 1000) } }); } },
    resize_dock: () => undefined,
    connect_account: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.status = "connected"; s.account = "demo@example.com"; emit("seats:changed", seats); } },
    disconnect_seat: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.status = "needs_auth"; s.account = null; emit("seats:changed", seats); } },
    show_seat: () => undefined,
    test_call: () => new Promise((r) => setTimeout(() => r(true), 1500)),
    probe_seat: () => undefined,
    set_seat_icon: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.icon = { kind: "custom", path: `data:${a.fileName}` }; (s as any)._data = a.dataBase64; emit("seats:changed", seats); } return "icons/x"; },
    reset_seat_icon: (a) => { const s = seats.find((x) => x.id === a.seatId); if (s) { s.icon = { kind: "builtin", key: s.id }; emit("seats:changed", seats); } },
    seat_icon_data: (a) => { const s: any = seats.find((x) => x.id === a.seatId); return s?._data ? `data:image/png;base64,${s._data}` : null; },
    hotkey_conflicts: (a) => { const h = a.settings.hotkeys; const all = [h.toggle, h.mute, h.hangup].map((k: string) => k.toLowerCase()); return all.filter((k: string, i: number) => all.indexOf(k) !== i); },
    open_settings: () => window.open("/settings.html", "_blank"),
    quit: () => undefined,
    host_info: () => ({ os: "browser", vibrancy: false, version: "0.1.0-dev" }),
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

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
}
