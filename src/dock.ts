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

function measureBar(): number {
  // Measure the actual flex content so text widths are accounted for.
  bar.style.width = "max-content";
  const w = Math.ceil(bar.scrollWidth) + PAD * 2;
  bar.style.width = "";
  return Math.max(w, BTN + PAD * 2);
}

let lastSize = { w: 0, h: 0 };
let pendingShrink: number | undefined;
async function fit(form: "dot" | "pet" | "bar") {
  let w: number, h: number;
  if (form === "dot") { w = 36; h = 36; }
  else if (form === "pet") { w = 92; h = 40; }
  else { w = measureBar(); h = H; }
  dock.style.width = `${w}px`;
  dock.style.height = `${h}px`;
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

let statusEl: HTMLDivElement | null = null;
function renderStatusText() {
  if (!statusEl || state.phase.phase !== "idle") return;
  const s = hoverSeat ? seatById(hoverSeat) : null;
  if (s && settings?.show_names !== "never") {
    const hint = !s.enabled ? "未启用" : s.status === "pending" ? "待接入" : s.status === "needs_auth" ? "需登录 · 点击仍可尝试" : s.silent ? "无感呼叫" : "App 呼叫";
    statusEl.innerHTML = `<div class="name">${escapeHtml(s.name)}</div><div class="sub">${hint}</div>`;
    statusEl.classList.remove("idle");
  } else {
    statusEl.innerHTML = `<div class="name">${state.muted ? "已闭麦" : "空闲"}</div>`;
    statusEl.classList.add("idle");
  }
}

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
    wave.width = 168; wave.height = 68;
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
    const n = bars.length, gap = 2.6, bw = (W - gap * (n - 1)) / n;
    if (analyser && !state.muted) { analyser.getByteFrequencyData(buf); }
    for (let i = 0; i < n; i++) {
      let target: number;
      if (state.muted) target = .06;
      else if (analyser) target = Math.min(1, (buf[i + 2] / 255) * 1.6 + .06);
      else target = .18 + .14 * Math.sin(t / 420 + i * .9) + .08 * Math.sin(t / 190 + i * 1.7);
      bars[i] += (target - bars[i]) * .25;
      const h = Math.max(2.5, bars[i] * (Hh - 6));
      const x = i * (bw + gap), y = (Hh - h) / 2;
      ctx.fillStyle = getComputedStyle(dock).getPropertyValue("--fg").trim() || "#fff";
      ctx.globalAlpha = state.muted ? .35 : .92;
      roundRect(ctx, x, y, bw, h, bw / 2);
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
dock.addEventListener("contextmenu", (e) => { e.preventDefault(); api.invoke("open_settings"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.expanded && state.phase.phase === "idle") api.invoke("set_expanded", { expanded: false });
});

function applySettings(s: AppSettings) {
  settings = s;
  applyTheme(s.theme);
  document.documentElement.toggleAttribute("data-reduce-motion", s.reduce_motion);
  document.documentElement.style.setProperty("--material", String(s.material_strength));
}

async function boot() {
  const host = await api.invoke<HostInfo>("host_info");
  document.documentElement.toggleAttribute("data-vibrancy", host.vibrancy);
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
