import { api, applyTheme, fmtTime, type AppSettings, type DockState, type HostInfo, type SeatView } from "./api";
import { iconFor, tintFor } from "./brand";

const dock = document.getElementById("dock") as HTMLDivElement;
const bar = document.getElementById("bar") as HTMLDivElement;
const collapsed = document.getElementById("collapsed") as HTMLDivElement;

let state: DockState = { phase: { phase: "idle" }, muted: false, expanded: false };
let seats: SeatView[] = [];
let settings: AppSettings | null = null;
let hoverSeat: string | null = null;
const iconCache = new Map<string, string>();

const SVG = {
  collapse: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v6M6.2 6.2a5.4 5.4 0 1 0 7.6 0"/></svg>`,
  mic: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg>`,
  micOff: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M3 3l14 14"/></svg>`,
  hangup: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3.2 11.6c3.9-3.8 9.7-3.8 13.6 0a1 1 0 0 1 0 1.4l-1.7 1.7a1 1 0 0 1-1.3.1l-2-1.4a1 1 0 0 1-.4-1l.2-1.2a9.6 9.6 0 0 0-3.2 0l.2 1.2a1 1 0 0 1-.4 1l-2 1.4a1 1 0 0 1-1.3-.1l-1.7-1.7a1 1 0 0 1 0-1.4z"/></svg>`,
  eye: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/></svg>`,
  plus: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>`,
};

async function seatIcon(s: SeatView): Promise<string> {
  const key = s.icon.kind === "custom" ? `custom:${s.id}:${s.icon.path}` : `builtin:${s.icon.key}`;
  if (iconCache.has(key)) return iconCache.get(key)!;
  let html: string;
  if (s.icon.kind === "custom") {
    const data = await api.invoke<string | null>("seat_icon_data", { seatId: s.id });
    html = data ? `<img src="${data}" alt="">` : await iconFor(s.id);
  } else {
    html = await iconFor(s.icon.key);
  }
  iconCache.set(key, html);
  return html;
}

const seatById = (id: string) => seats.find((s) => s.id === id);
const enabledSeats = () => seats.filter((s) => s.enabled);

function currentSeatId(): string | null {
  const p = state.phase;
  return p.phase === "idle" ? null : p.phase === "switching" ? p.from : p.seat;
}

// ───────── layout: the window is resized to exactly the glass shape ─────────
const H = 56;
const BTN = 44, PAD = 6;

const vertical = () => dock.dataset.orient === "vertical";

/** Length of the bar along its main axis, measured from the real flex content so text fits. */
function measureBar(): number {
  const axis = vertical() ? "height" : "width";
  bar.style[axis] = "max-content";
  const len = Math.ceil(vertical() ? bar.scrollHeight : bar.scrollWidth) + PAD * 2;
  bar.style[axis] = "";
  return Math.max(len, BTN + PAD * 2);
}

let lastSize = { w: 0, h: 0 };
let pendingShrink: number | undefined;
async function fit(form: "dot" | "pet" | "bar") {
  let w: number, h: number;
  if (form === "dot") { w = 36; h = 36; }
  else if (form === "pet") { w = 92; h = 40; }
  else if (vertical()) { w = H; h = measureBar(); }
  else { w = measureBar(); h = H; }
  dock.style.width = `${w}px`;
  dock.style.height = `${h}px`;
  if (w === lastSize.w && h === lastSize.h) return;   // hover re-layouts must not spam resize_dock
  const grow = w > lastSize.w || h > lastSize.h;
  window.clearTimeout(pendingShrink);
  const resize = () => api.invoke("resize_dock", { width: Math.max(w, 36), height: Math.max(h, 36) });
  if (grow) await resize();
  else pendingShrink = window.setTimeout(resize, settings?.reduce_motion ? 140 : 480);
  lastSize = { w, h };
}

// ───────── render ─────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function button(cls: string, svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `btn ${cls}`, svg);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

async function seatButton(s: SeatView, small: boolean, active: boolean): Promise<HTMLButtonElement> {
  const b = button(`seat${small ? " sm" : ""}${active ? " active" : ""}${s.enabled ? "" : " disabled"}`, "", s.name, () => {
    if (!s.enabled) return;
    api.invoke("call_seat", { seatId: s.id });
  });
  b.dataset.seat = s.id;
  b.dataset.status = s.status;
  if (settings?.show_names !== "never") b.title = `${s.name} · ${seatHint(s)}`;
  b.style.setProperty("--seat-tint", tintFor(s.id));
  const mark = el("div", "mark", await seatIcon(s));
  b.append(mark, el("i", "badge"));
  b.addEventListener("mouseenter", () => { hoverSeat = s.id; renderStatusText(); });
  b.addEventListener("mouseleave", () => { hoverSeat = null; renderStatusText(); });
  let pressTimer: number | undefined;
  b.addEventListener("pointerdown", () => { pressTimer = window.setTimeout(() => api.invoke("open_settings"), 550); });
  b.addEventListener("pointerup", () => window.clearTimeout(pressTimer));
  b.addEventListener("pointerleave", () => window.clearTimeout(pressTimer));
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); api.invoke("open_settings"); });
  return b;
}

let prevForm = ""; let prevIdle = true;
let statusEl: HTMLDivElement | null = null;
function renderStatusText() {
  if (!statusEl || state.phase.phase !== "idle") return;
  // The reference pill carries no text while idle; seat names are tooltips (see seatButton).
  // "always" keeps the hovered name inline, measured into the pill width so it never overlaps.
  const s = hoverSeat ? seatById(hoverSeat) : null;
  if (s && settings?.show_names === "always") {
    statusEl.innerHTML = `<div class="name">${escapeHtml(s.name)}</div><div class="sub">${seatHint(s)}</div>`;
    statusEl.classList.remove("idle");
  } else {
    statusEl.innerHTML = "";
    statusEl.classList.add("idle");
  }
  if (dock.dataset.form === "bar") void fit("bar");
}

const seatHint = (s: SeatView) => !s.enabled ? "未启用" : s.status === "pending" ? "待接入" : s.status === "needs_auth" ? "需登录 · 点击仍可尝试" : s.silent ? "无感呼叫" : "App 呼叫";
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function render() {
  const p = state.phase;
  dock.dataset.phase = p.phase;
  dock.dataset.muted = String(state.muted);
  const cur = currentSeatId();
  const curSeat = cur ? seatById(cur) : null;
  dock.style.setProperty("--seat-tint", curSeat ? tintFor(curSeat.id) : "");

  const form: "dot" | "pet" | "bar" = state.expanded ? "bar" : settings?.default_form === "pet" ? "pet" : "dot";
  dock.dataset.form = form;
  if ((form === "bar") !== (prevForm === "bar") || (p.phase === "idle") !== prevIdle) touchIdle();   // became idle+expanded → start the countdown
  prevForm = form; prevIdle = p.phase === "idle";

  // collapsed content
  if (form === "pet") {
    const pet = curSeat ?? enabledSeats()[0];
    collapsed.innerHTML = "";
    const av = el("div", "pet-avatar", pet ? await seatIcon(pet) : "");
    const lines = el("div", "pet-lines", "<i></i><i></i>");
    collapsed.append(av, lines);
    collapsed.title = p.phase === "in_call" ? `${pet?.name} · ${fmtTime(p.elapsed_secs)}` : "展开 AgentDock";
  } else {
    collapsed.innerHTML = "";
    collapsed.title = p.phase === "in_call" ? `通话中 ${fmtTime(p.elapsed_secs)} · 点击展开` : "展开 AgentDock";
  }

  if (form !== "bar") { await fit(form); return; }
  collapsed.removeAttribute("title");

  // expanded bar
  const frag = document.createDocumentFragment();
  const micBtn = button(state.muted ? "amber" : "", state.muted ? SVG.micOff : SVG.mic, state.muted ? "开麦" : "闭麦", () => api.invoke("toggle_mute"));
  micBtn.id = "mic";

  if (p.phase === "idle") {
    frag.append(button("ghost", SVG.collapse, "收起", () => api.invoke("set_expanded", { expanded: false })));
    frag.append(micBtn);
    statusEl = el("div", "status idle");
    frag.append(statusEl);
    frag.append(el("div", "divider"));
    for (const s of seats.filter((s) => s.enabled || s.status === "pending")) frag.append(await seatButton(s, false, false));
    frag.append(button("ghost add", SVG.plus, "添加席位", () => api.invoke("open_settings")));
    frag.append(grip());
    renderStatusTextInto(statusEl);
  } else if (p.phase === "calling" || p.phase === "in_call") {
    const s = seatById(p.seat);
    const av = el("div", "avatar", s ? await seatIcon(s) : "");
    av.title = "收起";
    av.addEventListener("click", () => api.invoke("set_expanded", { expanded: false }));
    frag.append(av);
    const st = el("div", "status");
    st.innerHTML = `<div class="name">${escapeHtml(s?.name ?? p.seat)}</div><div class="sub">${p.phase === "calling" ? "正在呼叫…" : `${escapeHtml(s?.service ?? "")} · ${fmtTime(p.elapsed_secs)}`}</div>`;
    frag.append(st);
    const wave = el("canvas", "wave") as HTMLCanvasElement;
    if (vertical()) { wave.width = 68; wave.height = 168; } else { wave.width = 168; wave.height = 68; }
    frag.append(wave);
    waveCanvas = wave;
    frag.append(micBtn);
    frag.append(button("red", SVG.hangup, "挂断", () => api.invoke("hangup")));
    const others = enabledSeats().filter((x) => x.id !== p.seat);
    if (others.length) frag.append(el("div", "divider"));
    for (const o of others) frag.append(await seatButton(o, true, false));
  } else if (p.phase === "switching") {
    const to = seatById(p.to), from = seatById(p.from);
    const av = el("div", "avatar", to ? await seatIcon(to) : "");
    frag.append(av);
    const st = el("div", "status");
    st.innerHTML = `<div class="name">切到 ${escapeHtml(to?.name ?? p.to)}…</div><div class="sub">正在挂断 ${escapeHtml(from?.name ?? p.from)}${state.muted ? " · 已闭麦" : ""}</div>`;
    frag.append(st);
    const undo = el("button", "undo", `撤销 ${p.undo_secs_left}`);
    undo.type = "button";
    undo.addEventListener("click", () => api.invoke("undo_switch"));
    frag.append(undo);
    frag.append(micBtn);
    frag.append(button("red", SVG.hangup, "全部挂断", () => api.invoke("hangup")));
    frag.append(el("div", "divider"));
    for (const o of enabledSeats()) frag.append(await seatButton(o, true, o.id === p.to));
  } else if (p.phase === "needs_human") {
    const s = seatById(p.seat);
    frag.append(el("div", "avatar", s ? await seatIcon(s) : ""));
    const st = el("div", "status");
    st.innerHTML = `<div class="name">需要你看一眼</div><div class="sub">${escapeHtml(p.reason)}</div>`;
    frag.append(st);
    frag.append(button("", SVG.eye, "查看页面", () => api.invoke("show_seat", { seatId: p.seat, visible: true })));
    frag.append(button("red", SVG.hangup, "挂断", () => api.invoke("hangup")));
  }

  bar.replaceChildren(frag);
  await fit("bar");
  if (p.phase === "in_call" || p.phase === "calling") startWave(); else stopWave();
}

function renderStatusTextInto(e: HTMLDivElement) { statusEl = e; renderStatusText(); }

// ───────── waveform: real mic level when available, otherwise a gentle idle motion ─────────
let waveCanvas: HTMLCanvasElement | null = null;
let analyser: AnalyserNode | null = null;
let audioCtx: AudioContext | null = null;
let raf = 0;
const bars = new Float32Array(16);

async function ensureAnalyser() {
  if (analyser || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = .7;
    src.connect(analyser);
  } catch { analyser = null; }
}

function startWave() {
  ensureAnalyser();
  cancelAnimationFrame(raf);
  const buf = new Uint8Array(32);
  const draw = (t: number) => {
    const c = waveCanvas; if (!c || !c.isConnected) return;
    const ctx = c.getContext("2d")!;
    const dpr = 2; const W = c.width / dpr, Hh = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    // bars run along the pill's main axis; in the vertical pill the canvas is taller than wide
    const vert = Hh > W;
    const L = vert ? Hh : W, T = vert ? W : Hh;
    const n = bars.length, gap = 2.6, bw = (L - gap * (n - 1)) / n;
    if (analyser && !state.muted) { analyser.getByteFrequencyData(buf); }
    for (let i = 0; i < n; i++) {
      let target: number;
      if (state.muted) target = .06;
      else if (analyser) target = Math.min(1, (buf[i + 2] / 255) * 1.6 + .06);
      else target = .18 + .14 * Math.sin(t / 420 + i * .9) + .08 * Math.sin(t / 190 + i * 1.7);
      bars[i] += (target - bars[i]) * .25;
      const len = Math.max(2.5, bars[i] * (T - 6));
      const along = i * (bw + gap), across = (T - len) / 2;
      ctx.fillStyle = getComputedStyle(dock).getPropertyValue("--sym").trim() || "#5c6b99";
      ctx.globalAlpha = state.muted ? .35 : .92;
      if (vert) roundRect(ctx, across, along, len, bw, bw / 2); else roundRect(ctx, along, across, bw, len, bw / 2);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
function stopWave() { cancelAnimationFrame(raf); raf = 0; }

// ───────── wiring ─────────
collapsed.addEventListener("click", () => api.invoke("set_expanded", { expanded: true }));
collapsed.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") api.invoke("set_expanded", { expanded: true }); });
dock.addEventListener("mouseleave", () => { if (hoverSeat) { hoverSeat = null; renderStatusText(); } });
window.addEventListener("blur", () => { if (hoverSeat) { hoverSeat = null; renderStatusText(); } });
dock.addEventListener("contextmenu", (e) => { e.preventDefault(); api.invoke("dock_menu"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.expanded && state.phase.phase === "idle") api.invoke("set_expanded", { expanded: false });
});

// ───────── grip: the grabber at the pill's end — tap flips 横向/竖向, hold-and-drag moves the Dock ─────────
// The symbol shows what a tap turns the pill into: ⇅ "stand it up" on the horizontal bar, ⇄ "lay it flat" on the vertical one.
const GRIP_SVG = {
  toVertical: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4M4.5 6.5 7 4l2.5 2.5M13 4v12M10.5 13.5 13 16l2.5-2.5"/></svg>',
  toHorizontal: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h12M13.5 4.5 16 7l-2.5 2.5M16 13H4M6.5 10.5 4 13l2.5 2.5"/></svg>',
};
function grip(): HTMLDivElement {
  const g = el("div", "grip", vertical() ? GRIP_SVG.toHorizontal : GRIP_SVG.toVertical);
  g.title = vertical() ? "点一下：放平为横向 · 按住拖动：移动" : "点一下：立起为竖向 · 按住拖动：移动";
  g.addEventListener("click", () => { if (Date.now() - lastDragEnd > 300) void api.invoke("toggle_orientation"); });
  return g;
}

// ───────── auto-collapse: an idle, un-hovered pill folds back into the dot/pet after N s ─────────
// A deadline rather than a bare timeout: the 1 Hz state ticks re-render the pill, and re-arming a
// timeout on every render would mean it never fires.
let idleTimer: number | undefined;
let idleDeadline = 0;
let hovering = false;
// Auto: fold after N s. Pinned-expanded: never by itself. Pinned-collapsed: hover is only a preview.
function idleDelayMs(): number {
  const mode = settings?.collapse_mode ?? "auto";
  if (mode === "pinned_expanded") return 0;
  if (mode === "pinned_collapsed") return 600;
  return (settings?.auto_collapse_secs ?? 0) * 1000;
}
function touchIdle() {
  idleDeadline = Date.now() + idleDelayMs();
  scheduleIdleCheck();
}
function scheduleIdleCheck() {
  window.clearTimeout(idleTimer);
  if (!idleDelayMs()) return;
  idleTimer = window.setTimeout(checkIdle, Math.max(50, idleDeadline - Date.now()));
}
async function checkIdle() {
  if (!state.expanded || state.phase.phase !== "idle") return;
  if (Date.now() < idleDeadline) { scheduleIdleCheck(); return; }
  // The webview's enter/leave tracking is lost when the window resizes under the pointer, so ask
  // the OS where the cursor really is instead of trusting `hovering`.
  const over = dragging || (api.isTauri ? await api.invoke<boolean>("cursor_over_dock") : hovering);
  if (over) { touchIdle(); return; }
  void api.invoke("set_expanded", { expanded: false });
}
let hoverExpandTimer: number | undefined;
function pointerEntered() {
  if (hovering) return;
  hovering = true;
  window.clearTimeout(idleTimer);
  // resting on the dot for a moment opens it, so the hotkey is never required
  if (!state.expanded) hoverExpandTimer = window.setTimeout(() => { if (hovering && !state.expanded && !dragging) void api.invoke("set_expanded", { expanded: true }); }, 300);
}
function pointerLeft() {
  if (!hovering) return;
  hovering = false;
  window.clearTimeout(hoverExpandTimer);
  touchIdle();
}
dock.addEventListener("pointerenter", pointerEntered);
dock.addEventListener("pointerleave", pointerLeft);
// macOS: the webview gets no pointer events while the Dock isn't the key window (it never is, by
// design), so Rust polls the OS cursor against the window rect and reports enter/leave here.
void api.on<boolean>("dock:hover", (over) => (over ? pointerEntered() : pointerLeft()));

// ───────── drag: grab the glass itself (any non-button area, or the dot) and put the Dock anywhere ─────────
// The window follows the OS cursor (one IPC per frame; Rust reads the real cursor position) instead
// of the OS move loop, which behaves differently per window manager. A 4px threshold keeps plain
// clicks on the dot working; on release the new centre is persisted as the anchor (snap → "free").
const uiLog = (level: "debug" | "warn" | "error", msg: string) => { if (api.isTauri) void api.invoke("ui_log", { level, msg }); };
window.addEventListener("error", (e) => uiLog("error", `${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => uiLog("error", `unhandled: ${String((e as PromiseRejectionEvent).reason)}`));
let grab: { x: number; y: number } | null = null;   // pointer-down point, in window px
let dragging = false;
let lastDragEnd = 0;                                // lets the grip tell a tap from the end of a drag
let dragRaf = 0;
function followCursor() {
  dragRaf = 0;
  if (grab && dragging) void api.invoke("drag_dock", { offsetX: grab.x, offsetY: grab.y });
}
dock.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, canvas")) return;
  grab = { x: e.clientX, y: e.clientY };
});
window.addEventListener("pointermove", (e) => {
  if (!grab) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) < 4) return;
    dragging = true;
    dock.setPointerCapture(e.pointerId);
    dock.classList.add("dragging");
  }
  if (!dragRaf) dragRaf = requestAnimationFrame(followCursor);
});
const endDrag = () => {
  grab = null;
  if (!dragging) return;
  dragging = false;
  lastDragEnd = Date.now();
  dock.classList.remove("dragging");
  cancelAnimationFrame(dragRaf);
  dragRaf = 0;
  void api.invoke("remember_dock_position");
  touchIdle();
};
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

function applySettings(s: AppSettings) {
  settings = s;
  dock.dataset.orient = s.orientation ?? "horizontal";
  touchIdle();
  applyTheme(s.theme);
  document.documentElement.toggleAttribute("data-reduce-motion", s.reduce_motion);
  document.documentElement.style.setProperty("--material", String(s.material_strength));
}

async function boot() {
  const host = await api.invoke<HostInfo>("host_info");
  // The CSS keys off `[data-vibrancy="1"]`; toggleAttribute() would set an empty value and never match.
  if (host.vibrancy) document.documentElement.setAttribute("data-vibrancy", "1"); else document.documentElement.removeAttribute("data-vibrancy");
  document.documentElement.dataset.os = host.os;
  applySettings(await api.invoke<AppSettings>("get_settings"));
  seats = await api.invoke<SeatView[]>("get_seats");
  state = await api.invoke<DockState>("get_state");
  lastSize = { w: 640, h: 140 };
  await render();
  api.on<DockState>("dock:state", (s) => { state = s; render(); });
  api.on<SeatView[]>("seats:changed", (s) => { seats = s; iconCache.clear(); render(); });
  api.on<AppSettings>("settings:changed", (s) => { applySettings(s); render(); });
  // Demo mode in a plain browser: expose a tiny console API.
  if (!api.isTauri) (window as any).agentdock = { call: (id: string) => api.invoke("call_seat", { seatId: id }), hangup: () => api.invoke("hangup"), mute: () => api.invoke("toggle_mute") };
}
boot();
